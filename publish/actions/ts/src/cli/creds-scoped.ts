// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov creds set|ls` — the unified, SCOPE-ROUTED credential command. A credential is either:
 *   • PERSONAL (default, 2.ii.b) → `secret/users/<sub>/tokens` — your own act-as-you app tokens (npm/jenkins);
 *     the SAME path `gov deploy` reads, so no duplication and no re-entered secrets.
 *   • SHARED (`--shared`) → `kv/gov/<account>/creds` — org-wide secrets a gov-admin seeds.
 * Bare `gov creds` (the NEED/GAP walk) is unchanged — handled by runCredsCommand.
 */
import * as path from "node:path";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as readline from "node:readline";
import { prjResolveGov } from "../resolve/resolve-gov.js";
import { createNodeEnv } from "../resolve/node-env.js";
import { parseOrgConfig } from "../config/org-config.js";
import { loadSession } from "../security/auth-store.js";
import { claimsOf } from "../security/oidc.js";
import { vaultLogin, kvRead, kvWrite } from "../security/vault.js";
import { userCredsSet, userCredsList } from "../security/user-creds.js";

export type CredScope = "personal" | "shared";
export interface CredsSetArgs { key?: string; value?: string; scope: CredScope; fromNpmrc: boolean; }

/** Pure arg parse for `creds set`: positional key + optional value; `--shared`/`--personal`; `--from-npmrc`. */
export function parseCredsSet(args: readonly string[]): CredsSetArgs {
  const pos = args.filter((a) => !a.startsWith("--"));
  return { key: pos[0], value: pos[1], scope: args.includes("--shared") ? "shared" : "personal", fromNpmrc: args.includes("--from-npmrc") };
}

function npmrcAuthToken(service: string): string | undefined {
  try {
    const rc = fsSync.readFileSync(path.join(os.homedir(), ".npmrc"), "utf8");
    const m = rc.match(new RegExp(`//${service.replace(/[.]/g, "\\.")}/:_authToken=(.+)`));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error(`no TTY to prompt for '${label}' — pass the value or run interactively`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const anyRl = rl as unknown as { _writeToOutput: (s: string) => void };
  let muted = false;
  anyRl._writeToOutput = (s: string) => { if (!muted) process.stdout.write(s); };
  return new Promise((resolve) => { rl.question(`${label}: `, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); }); muted = true; });
}

interface Ctx { addr: string; jwt: string; }
function resolveCtx(): Ctx | { error: string } {
  const resolve = prjResolveGov(createNodeEnv());
  if (!resolve.ok) return { error: "no gov workspace resolved — run `gov setup` / `gov org use`" };
  let cfgText: string;
  try { cfgText = fsSync.readFileSync(path.join(resolve.home, "org-config.yaml"), "utf8"); } catch { return { error: "org-config.yaml not found" }; }
  const org = parseOrgConfig(cfgText);
  const addr = process.env.GOV_BAO_ADDR?.trim() || org.vaultAddr;   // vaultAddr now sources from services.vault
  if (!addr) return { error: "no Vault configured (vault_addr / services.vault)" };
  const session = loadSession(org.agentWorkRoot) as { accessToken?: string; idToken?: string } | null;
  if (!session) return { error: "not logged in — run `gov auth login`" };
  const jwt = session.accessToken ?? session.idToken;
  if (!jwt) return { error: "session has no token — re-run `gov auth login`" };
  return { addr, jwt };
}

function accountRole(jwt: string): { account: string; role: string } {
  const c = claimsOf(jwt) as { account_ctx?: unknown; roles?: unknown };
  const account = String(c.account_ctx ?? "");
  const roles = Array.isArray(c.roles) ? (c.roles as string[]) : [];
  const role = process.env.GOV_BAO_JWT_ROLE?.trim() || (roles.includes("GOV_ADMIN") ? "gov-admin" : roles[0]?.toLowerCase().replace(/_/g, "-") ?? "");
  return { account, role };
}

async function sharedSet(ctx: Ctx, key: string, value: string): Promise<string> {
  const { account, role } = accountRole(ctx.jwt);
  if (!account) throw new Error("your token has no account_ctx");
  if (!role) throw new Error("your token carries no gov role (a gov-admin writes shared creds)");
  const token = await vaultLogin({ addr: ctx.addr, jwtMount: process.env.GOV_BAO_JWT_MOUNT?.trim() || "gov", role }, ctx.jwt);
  const p = `kv/gov/${account}/creds`;
  let data: Record<string, string> = {};
  try { data = await kvRead(ctx.addr, token, p); } catch { /* new doc */ }
  await kvWrite(ctx.addr, token, p, { ...data, [key]: value });
  return `${p} (account ${account}, as ${role})`;
}

async function sharedList(ctx: Ctx): Promise<string[]> {
  const { account, role } = accountRole(ctx.jwt);
  if (!account || !role) return [];
  const token = await vaultLogin({ addr: ctx.addr, jwtMount: process.env.GOV_BAO_JWT_MOUNT?.trim() || "gov", role }, ctx.jwt);
  try { return Object.keys(await kvRead(ctx.addr, token, `kv/gov/${account}/creds`)); } catch { return []; }
}

/** `gov creds set|ls` — scope-routed. Returns an exit code; never prints a secret VALUE. */
export async function runCredsScoped(sub: "set" | "ls", args: readonly string[]): Promise<number> {
  const ctx = resolveCtx();
  if ("error" in ctx) { process.stderr.write(`gov creds: ${ctx.error}\n`); return 1; }
  try {
    if (sub === "ls") {
      const showShared = args.includes("--shared") || args.includes("--all");
      const personal = await userCredsList({ addr: ctx.addr, jwt: ctx.jwt });
      const lines = ["personal — secret/users/<you>/tokens:", ...(personal.length ? personal.map((s) => `  • ${s}`) : ["  (none)"])];
      if (showShared) { const shared = await sharedList(ctx); lines.push("shared — kv/gov/<account>/creds:", ...(shared.length ? shared.map((s) => `  • ${s}`) : ["  (none)"])); }
      process.stdout.write(lines.join("\n") + "\n");
      return 0;
    }
    const { key, value: posVal, scope, fromNpmrc } = parseCredsSet(args);
    if (!key) { process.stderr.write("usage: gov creds set <key> [<value>] [--personal|--shared] [--from-npmrc]\n"); return 2; }
    let value = posVal ?? (fromNpmrc ? npmrcAuthToken(key) : undefined);
    if (!value) value = await promptSecret(`value for ${key}`);
    value = (value ?? "").trim();
    if (!value) { process.stderr.write("gov creds set: empty value — nothing stored\n"); return 2; }
    const where = scope === "shared" ? await sharedSet(ctx, key, value) : (await userCredsSet({ addr: ctx.addr, jwt: ctx.jwt }, key, value), "your personal Vault (secret/users/<you>/tokens)");
    process.stdout.write(`gov creds: stored ${key} (${value.length} chars) → ${where}\n`);
    return 0;
  } catch (e) {
    const msg = (e as Error).message;
    const hint = /\b(40[013]|login|token|jwt|expired|non-printable)\b/i.test(msg) ? " — run `gov auth login` (your session may have expired)" : "";
    process.stderr.write(`gov creds ${sub}: ${msg}${hint}\n`);
    return 1;
  }
}
