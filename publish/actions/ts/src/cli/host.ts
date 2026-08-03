// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `gov` host seam: (1) the context banner + prompt-on-context-change for CORE commands, and (2) guarded
 * delegation of GOVERNED verbs to the internal `gov-cicd` plugin. Discovery is purely runtime (resolve the
 * package, else PATH) — gov-work has NO build dependency on gov-cicd, so the OSS boundary holds.
 */
import * as path from "node:path";
import * as fsSync from "node:fs";
import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { prjResolveGov } from "../resolve/resolve-gov.js";
import { createNodeEnv } from "../resolve/node-env.js";
import { parseOrgConfig } from "../config/org-config.js";
import { readCliVersion } from "./main.js";
import {
  type ContextInfo, type Ack, contextFingerprint, hashText, renderBanner, isAcked, recordAck,
} from "./context-banner.js";
import { basesRoot, syncAllBases } from "../lifecycle/repo.js";

/** Governed verbs provided by the internal gov-cicd plugin (absent from OSS gov-work). */
export const OPERATE_COMMANDS = new Set([
  "catalog", "build", "deploy", "data", "data-access", "promote", "rollback", "drift", "attest", "authorize", "test-spine", "deploy-check", "standards", "secret", "policy",
]);

/** The reserved namespace under which gov-infra (do-admin) verbs delegate: `gov infra <cmd> …`. Unlike
 *  gov-cicd's fixed OPERATE_COMMANDS, infra verbs are DYNAMIC (discovered from the plugin), so the host
 *  routes on this single namespace token rather than a hardcoded verb set. */
export const INFRA_NAMESPACE = "infra";

/** Index of the first non-value-flag token (past `--gov-home <path>` etc.). Shared by the delegators. */
function firstCommandIndex(argv: readonly string[]): number {
  let i = 0;
  while (i < argv.length && argv[i].startsWith("-")) i += argv[i] === "--gov-home" ? 2 : 1;
  return i;
}

/** Is this invocation a governed verb (to delegate)? Finds the command past leading value-flags
 *  (`--gov-home <path>`), so `gov --gov-home … catalog` still routes to the plugin. */
export function isGovernedInvocation(argv: readonly string[]): boolean {
  const cmd = argv[firstCommandIndex(argv)];
  return !!cmd && OPERATE_COMMANDS.has(cmd);
}

/** Is this a gov-infra invocation (`gov infra <cmd> …`)? Routes to the do-admin plugin. */
export function isInfraInvocation(argv: readonly string[]): boolean {
  return argv[firstCommandIndex(argv)] === INFRA_NAMESPACE;
}

function tryRun(cmd: string, args: string[]): string | undefined {
  try { const r = spawnSync(cmd, args, { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() || undefined : undefined; } catch { return undefined; }
}

/** Resolve the invocation context from gov-work's own primitives. Fully defensive — never throws. */
function buildContextInfo(): ContextInfo {
  const services: Record<string, string | undefined> = {};
  const anomalies: string[] = [];
  let govRepo: string | undefined, orgConfigPath: string | undefined, orgConfigHash: string | undefined, branch: string | undefined, agentWorkRoot: string | undefined;
  try {
    const resolve = prjResolveGov(createNodeEnv());
    if (resolve.ok) {
      govRepo = resolve.home;
      const p = path.join(resolve.home, "org-config.yaml");
      try {
        const text = fsSync.readFileSync(p, "utf8");
        orgConfigPath = p; orgConfigHash = hashText(text);
        const c = parseOrgConfig(text);
        agentWorkRoot = c.agentWorkRoot || undefined;
        if (c.vaultAddr) services.vault = c.vaultAddr;
        Object.assign(services, c.services);   // oidc/jenkins/npm/docker from the now-typed `services:` block
      } catch { anomalies.push("org-config.yaml not found/readable"); }
      branch = tryRun("git", ["-C", resolve.home, "rev-parse", "--abbrev-ref", "HEAD"]);
    }
  } catch { /* unresolved → none mode */ }
  let projectPath: string | undefined;
  const cwd = process.cwd();
  if (agentWorkRoot && cwd.startsWith(agentWorkRoot + path.sep)) {
    const seg = path.relative(agentWorkRoot, cwd).split(path.sep)[0];
    if (seg) projectPath = path.join(agentWorkRoot, seg);
  }
  const mode: ContextInfo["mode"] = projectPath ? "project" : govRepo ? "governed" : "none";
  const user = tryRun("git", ["config", "user.email"]) ?? tryRun("gh", ["api", "user", "--jq", ".login"]);
  if (!govRepo) anomalies.push("no gov workspace resolved — run `gov setup` / `gov org use`");
  else if (!services.vault) anomalies.push("vault not configured (vault_addr) — governed creds/deploys need it");
  return { mode, projectPath, agentWorkRoot, govRepo, orgConfigPath, orgConfigHash, user, branch, services, anomalies };
}

const ackFile = (): string => path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".gov-context-ack.json");
const readAcks = (): Ack[] => { try { return JSON.parse(fsSync.readFileSync(ackFile(), "utf8")) as Ack[]; } catch { return []; } };
const writeAcks = (acks: Ack[]): void => { try { fsSync.writeFileSync(ackFile(), JSON.stringify(acks), { mode: 0o600 }); } catch { /* best effort */ } };

async function promptYesNo(label: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => rl.question(label, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); }));
}

/** Show the banner (always) and prompt only on a CHANGED context fingerprint. Returns false to bail. */
export async function confirmContextOrBail(argv: readonly string[]): Promise<boolean> {
  if ("GOV_NO_BANNER" in process.env) return true;
  const info = buildContextInfo();
  const fp = contextFingerprint(info, undefined, readCliVersion());
  for (const l of renderBanner(info)) process.stderr.write(l + "\n");
  const now = Date.now();
  const acks = readAcks();
  if (isAcked(acks, fp, now)) return true;
  if ("GOV_YES" in process.env || argv.includes("--yes") || argv.includes("-y")) { writeAcks(recordAck(acks, fp, now)); return true; }
  if (!process.stdin.isTTY) {
    const expect = process.env.GOV_EXPECT_CONTEXT;
    if (expect && expect !== fp) { process.stderr.write(`context assertion FAILED — expected ${expect}, got ${fp} (see banner above)\n`); return false; }
    return true;
  }
  process.stderr.write(`  context changed (fp ${fp}). `);
  if (await promptYesNo("Proceed? (y/N) ")) { writeAcks(recordAck(acks, fp, now)); return true; }
  process.stderr.write("aborted — context not confirmed.\n");
  return false;
}

/** Resolve the gov-cicd plugin's launcher: `[node, bin.js]` if the package resolves, else `[gov-cicd]`
 *  from PATH. Pure runtime discovery — no build dep, so the OSS boundary holds. */
function resolveOperateCmd(): { cmd: string; prefix: string[] } {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("@svayam/gov-cicd/package.json");
    const pkg = JSON.parse(fsSync.readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string> };
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["gov-cicd"];
    if (rel) return { cmd: process.execPath, prefix: [path.join(path.dirname(pkgJson), rel)] };
  } catch { /* not a resolvable dep — try PATH */ }
  return { cmd: "gov-cicd", prefix: [] };
}

/** Source-resolving governed verbs: these tree-sha a unit's SOURCE repo for its content_sha, so the shared
 *  base clones must be current first (a base that lags its remote addresses an OLD tree → wrong/unresolved
 *  content_sha). Lightweight verbs (menu/catalog listing) don't touch source and are excluded. */
const SOURCE_VERBS = new Set(["deploy", "build", "promote", "data", "rollback", "drift", "attest"]);

/** Base-clone directory NAMES under `root` (each a repo checkout); `[]` if the root is absent. */
function listBaseDirs(root: string): string[] {
  try { return fsSync.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return []; }
}
/** Best-effort `git -C <repoDir> fetch <remote> [ref] --tags` — never throws (offline / no remote → leave
 *  as-is). `--tags` is essential: a shared-env deploy pins each unit at its RELEASE TAG (`<unit>-<semver>`),
 *  so the base clone must carry the tags, not just branch heads. */
function gitFetch(repoDir: string, remote: string, ref?: string): void {
  try { spawnSync("git", ["-C", repoDir, "fetch", remote, ...(ref ? [ref] : []), "--tags", "--quiet"], { stdio: "ignore" }); }
  catch { /* best-effort */ }
}

/** Run a governed verb via the internal gov-cicd plugin. Resolves the package's bin, else falls back to
 *  `gov-cicd` on PATH; a clean message if neither is present (OSS install without the plugin). */
export function delegateToGovOperate(argv: readonly string[]): number {
  const { cmd, prefix } = resolveOperateCmd();
  // Point the plugin's VCS at the right repo-clone ROOT so it can tree-sha a unit's SOURCE (its content_sha)
  // without the user exporting GOV_GIT_ROOT. PROJECT → the project's own worktrees (agentWorkRoot/<project>);
  // GOVERNED/NONE → the SHARED base clones (agentWorkRoot/.bases, ADR-0001), which the plugin's GitVcs resolves
  // as <root>/<repo-name>. An explicit env always wins.
  let env: NodeJS.ProcessEnv = process.env;
  if (!process.env.GOV_GIT_ROOT) {
    const { projectPath, agentWorkRoot } = buildContextInfo();
    const gitRoot = projectPath ?? (agentWorkRoot ? basesRoot(agentWorkRoot) : undefined);
    if (gitRoot) env = { ...process.env, GOV_GIT_ROOT: gitRoot };
    // Governed source-resolving verbs read from the shared .bases clones IN THE PLUGIN'S OWN PROCESS — the host
    // can't route each per-repo read through ensureBaseFresh, so it syncs all shared clones up-front here, for
    // the same never-stale guarantee. Best-effort (GOV_NO_SYNC bypass); offline must not block the deploy.
    if (!projectPath && agentWorkRoot && SOURCE_VERBS.has(argv[0] ?? "") && !("GOV_NO_SYNC" in process.env)) {
      process.stderr.write("gov: syncing shared base clones (.bases) before a governed source operation…\n");
      syncAllBases({ listBaseDirs, fetch: gitFetch }, agentWorkRoot);
    }
  }
  const r = spawnSync(cmd, [...prefix, ...argv], { stdio: "inherit", env });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    process.stderr.write(`gov: '${argv[0]}' is a governed command provided by the internal gov-cicd plugin, which isn't installed.\n  install it:  npm i -g @svayam/gov-cicd\n`);
    return 127;
  }
  return r.status ?? 1;
}

/** One operate verb the plugin contributes to the host's interactive menu (mirror of gov-cicd's MenuVerb). */
export interface OperateVerb {
  readonly cmd: string; readonly desc: string; readonly scopes: readonly ("project" | "governed")[];
  readonly argHint?: string;
  readonly flagArgs?: readonly { readonly name: string; readonly hint: string; readonly optional?: boolean; readonly kind?: "env" }[];
}

/** Discover the plugin's menu contribution at runtime (`gov-cicd menu --json`). Returns [] when the plugin
 *  is absent or too old to answer — the host menu then simply shows no governed verbs (clean OSS install). */
export function discoverOperateMenu(): OperateVerb[] {
  const { cmd, prefix } = resolveOperateCmd();
  const r = spawnSync(cmd, [...prefix, "menu", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (r.status !== 0 || !r.stdout) return [];
  try {
    const m = JSON.parse(r.stdout.trim()) as { verbs?: OperateVerb[] };
    return Array.isArray(m.verbs) ? m.verbs : [];
  } catch { return []; }
}

/** Resolve the gov-infra plugin's launcher (`@svayam/do-admin`, else `do-admin` on PATH). Same pure runtime
 *  discovery as the gov-cicd resolver — the infra plane is a peer plugin, not a build dependency. */
function resolveInfraCmd(): { cmd: string; prefix: string[] } {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("@svayam/do-admin/package.json");
    const pkg = JSON.parse(fsSync.readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string> };
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["do-admin"];
    if (rel) return { cmd: process.execPath, prefix: [path.join(path.dirname(pkgJson), rel)] };
  } catch { /* not a resolvable dep — try PATH */ }
  return { cmd: "do-admin", prefix: [] };
}

/** Discover the gov-infra plugin's menu contribution (`do-admin menu --json` → `{verbs}`). Returns [] when
 *  the plugin is absent or too old — the host menu then simply shows no Infra submenu (clean OSS install). */
export function discoverInfraMenu(): OperateVerb[] {
  const { cmd, prefix } = resolveInfraCmd();
  const r = spawnSync(cmd, [...prefix, "menu", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (r.status !== 0 || !r.stdout) return [];
  try {
    // Take the last JSON line (the plugin prints only the manifest to stdout, but be defensive).
    const line = r.stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
    const m = line ? (JSON.parse(line) as { verbs?: OperateVerb[] }) : {};
    return Array.isArray(m.verbs) ? m.verbs : [];
  } catch { return []; }
}

/** Run a gov-infra verb via the do-admin plugin: strip leading value-flags + the `infra` namespace token,
 *  pass the rest through (`gov infra vpn-mint-user alice` → `do-admin vpn-mint-user alice`). */
export function delegateToInfra(argv: readonly string[]): number {
  const { cmd, prefix } = resolveInfraCmd();
  const rest = argv.slice(firstCommandIndex(argv) + 1); // everything after `infra`
  const r = spawnSync(cmd, [...prefix, ...rest], { stdio: "inherit", env: process.env });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    process.stderr.write(`gov: 'infra ${rest[0] ?? ""}' is a governed infra verb provided by the gov-infra plugin (do-admin), which isn't installed.\n  install it:  npm i -g @svayam/do-admin\n`);
    return 127;
  }
  return r.status ?? 1;
}

/** The catalog's unit ids (`gov-cicd catalog --json`) — feeds the menu's unit picker. [] on any failure. */
export function discoverUnits(): string[] {
  const { cmd, prefix } = resolveOperateCmd();
  const r = spawnSync(cmd, [...prefix, "catalog", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (r.status !== 0 || !r.stdout) return [];
  try {
    // catalog runs the context banner to stderr (ignored) and the JSON to stdout — take the last JSON line.
    const line = r.stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
    const m = line ? (JSON.parse(line) as { units?: Array<{ id?: string }> }) : {};
    return (m.units ?? []).map((u) => u.id ?? "").filter(Boolean);
  } catch { return []; }
}
