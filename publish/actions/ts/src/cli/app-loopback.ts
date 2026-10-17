// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ONE-SHOT LOOPBACK LISTENER `gov app setup` hands GitHub's App-manifest flow to (rule-model-design.md,
 * "gov-repo access": a GitHub App, no stopgap token).
 *
 * The same shape as a loopback sign-in: a listener on 127.0.0.1 on a port the OS picks, a page the browser opens,
 * and ONE redirect back carrying a single-use `code` and the `state` gov sent. It serves two paths and nothing else:
 *
 *   GET /           the page that auto-POSTs the manifest to GitHub (the manifest flow must be a form POST)
 *   GET /callback   GitHub's redirect — `?code=…&state=…`. A wrong or missing `state` is refused, so a page
 *                   elsewhere cannot hand gov a code for an App it did not ask for.
 *
 * Bound to 127.0.0.1 only, closed on the first good callback or the timeout — whichever comes first. The browser
 * must run on THIS machine (main.ts records why gov never assumes one); the URL is printed, never opened.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface LoopbackSession {
  /** The page to open in a browser. */
  readonly url: string;
  /** The single-use code GitHub redirected back with. Rejects on timeout. */
  readonly code: Promise<string>;
  close(): void;
}

export interface LoopbackOptions {
  /** The page served at `/`, given the redirect URL GitHub must send the browser back to. */
  readonly page: (redirectUrl: string) => string;
  /** The value GitHub must echo back; anything else is refused. */
  readonly state: string;
  readonly timeoutMs: number;
}

export type StartLoopback = (opts: LoopbackOptions) => Promise<LoopbackSession>;

/** A manifest code is opaque but plain; anything else never reaches a `gh api` path. */
export const CODE_SHAPE = /^[A-Za-z0-9_-]{1,200}$/;

const DONE_PAGE = "<!doctype html><meta charset=utf-8><title>gov</title><p>gov has the App. You can close this tab and return to your terminal.</p>";

export const startLoopback: StartLoopback = (opts) => new Promise((resolveSession, rejectSession) => {
  let settle: { ok: (c: string) => void; no: (e: Error) => void } | null = null;
  const code = new Promise<string>((ok, no) => { settle = { ok, no }; });
  // A rejection nobody awaited yet must not crash the process; the caller awaits `code` and sees it.
  code.catch(() => { /* surfaced to whoever awaits session.code */ });
  let redirectUrl = "";

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(opts.page(redirectUrl));
      return;
    }
    if (req.method === "GET" && u.pathname === "/callback") {
      const got = u.searchParams.get("code") ?? "";
      if (u.searchParams.get("state") !== opts.state || !CODE_SHAPE.test(got)) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("gov: this redirect is not the one gov asked for.");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(DONE_PAGE);
      settle?.ok(got);
      finish();
      return;
    }
    res.writeHead(404).end();
  });

  const timer = setTimeout(() => {
    settle?.no(new Error(`no answer from GitHub within ${Math.round(opts.timeoutMs / 1000)}s`));
    finish();
  }, opts.timeoutMs);
  timer.unref?.();
  function finish(): void {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
  }

  server.on("error", (e) => rejectSession(e));
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as AddressInfo;
    redirectUrl = `http://127.0.0.1:${port}/callback`;
    resolveSession({
      url: `http://127.0.0.1:${port}/`,
      code,
      close: () => { settle?.no(new Error("closed")); finish(); },
    });
  });
});
