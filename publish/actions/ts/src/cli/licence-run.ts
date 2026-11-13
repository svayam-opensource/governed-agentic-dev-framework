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
import { licenceCommand, type ModuleState, type RegistryTokenResult, npmInstallArgs } from "./licence-verb.js";
import { createKeychain } from "../security/keychain.js";
import { loadCheckModule } from "../check-seam/loader.js";
import { createHost } from "../check-seam/host.js";
import type { KeychainPort } from "../check-seam/public.js";
import { runResult } from "../run-process.js";
import { githubOrgIdProvider } from "./org-id.js";
import { prjResolveGov } from "../resolve/resolve-gov.js";
import { createNodeEnv } from "../resolve/node-env.js";
import { parseOrgConfig } from "../config/org-config.js";
import { createNodeFs } from "../lifecycle/fs-io.js";

/** The licence API (spec 02 Q9); GOV_LICENCE_API points a test at a stub issuer. */
export const LICENCE_API = "https://gov.svayamtech.com/api/v1";
/** gov web's page for personal keys (MO1 3d, ruled 2026-11-12: app settings live in the app); GOV_KEYS_URL overrides. */
export const GOV_KEYS_URL = "https://gov.svayamtech.com/keys";

/**
 * Where `gov licence install` puts the module: a private npm prefix the seam loader also searches.
 * GOV_CHECK_HOME overrides; else `$XDG_DATA_HOME/gov/gov-check` (default ~/.local/share) or `%LOCALAPPDATA%\gov\gov-check`.
 */
export function licenceInstallDir(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
  if (env.GOV_CHECK_HOME) return env.GOV_CHECK_HOME;
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "gov", "gov-check");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "gov", "gov-check");
}

/**
 * POST <base>/registry-token {personalKey, org?} → {token, expiresAt}. The key is in the BODY, never the URL or a log.
 * `org` (MO1 Q3) is the repo's numeric GitHub org id when gov knows it — needed once the account has several orgs.
 */
export function httpRegistryToken(
  base: string, fetchFn: typeof fetch = fetch, orgId: () => Promise<number | null> = () => Promise.resolve(null),
): (personalKey: string) => Promise<RegistryTokenResult> {
  return async (personalKey) => {
    let res: Response;
    const org = await orgId().catch(() => null);
    try {
      res = await fetchFn(`${base.replace(/\/$/, "")}/registry-token`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(org ? { personalKey, org } : { personalKey }),
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

/**
 * `gov licence` finds and starts gov-check exactly as `gov check` does (same discovery, same lock-step and activation;
 * Policy Owner ruling 2026-10-24). Not cached: `install` loads the module it has just put on disk.
 */
export function licenceModuleLoader(o: {
  readonly govVersion: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly keychain?: KeychainPort;
  readonly load?: typeof loadCheckModule;
}): ModuleLoader {
  return async () => {
    const env = o.env ?? process.env;
    const m = await (o.load ?? loadCheckModule)({
      env,
      host: createHost({ govVersion: o.govVersion, keychain: o.keychain ?? createKeychain() }),
      opts: { surface: env.GITHUB_ACTIONS === "true" ? "ci" : "local" },
    });
    return m.state === "active" ? { state: "active", via: m.via, licence: m.module.licence } : m;
  };
}

/**
 * The repo's org for `gov licence install`: CI's environment, else the gov repo found from here (org-config.yaml
 * `github_org`), else none — gov-licence then serves an account with one organisation as before.
 */
function licenceOrgId(env: Readonly<Record<string, string | undefined>>): () => Promise<number | null> {
  let githubOrg = "";
  try {
    const at = prjResolveGov(createNodeEnv());
    const text = at.ok ? createNodeFs().readFile(path.join(at.home, "org-config.yaml")) : null;
    if (text !== null) githubOrg = parseOrgConfig(text).githubOrg;
  } catch { /* not in a gov repo: no org */ }
  return githubOrgIdProvider(githubOrg, env);
}

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
    registryToken: httpRegistryToken(env.GOV_LICENCE_API || LICENCE_API, fetch, licenceOrgId(env)),
    npmInstall: (dir, spec, extra) => {
      const res = runResult("npm", npmInstallArgs(spec), { cwd: dir, env: { ...env, ...extra }, pgm: "gov-work:cli:licence", fn: "npmInstall" });
      return { status: res.status, stderr: res.stderr };
    },
    writeFile: (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); },
    installDir: licenceInstallDir(env),
    keysUrl: env.GOV_KEYS_URL || GOV_KEYS_URL,
  });
  for (const line of r.lines) (r.code === 2 ? process.stderr : process.stdout).write(`${line}\n`);
  return r.code;
}
