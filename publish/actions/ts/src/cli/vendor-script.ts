// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A VENDOR'S INSTALL SCRIPT, VERIFIED BEFORE IT RUNS (#205 remainder, ruling Q16 C).
 *
 * gov used to run `sh -c "curl <url> | bash"` — whatever the vendor's server sent that second, executed as it
 * streamed in. Approval of the agent is the trust decision about the VENDOR (#196 Q2); it is not a decision about
 * bytes nobody looked at, and a compromised CDN or a swapped script would have run with the same consent.
 *
 *   pinned    the catalog carries `scriptSha256` — the vendor's script is stable across releases. A match runs;
 *             a mismatch is REFUSED, naming the URL, the digest gov expected and the digest it got.
 *   unpinned  the script changes every release (Cursor's embeds its version), so a pin would refuse weekly. gov
 *             shows the URL and the digest of what it downloaded and ASKS. No terminal → no one to ask → refused.
 *
 * ONE DOWNLOAD. The bytes that were hashed are the bytes handed to `bash` on stdin — never written to a file and
 * never fetched a second time, so there is no window between the check and the run (no fetch-twice TOCTOU).
 *
 * `catalog-freshness` proposes a new pin when a pinned script changes (scripts/catalog-freshness.mjs).
 */
import { createHash } from "node:crypto";
import { runBytes, runInteractive } from "../run-process.js";

export interface VendorScript {
  /** https URL of the vendor's own installer. */
  readonly url: string;
  /** Lowercase hex SHA-256 of the script, when the vendor's script is stable enough to pin. */
  readonly sha256?: string;
}

export interface ScriptIo {
  /** Download the script once. Throws on failure. */
  readonly fetch: (url: string) => Promise<Uint8Array>;
  /** Run exactly these bytes as a bash script; return its exit status. */
  readonly run: (bytes: Uint8Array) => number;
  /** Ask a yes/no question. Absent when there is no terminal — then nobody can consent. */
  readonly ask?: (question: string) => Promise<string>;
  readonly say: (line: string) => void;
}

export type ScriptOutcome =
  | { readonly ran: true; readonly status: number; readonly sha256: string }
  | { readonly ran: false; readonly reason: "not-https" | "fetch" | "drift" | "declined" | "no-terminal"; readonly message: string };

export const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** What the install plan shows before anything runs. */
export function scriptStepLine(s: VendorScript): string {
  return s.sha256
    ? `download ${s.url}, check sha256 ${s.sha256.slice(0, 12)}…, then run it with bash`
    : `download ${s.url}, show its sha256 and ask before running it with bash`;
}

export async function fetchVerifyRun(s: VendorScript, io: ScriptIo): Promise<ScriptOutcome> {
  if (!/^https:\/\//i.test(s.url)) {
    return { ran: false, reason: "not-https", message: `gov runs vendor scripts only over https; ${s.url} is not.` };
  }
  let bytes: Uint8Array;
  try {
    bytes = await io.fetch(s.url);
  } catch (e) {
    return { ran: false, reason: "fetch", message: `Could not download ${s.url}: ${(e as Error).message}` };
  }
  const actual = sha256Hex(bytes);
  if (s.sha256) {
    const expected = s.sha256.toLowerCase();
    if (actual !== expected) {
      return {
        ran: false, reason: "drift",
        message: `The install script at ${s.url} is not the one gov was released with, so gov will not run it.\n`
          + `  expected sha256 ${expected}\n`
          + `  got      sha256 ${actual}\n`
          + "  The vendor may have published a new script, or something between you and the vendor changed it.\n"
          + "  Install from the vendor's page yourself after checking it, or update gov once a release carries the new pin.",
      };
    }
    io.say(`  ✓ ${s.url} matches its pinned sha256 ${actual}`);
  } else {
    io.say(`  ${s.url}`);
    io.say(`  sha256 ${actual}  (${bytes.length} bytes; the vendor changes this script per release, so gov has no pin)`);
    if (!io.ask) {
      return {
        ran: false, reason: "no-terminal",
        message: `gov has no pinned digest for ${s.url} (sha256 ${actual}) and no terminal to ask you,\n`
          + "  so it ran nothing. Run `gov agent install` in a terminal to review and confirm.",
      };
    }
    const a = (await io.ask(`  Run this script (sha256 ${actual.slice(0, 12)}…)? [y/N] `)).trim().toLowerCase();
    if (a !== "y" && a !== "yes") {
      return { ran: false, reason: "declined", message: `Not run. Nothing from ${s.url} was executed.` };
    }
  }
  return { ran: true, status: io.run(bytes), sha256: actual };
}

/** Largest script gov will hold in memory. Vendor installers are kilobytes; anything near this is not one. */
const MAX_SCRIPT_BYTES = 5 * 1024 * 1024;

/**
 * THE REAL DOWNLOAD GOES THROUGH `curl` (2026-10-13). The first version used Node's fetch(), which broke two things:
 * every hermetic test doubles a vendor by stubbing `curl` (journeys, OS tier), so CI fetched the REAL script and ran
 * it against a stubbed curl ("Failed to fetch Bob Shell version" on every bare-machine job); and the download was
 * the one external call that did not pass through run-process.ts and its log. curl is what `curl | bash` used, so
 * proxies and CA settings behave as they did. https only, redirects included; size-capped; an HTTP error fails.
 */
export function curlArgv(url: string): readonly string[] {
  return ["curl", "-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-filesize", String(MAX_SCRIPT_BYTES), url];
}

export async function curlFetch(url: string): Promise<Uint8Array> {
  const [cmd, ...args] = curlArgv(url);
  try {
    return runBytes(cmd!, args, { pgm: "gov-work:cli:vendor-script", fn: "fetch-script", timeoutMs: 120_000 });
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer | string; message?: string };
    const why = err.stderr?.toString().trim().split("\n").pop() || err.message || "curl failed";
    throw new Error(`${why}${err.status !== undefined ? ` (curl exit ${err.status})` : ""}`);
  }
}

/**
 * GOV_SCRIPT_PINS — pins set by the environment: `https://url=<sha256>` entries separated by whitespace or `;`.
 * For a test that doubles a vendor's script (the double has its own digest), and for an organization that has
 * reviewed a newer vendor script before gov's next release. No weaker than the environment gov already trusts
 * (PATH decides which curl and bash run). The pin is still enforced, and gov says on screen that it came from here.
 */
export function parseScriptPins(text: string | undefined): Map<string, string> {
  const pins = new Map<string, string>();
  for (const entry of (text ?? "").split(/[\s;]+/)) {
    const m = /^(https:\/\/\S+)=([0-9a-fA-F]{64})$/.exec(entry);
    if (m) pins.set(m[1]!, m[2]!.toLowerCase());
  }
  return pins;
}

export function effectiveScript(s: VendorScript, env: Readonly<Record<string, string | undefined>>): { script: VendorScript; overridden: boolean } {
  const pin = parseScriptPins(env.GOV_SCRIPT_PINS).get(s.url);
  return pin ? { script: { url: s.url, sha256: pin }, overridden: true } : { script: s, overridden: false };
}

/**
 * The real runner: `bash -s` with the verified bytes on stdin — what `curl | bash` did, minus the stream. The
 * terminal's stdout/stderr stay the script's, and a script that prompts reads /dev/tty exactly as it did before.
 */
export function bashStdin(bytes: Uint8Array): number {
  return runInteractive("bash", ["-s"], {
    pgm: "gov-work:cli:vendor-script", fn: "run-script",
    spawn: { stdio: ["pipe", "inherit", "inherit"], input: Buffer.from(bytes) },
  });
}
