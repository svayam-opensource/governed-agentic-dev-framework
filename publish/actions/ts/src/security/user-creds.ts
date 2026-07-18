// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * PERSONAL per-user credential store (2.ii.b): each human's own per-app api_tokens, at
 * `secret/users/<sub>/tokens` (one field per service), unlocked by the user's OWN `jwt/login` (role
 * `gov-user`, policy-templated to `users/<sub>/*`). This is the SAME Vault path the gov-cicd deploy
 * reads — so `gov creds set --personal` and `gov deploy` interoperate with no duplication.
 *
 * Contrast the SHARED store (`kv/gov/<account>/creds`, gov-admin-seeded) used for org-wide secrets.
 */
import { vaultLogin, kvRead, kvWrite } from "./vault.js";
import { claimsOf } from "./oidc.js";

const USER_ROLE = "gov-user";
const userPath = (sub: string): string => `secret/users/${encodeURIComponent(sub)}/tokens`;

export interface UserCredsCfg {
  readonly addr: string;         // Vault address
  readonly jwt: string;          // the user's svayamJWT (access/id token)
  readonly jwtMount?: string;    // JWT auth mount (default "gov")
}

/** The subject the personal store is keyed by (sub → preferred_username → email). */
export function credsSubject(jwt: string): string {
  const c = claimsOf(jwt) as { sub?: string; preferred_username?: string; email?: string };
  const id = c.sub ?? c.preferred_username ?? c.email;
  if (!id) throw new Error("your token carries no sub/preferred_username/email");
  return id;
}

async function open(cfg: UserCredsCfg): Promise<{ token: string; path: string }> {
  const token = await vaultLogin({ addr: cfg.addr, jwtMount: cfg.jwtMount ?? "gov", role: USER_ROLE }, cfg.jwt);
  return { token, path: userPath(credsSubject(cfg.jwt)) };
}

/** The service keys the user has a personal token for (NAMES only, never values). */
export async function userCredsList(cfg: UserCredsCfg): Promise<string[]> {
  const { token, path } = await open(cfg);
  try { return Object.keys(await kvRead(cfg.addr, token, path)); } catch { return []; }
}

/** Store one personal per-app token — read-modify-write so multiple services coexist in the one doc. */
export async function userCredsSet(cfg: UserCredsCfg, service: string, value: string): Promise<void> {
  const { token, path } = await open(cfg);
  let data: Record<string, string> = {};
  try { data = await kvRead(cfg.addr, token, path); } catch { /* new doc */ }
  await kvWrite(cfg.addr, token, path, { ...data, [service]: value });
}
