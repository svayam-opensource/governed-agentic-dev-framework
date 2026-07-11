// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * `gov-work auth <login|status|logout>` — the identity front door.
 *
 *   login  → browser OIDC (PKCE) to the IAM broker; store the svayam_jwt (aud=gov) that gov/gov-operate
 *            then operate under. This is what replaces per-user secret pasting: after login, `creds`
 *            (next) uses this JWT to read/WRITE Vault under the token's account_ctx.
 *   status → who you are, your account_ctx, your gov roles, and token validity.
 *   logout → forget the stored session.
 *
 * Config (defaults → env override): issuer=security.svayamtech.com, client=gov, aud=gov.
 */
import { prjResolveGov } from "../resolve/resolve-gov.js";
import { createNodeEnv } from "../resolve/node-env.js";
import { parseOrgConfig } from "../config/org-config.js";
import { defaultIdentity } from "../security/credentials.js";
import { createNodeFs } from "../lifecycle/fs-io.js";
import { login, claimsOf, type OidcConfig } from "../security/oidc.js";
import { authPath, saveAuth, loadAuth, clearAuth } from "../security/auth-store.js";

const out = (s: string): void => { process.stdout.write(`${s}\n`); };
const err = (s: string): void => { process.stderr.write(`${s}\n`); };

function oidcConfig(env: NodeJS.ProcessEnv): OidcConfig {
  return {
    issuer: env.GOV_IAM_ISSUER?.trim() || "https://security.svayamtech.com",
    clientId: env.GOV_OIDC_CLIENT_ID?.trim() || "gov",
    audience: env.GOV_OIDC_AUDIENCE?.trim() || "gov",
    scopes: env.GOV_OIDC_SCOPES?.trim() || "openid profile email",
  };
}

const roles = (c: Record<string, unknown>): string => JSON.stringify(c.roles ?? []);
const who = (c: Record<string, unknown>): string => String(c.email ?? c.sub ?? "unknown");

export async function runAuthCommand(argv: readonly string[]): Promise<number> {
  const fs = createNodeFs();
  const resolve = prjResolveGov(createNodeEnv());
  if (!resolve.ok) { err("gov-work auth: no gov workspace resolved — run `gov-work onboard`/`gov-work setup` first."); return 1; }
  const cfgText = fs.readFile(`${resolve.home}/org-config.yaml`);
  const agentWorkRoot = (cfgText && parseOrgConfig(cfgText).agentWorkRoot) || "~/.svm/projects";
  const identity = defaultIdentity(process.env);
  const file = authPath(agentWorkRoot, identity);

  const sub = argv[1] ?? "login";
  switch (sub) {
    case "login": {
      try {
        const tokens = await login(oidcConfig(process.env), out);
        saveAuth(file, tokens);
        const c = claimsOf(tokens.idToken);
        out(`✓ Signed in as ${who(c)}`);
        out(`  account: ${String(c.account_ctx ?? "?")}   roles: ${roles(c)}`);
        out(`  session valid until ${new Date(tokens.expiresAt).toISOString()} (re-run \`gov-work auth login\` when it expires).`);
        return 0;
      } catch (e) { err(`gov-work auth login failed — ${(e as Error).message}`); return 1; }
    }
    case "status": {
      const t = loadAuth(file);
      if (!t) { out("Not signed in. Run `gov-work auth login`."); return 1; }
      const c = claimsOf(t.idToken);
      const expired = t.expiresAt < Date.now();
      out(`identity:    ${who(c)}`);
      out(`account_ctx: ${String(c.account_ctx ?? "?")}`);
      out(`roles:       ${roles(c)}`);
      out(`session:     ${expired ? "EXPIRED — run `gov-work auth login`" : `valid until ${new Date(t.expiresAt).toISOString()}`}`);
      return expired ? 1 : 0;
    }
    case "logout": { clearAuth(file); out("Signed out."); return 0; }
    default: err("usage: gov-work auth <login|status|logout>"); return 2;
  }
}
