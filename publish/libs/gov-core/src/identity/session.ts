// SPDX-License-Identifier: MIT
/**
 * Per-user store for the `gov auth login` session (the svayam_jwt + refresh). Lives beside the
 * credential store, keyed by identity, 0600 — so gov-cicd reads the same token to open its
 * Vault session (the `exchange()` seam). Short-lived; re-run `gov auth login` when it expires.
 *
 * KEYED BY THE IAM IDENTITY EMAIL (Policy-Owner ruling 2026-08-04): `gov auth login`, `gov deploy` and every
 * other `gov` verb are one umbrella, so they must agree on where a session lives. They previously did not —
 * the host keyed by OS USERNAME while gov-cicd keyed by the EMAIL its `.current` pointer named, and the two
 * wrote different SCHEMAS as well (`{accessToken,idToken,expiresAt}` vs `{token,user}`). A successful
 * `gov auth login` therefore could not authenticate a governed verb by construction: it landed somewhere the
 * plugin never looked, in a shape it could not have read (910 #45).
 *
 * The email is only knowable AFTER the OIDC exchange, so the directory cannot be chosen up front. That is
 * what `.current` is for: login writes the pointer, every reader follows it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Tokens } from "./oidc.js";

/** `<agent_work_root>/preferences/<identity>/gov-auth.json` (mirrors the credentials path). */
export function authPath(agentWorkRoot: string, identity: string): string {
  const root = agentWorkRoot.replace(/^~(?=$|\/)/, os.homedir());
  return path.join(root, "preferences", identity, "gov-auth.json");
}

/** `<agent_work_root>/preferences/.current` — names the IAM identity whose session is live. */
export function currentIdentityPath(agentWorkRoot: string): string {
  const root = agentWorkRoot.replace(/^~(?=$|\/)/, os.homedir());
  return path.join(root, "preferences", ".current");
}

export function readCurrentIdentity(agentWorkRoot: string): string | undefined {
  try { return fs.readFileSync(currentIdentityPath(agentWorkRoot), "utf8").trim() || undefined; } catch { return undefined; }
}

export function writeCurrentIdentity(agentWorkRoot: string, identity: string): void {
  const f = currentIdentityPath(agentWorkRoot);
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, identity + "\n", { mode: 0o600 });
}

/**
 * The session as BOTH halves of gov read it. `token`/`user` are what gov-cicd expects; `idToken`/
 * `accessToken`/`expiresAt` are what the host expects. Writing the union is deliberate — it is the one
 * schema that satisfies both readers without either side having to change what it asks for, and it means a
 * future reader that guesses either convention is right rather than silently empty.
 */
export interface Session extends Tokens { readonly user: string; readonly token: string }

/** Persist the session under the IAM identity AND point `.current` at it. One call, so the pointer can
 *  never be left naming a session that was not written. */
export function saveSession(agentWorkRoot: string, identity: string, tokens: Tokens): string {
  const file = authPath(agentWorkRoot, identity);
  const session: Session = { ...tokens, user: identity, token: tokens.accessToken ?? tokens.idToken };
  saveAuth(file, session);
  writeCurrentIdentity(agentWorkRoot, identity);
  return file;
}

/**
 * Resolve WHICH identity's session to read: an explicit `GOV_IDENTITY` override, else the `.current`
 * pointer (the IAM email — the ruling), else the OS username. The last is a MIGRATION fallback: a session
 * saved before this change lives under the OS username with no pointer, and must keep working until the
 * next login rewrites it properly.
 */
export function sessionIdentity(agentWorkRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.GOV_IDENTITY?.trim()
    || readCurrentIdentity(agentWorkRoot)
    || env.USER || env.LOGNAME || os.userInfo().username;
}

/** Load the live session by following the pointer. */
export function loadSession(agentWorkRoot: string, env: NodeJS.ProcessEnv = process.env): Session | null {
  return loadAuth(authPath(agentWorkRoot, sessionIdentity(agentWorkRoot, env))) as Session | null;
}

export function saveAuth(file: string, tokens: Tokens): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function loadAuth(file: string): Tokens | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as Tokens; } catch { return null; }
}

export function clearAuth(file: string): void {
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}
