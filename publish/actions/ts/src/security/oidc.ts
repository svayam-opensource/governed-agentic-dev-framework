// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * `gov auth login` — OpenID Connect Authorization-Code + PKCE against the IAM broker
 * (security.svayamtech.com). Opens the browser, catches the redirect on a localhost loopback, and
 * exchanges the code for the **svayam_jwt** (id_token) that gov/gov-operate then operate under.
 *
 * Dependency-free (gov-work rule): node built-ins only — `crypto` (PKCE), `http` (loopback),
 * `child_process` (open browser), global `fetch` (discovery + token). The IdP is the trust anchor;
 * gov does NOT verify the JWT here (Vault + resource servers verify it via IAM's JWKS) — it only
 * decodes claims to show you who you are.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

export interface OidcConfig {
  readonly issuer: string;      // IAM broker, e.g. https://security.svayamtech.com
  readonly clientId: string;    // the `gov` OIDC client (a product/app in IAM's catalog)
  readonly audience: string;    // aud=gov → mint carries the governance app-scoped `roles`
  readonly scopes: string;      // "openid profile email"
}
export interface Tokens {
  readonly idToken: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly expiresAt: number;   // epoch ms
}

const b64url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** OIDC discovery — the broker publishes its endpoints at /.well-known/openid-configuration. */
async function discover(issuer: string): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  const j = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
  if (!j.authorization_endpoint || !j.token_endpoint) throw new Error("discovery: missing authorization/token endpoint");
  return { authorization_endpoint: j.authorization_endpoint, token_endpoint: j.token_endpoint };
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try { spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).unref(); } catch { /* user opens the printed URL */ }
}

/** Run the browser login. `print` surfaces the URL (in case the browser doesn't open). Resolves with the tokens. */
export async function login(cfg: OidcConfig, print: (s: string) => void): Promise<Tokens> {
  const meta = await discover(cfg.issuer);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const c = u.searchParams.get("code"), s = u.searchParams.get("state"), err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body style="font-family:system-ui;padding:2rem"><h3>${err ? "Sign-in failed" : "Signed in ✓"}</h3><p>Return to your terminal — you can close this tab.</p></body></html>`);
      const port = (server.address() as { port: number }).port;
      server.close();
      if (err) return reject(new Error(`login: ${err}`));
      if (!c || s !== state) return reject(new Error("login: state mismatch or missing code"));
      resolve({ code: c, redirectUri: `http://127.0.0.1:${port}/callback` });
    });
    // Redirects are EXACT-match at the broker (no loopback port wildcarding), so bind a FIXED port from
    // the set the `gov` OIDC client registered (iam_oidc_client.redirect_uris). Try each until one is free.
    const ports = (process.env.GOV_LOOPBACK_PORTS?.split(",").map((n) => Number(n.trim())).filter(Boolean)) ?? [47600, 47601, 47602, 47603];
    let idx = 0;
    const tryNext = (): void => {
      if (idx >= ports.length) { reject(new Error(`login: no free loopback port in [${ports.join(", ")}] — close whatever's using them, or set GOV_LOOPBACK_PORTS`)); return; }
      server.listen(ports[idx++], "127.0.0.1");
    };
    server.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EADDRINUSE") tryNext(); else reject(e); });
    server.on("listening", () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const a = new URL(meta.authorization_endpoint);
      for (const [k, v] of Object.entries({
        response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri, scope: cfg.scopes,
        audience: cfg.audience, state, nonce, code_challenge: challenge, code_challenge_method: "S256",
      })) a.searchParams.set(k, v);
      print(`Opening your browser to sign in (loopback :${port})… if it doesn't open, visit:\n  ${a.toString()}`);
      openBrowser(a.toString());
    });
    tryNext();
    setTimeout(() => reject(new Error("login: timed out after 300s")), 300_000).unref();
  });

  const res = await fetch(meta.token_endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: cfg.clientId, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const t = (await res.json()) as { id_token?: string; access_token?: string; refresh_token?: string; expires_in?: number };
  if (!t.id_token) throw new Error("token response had no id_token");
  return { idToken: t.id_token, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 300) * 1000 };
}

/**
 * Headless SERVICE login (token-exchange RELAY) against the IAM broker — the machine analogue of
 * `login()`, no browser/PKCE. The service NEVER contacts Authentik: it hands the broker its Authentik
 * app-password (`subject_token`) + the target `audience` (app) + `account`; the broker exchanges the
 * app-password at Authentik and mints. Returns BOTH the IAM-issued id_token and the access_token
 * (svayam_jwt). Discovery-driven: only the issuer is needed up front (endpoints from /.well-known).
 */
export async function loginServiceTokenExchange(cfg: OidcConfig, username: string, subjectToken: string, account: string): Promise<Tokens> {
  const meta = await discover(cfg.issuer);
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: username, // the service identity (its Authentik service-account username/email)
      subject_token: subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: cfg.audience,
      account,
    }),
  });
  if (!res.ok) throw new Error(`service token-exchange failed (${res.status}) at ${meta.token_endpoint}`);
  const t = (await res.json()) as { id_token?: string; access_token?: string; expires_in?: number };
  const jwt = t.access_token;
  if (!jwt) throw new Error("token-exchange response carried no access_token");
  return { idToken: t.id_token ?? jwt, accessToken: jwt, expiresAt: Date.now() + (t.expires_in ?? 300) * 1000 };
}

/** Decode a JWT's claims (NO signature verification — display only). */
export function claimsOf(jwt: string): Record<string, unknown> {
  try {
    const p = jwt.split(".")[1];
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
  } catch { return {}; }
}
