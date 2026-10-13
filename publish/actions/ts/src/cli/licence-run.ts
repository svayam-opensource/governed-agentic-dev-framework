// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * The I/O for `gov licence` (licence-verb.ts holds the logic): the OS keychain, the hidden prompt, the one network
 * call (the registry token), npm, and where the module is installed. The ONLY data that leaves the machine here is the
 * personal key, to the licence service, to get a registry token (spec 02 I02.3: lease traffic).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { parseArgv } from "./args.js";
import { askFns } from "./ask.js";
import { licenceCommand, type ModuleState, type RegistryTokenResult } from "./licence-verb.js";
import { createKeychain } from "../security/keychain.js";
import { runResult } from "../run-process.js";

/** The licence API (spec 02 Q9); GOV_LICENCE_API points a test at a stub issuer. */
export const LICENCE_API = "https://gov.svayamtech.com/api/v1";
/** The portal page for personal keys (spec 02 §6.1 "Keys"); GOV_PORTAL_URL overrides. */
export const PORTAL_KEYS_URL = "https://portal.svayamtech.com/account/keys";

/**
 * Where `gov licence install` puts the module: a private npm prefix the seam loader also searches.
 * GOV_CHECK_HOME overrides; else `$XDG_DATA_HOME/gov/gov-check` (default ~/.local/share) or `%LOCALAPPDATA%\gov\gov-check`.
 */
export function licenceInstallDir(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
  if (env.GOV_CHECK_HOME) return env.GOV_CHECK_HOME;
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "gov", "gov-check");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "gov", "gov-check");
}

/** POST <base>/registry-token {personalKey} → {token, expiresAt}. The key is in the BODY, never the URL or a log. */
export function httpRegistryToken(base: string, fetchFn: typeof fetch = fetch): (personalKey: string) => Promise<RegistryTokenResult> {
  return async (personalKey) => {
    let res: Response;
    try {
      res = await fetchFn(`${base.replace(/\/$/, "")}/registry-token`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ personalKey }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, reason: `could not reach ${base} (${(e as Error).message})` };
    }
    let body: { token?: unknown; expiresAt?: unknown; error?: unknown; message?: unknown } = {};
    try { body = (await res.json()) as typeof body; } catch { /* a non-JSON answer: the status line below says enough */ }
    if (res.ok && typeof body.token === "string" && body.token) {
      return { ok: true, token: body.token, ...(typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt } : {}) };
    }
    const said = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "";
    return { ok: false, reason: `HTTP ${res.status}${said ? `: ${said.split(personalKey).join("[redacted]").slice(0, 300)}` : ""}` };
  };
}

/**
 * The installed module, for `status` and `login`. The seam loader (plan 02 E04) is passed in by the caller once it is
 * available; with none, gov reports the module as not installed.
 */
export type ModuleLoader = () => Promise<ModuleState>;

export async function runLicence(argv: readonly string[], loadModule: ModuleLoader = () => Promise.resolve({ state: "absent" })): Promise<number> {
  const parsed = parseArgv(argv);
  if ("error" in parsed) { process.stderr.write(`${parsed.error}\n`); return 2; }
  const env = process.env;
  const r = await licenceCommand(parsed.positionals, parsed.flags, {
    keychain: createKeychain(),
    loadModule,
    readKey: async (fromStdin) => {
      if (fromStdin || !process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const c of process.stdin) chunks.push(c as Buffer);
        return Buffer.concat(chunks).toString("utf8").trim() || null;
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        const ask = askFns(rl, (q) => new Promise((res) => rl.question(q, res)));
        return (await ask.secret("Personal key (hidden): ")).trim() || null;
      } finally { rl.close(); }
    },
    registryToken: httpRegistryToken(env.GOV_LICENCE_API || LICENCE_API),
    npmInstall: (dir, spec, extra) => {
      const res = runResult("npm", ["install", "--no-audit", "--no-fund", spec], { cwd: dir, env: { ...env, ...extra }, pgm: "gov-work:cli:licence", fn: "npmInstall" });
      return { status: res.status, stderr: res.stderr };
    },
    writeFile: (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); },
    installDir: licenceInstallDir(env),
    portalUrl: env.GOV_PORTAL_URL || PORTAL_KEYS_URL,
  });
  for (const line of r.lines) (r.code === 2 ? process.stderr : process.stdout).write(`${line}\n`);
  return r.code;
}
