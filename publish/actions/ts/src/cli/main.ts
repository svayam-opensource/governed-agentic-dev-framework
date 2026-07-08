// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `prj` bin composition (SDD-011) — assemble the real environment and route.
 * Resolve the gov workspace (model A, active-org anchored) → load org-config →
 * build the git/gh/fs adapters → run the command. `git`/`gh` are the only
 * external tools; no bash/python. This is the integration seam; the pure router
 * (dispatch.ts) is exhaustively unit-tested.
 */
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runSetup } from "../setup/setup-run.js";
import { readExistingOrgConfig } from "../setup/setup.js";
import { runMenu, type MenuContext, type MenuHandlers } from "./menu.js";
import { runWorkFlow } from "./work-flow.js";
import { prjResolveGov, resolveFailureMessage } from "../resolve/resolve-gov.js";
import { createNodeEnv, expandTilde } from "../resolve/node-env.js";
import { createNodeRegistryStore } from "../resolve/registry-store.js";
import { parseOrgConfig } from "../config/org-config.js";
import { assembleNeeds, credNeedForKey } from "../security/needs.js";
import { preflight, renderGap } from "../security/preflight.js";
import { runCreds } from "../security/creds-flow.js";
import { credentialsPath, getCredential, setCredential, listIdentities, identityExists, defaultIdentity } from "../security/credentials.js";
import { createNodeFs } from "../lifecycle/fs-io.js";
import { createGitVcs } from "../lifecycle/vcs.js";
import { createGhBoard, type RunGh } from "../lifecycle/gh-board.js";
import { createGhIssues } from "../lifecycle/issues.js";
import { createGhAnchor } from "../lifecycle/anchor.js";
import { createGhPulls } from "../lifecycle/pulls.js";
import { makeCloneRepo } from "../lifecycle/code-repo.js";
import { createGhProjects } from "../lifecycle/project-list.js";
import { runSuite } from "../governance/suite.js";
import { bumpVersion } from "../maintain/bump-version.js";
import { doctor, formatDoctorReport } from "../maintain/doctor.js";
import { checkDeps, formatDepsReport } from "../maintain/deps.js";
import { publishGate, formatPublishGate } from "../maintain/publish.js";
import { upgradePlan, formatUpgradePlan } from "../maintain/upgrade.js";
import { runUpgradeSync, runUpgradePr, fetchTemplateContent, DEFAULT_TEMPLATE } from "../maintain/upgrade-run.js";
import { RETIRE_PATHS } from "../maintain/upgrade-sync.js";
import { checkVersionCompat } from "../maintain/version-compat.js";
import { parseArgv, flagStr } from "./args.js";
import { route, routeOrg, type CliContext } from "./dispatch.js";

/** Run a command, swallowing failures (returns undefined). */
function tryRun(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * `gov-work setup` — the interactive workspace BOOTSTRAP (port of setup.sh). Async
 * (readline prompts), so bin.ts routes it here instead of through sync `main`.
 * Runs in cwd (the cloned framework repo), before any resolution.
 */
export async function runSetupCommand(argv: readonly string[], now: string = new Date().toISOString()): Promise<number> {
  const parsed = parseArgv(argv);
  const nonInteractiveFlag = !("error" in parsed) && "non-interactive" in parsed.flags;
  const fs = createNodeFs();
  const cwd = process.cwd();
  if (tryRun("git", ["-C", cwd, "rev-parse", "--git-dir"]) === undefined) {
    process.stderr.write("gov-work setup: not a git repository — clone the framework repo (or `git init`) first.\n");
    return 1;
  }
  const originUrl = tryRun("git", ["-C", cwd, "remote", "get-url", "origin"]) ?? "";
  const existingText = fs.readFile(path.join(cwd, "org-config.yaml"));
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string, def: string): Promise<string> =>
    new Promise((res) => rl.question(def ? `  ${q} [${def}]: ` : `  ${q}: `, (a) => res(a.trim() || def)));
  try {
    return await runSetup(
      {
        fs,
        cwd,
        originUrl,
        ghUser: tryRun("gh", ["api", "user", "--jq", ".login"]) ?? null,
        gitEmail: tryRun("git", ["-C", cwd, "config", "user.email"]) ?? null,
        today: now.slice(0, 10),
        existing: existingText ? readExistingOrgConfig(existingText) : undefined,
        prompt: ask,
        print: (l) => process.stdout.write(`${l}\n`),
        setOriginRemote: (url) => {
          try {
            execFileSync("git", ["-C", cwd, "remote", "set-url", "origin", url], { stdio: "ignore" });
          } catch {
            try {
              execFileSync("git", ["-C", cwd, "remote", "add", "origin", url], { stdio: "ignore" });
            } catch {
              /* leave remote as-is */
            }
          }
        },
      },
      !nonInteractiveFlag && process.stdin.isTTY,
    );
  } finally {
    rl.close();
  }
}

/** Read the CLI's own version from its package.json. Walks up from this module
 *  so it resolves in both the built layout (lib/esm/cli) and src-via-tsx. */
export function readCliVersion(): string {
  const fs = createNodeFs();
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 6; i++) {
    const raw = fs.readFile(path.join(dir, "package.json"));
    if (raw) {
      try {
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === "@svayam-opensource/gov-work" && pkg.version) return pkg.version;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "?";
}

/** Gather the best-effort banner context for the interactive menu (all optional). */
export async function gatherMenuContext(): Promise<MenuContext> {
  const fs = createNodeFs();
  const env = createNodeEnv();
  const cliVersion = readCliVersion();
  let orgName: string | undefined;
  let githubOrg: string | undefined;
  let branch: string | undefined;
  const resolve = prjResolveGov(env);
  if (resolve.ok) {
    const cfg = fs.readFile(path.join(resolve.home, "org-config.yaml"));
    if (cfg) {
      const c = parseOrgConfig(cfg);
      orgName = c.orgName || undefined;
      githubOrg = c.githubOrg || undefined;
      branch = c.defaultBranch || undefined;
    }
    branch = tryRun("git", ["-C", resolve.home, "rev-parse", "--abbrev-ref", "HEAD"]) ?? branch;
  }
  const user = tryRun("gh", ["api", "user", "--jq", ".login"]) ?? tryRun("git", ["config", "user.email"]) ?? undefined;
  let workspaceCount: number | undefined;
  try {
    workspaceCount = createNodeRegistryStore().readHomes().length;
  } catch {
    /* omit */
  }
  return { orgName, githubOrg, branch, user, workspaceCount, cliVersion };
}

/**
 * `gov-work creds` — the interactive GAP-filler (SDD credential-seam, client half). Resolves
 * the org work root, computes the base NEED/GAP for the chosen identity, and walks the
 * user through placing anything missing. Async (readline prompts); routed from bin.ts.
 */
export async function runCredsCommand(argv: readonly string[]): Promise<number> {
  const fs = createNodeFs();
  const resolve = prjResolveGov(createNodeEnv());
  if (!resolve.ok) { process.stderr.write("gov-work creds: no gov workspace resolved — run `gov-work onboard`/`gov-work setup` first.\n"); return 1; }
  const cfgText = fs.readFile(path.join(resolve.home, "org-config.yaml"));
  if (!cfgText) { process.stderr.write("gov-work creds: org-config.yaml not found.\n"); return 1; }
  const agentWorkRoot = parseOrgConfig(cfgText).agentWorkRoot;

  // `gov-work creds <KEY>` targets one credential (e.g. SVAYAM_GOV_LICENSE); bare `gov-work creds` walks
  // the base NEEDs (git/gh) + the enterprise license.
  const requestedKey = argv[1];
  const needs = requestedKey ? [credNeedForKey(requestedKey)] : [...assembleNeeds()];

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string, def?: string): Promise<string> =>
    new Promise((res) => rl.question(def ? `  ${q} [${def}]: ` : `  ${q}: `, (a) => res(a.trim() || (def ?? ""))));
  const ghAuthOk = (): boolean => { try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); return true; } catch { return false; } };
  try {
    const r = await runCreds({
      defaultIdentity: defaultIdentity(),
      needs,
      interactive: Boolean(process.stdin.isTTY),     // secrets only from a real terminal (never piped/agent)
      prompt: ask,
      print: (l) => process.stdout.write(`${l}\n`),
      listIdentities: () => listIdentities(agentWorkRoot),
      identityExists: (id) => identityExists(agentWorkRoot, id),
      makeProbes: (id) => {
        const file = credentialsPath(agentWorkRoot, id);
        return {
          gitConfig: (k) => tryRun("git", ["config", "--get", k]) || undefined,
          ghAuthOk,
          hasCred: (k) => getCredential(file, k) !== undefined,
        };
      },
      setCred: (id, key, value) => setCredential(credentialsPath(agentWorkRoot, id), key, value),
    });
    return r.stillMissing.length ? 1 : 0;
  } finally {
    rl.close();
  }
}

/** Route any command (setup / creds / normal) — used by the menu. */
export function runAny(argv: readonly string[]): Promise<number> | number {
  if (argv[0] === "setup") return runSetupCommand(argv);
  if (argv[0] === "creds") return runCredsCommand(argv);
  return main(argv);
}

/** The command reference shown under the Help menu (grouped) / per-command. */
export function helpLines(command?: string): string[] {
  if (command) return ["", `  gov-work ${command} — run \`gov-work ${command} --help\`, or see the README command reference.`, ""];
  const groups: Record<string, string[]> = {
    Lifecycle: ["seed", "join", "task", "merge", "sync", "add-repo", "close", "pause", "resume", "cancel"],
    Governance: ["manage", "anchor", "knowledge", "onboard", "org", "validate"],
    Info: ["list", "list-all", "status"],
    Maintain: ["setup", "doctor", "deps", "upgrade", "bump-version", "publish"],
    "Enterprise (plugin)": ["catalog", "deploy", "data", "promote", "rollback", "drift"],
  };
  const out = ["", "  gov command reference (run any directly: `gov-work <command> [args]`):"];
  for (const [g, cmds] of Object.entries(groups)) out.push(`    ${g.padEnd(20)} ${cmds.join(" · ")}`);
  out.push("");
  return out;
}

/** Build + run the interactive main menu (no-args TTY). Async — routed from bin.ts. */
export async function runMainMenu(): Promise<number> {
  const ctx = await gatherMenuContext();
  const fs = createNodeFs();
  const env = createNodeEnv();
  const runGh: RunGh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  // Operational deps for the guided Work flow (present only when a workspace resolves).
  const resolved = prjResolveGov(env);
  let workDeps: Parameters<typeof runWorkFlow>[0] | null = null;
  if (resolved.ok) {
    const cfgText = fs.readFile(path.join(resolved.home, "org-config.yaml"));
    if (cfgText) {
      const config = parseOrgConfig(cfgText);
      workDeps = {
        projects: createGhProjects(runGh),
        anchor: createGhAnchor(runGh),
        fs,
        config: { githubOrg: config.githubOrg, workspaceRepo: config.workspaceRepo, agentWorkRoot: config.agentWorkRoot },
        me: ctx.user ?? null,
        canWriteBoard: (n) =>
          tryRun("gh", ["api", "graphql", "-f", "query=query($o:String!,$n:Int!){organization(login:$o){projectV2(number:$n){viewerCanUpdate}}}", "-F", `o=${config.githubOrg}`, "-F", `n=${n}`, "--jq", ".data.organization.projectV2.viewerCanUpdate"]) !== "false",
        run: runAny,
        prompt: async () => "",
        print: () => {},
      };
    }
  }

  const handlers: MenuHandlers = {
    runCommand: runAny,
    runWork: async (io) => {
      if (!workDeps) {
        io.print("  No governance workspace resolved. Set one up first: `gov-work setup`, then `gov-work org add/use`.");
        return 1;
      }
      return runWorkFlow({ ...workDeps, prompt: io.prompt, print: io.print });
    },
    switchOrg: (org) => runAny(["org", "use", org]),
    help: (command) => helpLines(command),
  };
  return runMenu(ctx, handlers);
}


/**
 * The `gov-work` entry point. Returns a process exit code. `now` is injected (an
 * ISO-8601 instant) so the composition stays deterministic + testable.
 */
export function main(argv: readonly string[], now: string = new Date().toISOString()): number {
  const parsed = parseArgv(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return 2;
  }

  const fs = createNodeFs();

  // `prj bump-version <x.y.z>` maintains the PACKAGE (cwd), not a gov workspace —
  // runs before resolution.
  if (parsed.command === "bump-version") {
    const r = bumpVersion(fs, process.cwd(), parsed.positionals[0] ?? "");
    if (r.ok) {
      process.stdout.write(`bumped → ${r.version} (${r.written.join(", ")})\n`);
      return 0;
    }
    process.stderr.write(`${r.error}\n`);
    return r.code;
  }

  // `gov-work deps` — report runtime prerequisites (git/gh); pre-resolve.
  if (parsed.command === "deps") {
    const report = checkDeps((n) => tryRun(n, ["--version"]) !== undefined, process.platform);
    for (const line of formatDepsReport(report)) process.stdout.write(`${line}\n`);
    return report.ok ? 0 : 1;
  }

  // `prj publish` — the pre-publish GATE (version-sync); never publishes by hand.
  if (parsed.command === "publish") {
    const gate = publishGate(fs, process.cwd());
    for (const line of formatPublishGate(gate)) process.stdout.write(`${line}\n`);
    return gate.ok ? 0 : 1;
  }

  // `gov-work upgrade --from <content-dir> [--apply]` — overlay-sync an adopter
  // workspace to the published content (dry-run by default). Without --from it's
  // the CLI self-update guidance.
  if (parsed.command === "upgrade") {
    const from = flagStr(parsed.flags, "from");
    // Content sync (fetch from the template, or --from a local dir) unless a
    // positional version was given (that's CLI self-update guidance).
    const contentSync = from !== undefined || "pr" in parsed.flags || "apply" in parsed.flags || "template" in parsed.flags || "ref" in parsed.flags || parsed.positionals.length === 0;
    if (contentSync) {
      const env = createNodeEnv();
      const govHomeOverride = flagStr(parsed.flags, "gov-home") ?? process.env.PRJ_GOV_HOME;
      let home: string;
      if (govHomeOverride) {
        home = path.resolve(expandTilde(govHomeOverride));
      } else {
        const resolved = prjResolveGov(env);
        if (!resolved.ok) {
          process.stderr.write(`${resolveFailureMessage(resolved)}\n`);
          return resolved.code;
        }
        home = resolved.home;
      }
      let contentDir: string;
      let cleanup = (): void => {};
      if (from) {
        contentDir = path.resolve(expandTilde(from));
      } else {
        const template = flagStr(parsed.flags, "template") ?? DEFAULT_TEMPLATE;
        const ref = flagStr(parsed.flags, "ref") ?? "main";
        process.stderr.write(`fetching content from ${template}@${ref} …\n`);
        try {
          const fetched = fetchTemplateContent(template, ref);
          contentDir = fetched.contentDir;
          cleanup = fetched.cleanup;
        } catch (e) {
          process.stderr.write(`gov-work upgrade: ${(e as Error).message}\n`);
          return 1;
        }
      }
      try {
        const res = "pr" in parsed.flags
          ? runUpgradePr(contentDir, home, { branch: flagStr(parsed.flags, "branch") })
          : runUpgradeSync(contentDir, home, { apply: "apply" in parsed.flags });
        for (const line of res.lines) process.stdout.write(`${line}\n`);
        return res.code;
      } finally {
        cleanup();
      }
    }
    let cliVersion = "0.0.0";
    try {
      const pkg = fs.readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)));
      if (pkg) cliVersion = (JSON.parse(pkg) as { version?: string }).version ?? "0.0.0";
    } catch {
      /* keep default */
    }
    const plan = upgradePlan(cliVersion, parsed.positionals[0] ?? null);
    for (const line of formatUpgradePlan(plan)) process.stdout.write(`${line}\n`);
    return plan.kind === "error" ? 2 : 0;
  }

  const env = createNodeEnv();

  // `gov doctor` reports on the environment (incl. whether resolution works), so
  // it runs pre-resolve too.
  if (parsed.command === "doctor") {
    const resolve = prjResolveGov(env);
    let cliVersion = "unknown";
    try {
      const pkg = fs.readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)));
      if (pkg) cliVersion = (JSON.parse(pkg) as { version?: string }).version ?? "unknown";
    } catch {
      /* leave "unknown" */
    }
    const doctorHomeOverride = flagStr(parsed.flags, "gov-home") ?? process.env.PRJ_GOV_HOME;
    const home = doctorHomeOverride ? path.resolve(expandTilde(doctorHomeOverride)) : resolve.ok ? resolve.home : process.cwd();
    const report = doctor({
      gitPresent: tryRun("git", ["--version"]) !== undefined,
      ghPresent: tryRun("gh", ["--version"]) !== undefined,
      resolve,
      activeOrg: env.readActiveOrg(),
      cliVersion,
      contentVersion: fs.readFile(path.join(home, "VERSION"))?.trim() ?? null,
      staleArtifacts: RETIRE_PATHS.filter((rp) => fs.pathExists(path.join(home, rp.replace(/\/$/, "")))),
    });
    for (const line of formatDoctorReport(report)) process.stdout.write(`${line}\n`);
    return report.ok ? 0 : 1;
  }

  // `prj org …` runs BEFORE resolution — it's the bootstrap that makes resolution
  // work (registering a gov home / selecting the active org).
  if (parsed.command === "org") {
    const orgResult = routeOrg(parsed.positionals, { store: createNodeRegistryStore(), govConfigAt: (p) => env.govConfigAt(p) });
    for (const line of orgResult.lines) process.stdout.write(`${line}\n`);
    return orgResult.code;
  }

  // Resolve the gov workspace (the gov home for seed, the project clone otherwise).
  // `--gov-home <path>` / $PRJ_GOV_HOME target an EXPLICIT gov workspace and skip
  // the registry/resolver (for testing, CI, or a throwaway workspace). Unlike the
  // bash `$ADF_WORKSPACE` this is a per-invocation flag, so it can't stale-misdirect.
  const govHomeOverride = flagStr(parsed.flags, "gov-home") ?? process.env.PRJ_GOV_HOME;
  let home: string;
  if (govHomeOverride) {
    home = path.resolve(expandTilde(govHomeOverride));
  } else {
    const resolved = prjResolveGov(env);
    if (!resolved.ok) {
      process.stderr.write(`${resolveFailureMessage(resolved)}\n`);
      return resolved.code;
    }
    home = resolved.home;
  }

  const cfgText = fs.readFile(path.join(home, "org-config.yaml"));
  if (cfgText === null) {
    process.stderr.write(`prj: no org-config.yaml at ${home}\n`);
    return 1;
  }
  const config = parseOrgConfig(cfgText);

  // `gov-work validate` — run the governance validate suite on the resolved workspace.
  if (parsed.command === "validate") {
    const files = (tryRun("git", ["-C", home, "ls-files"]) ?? "").split("\n").filter(Boolean);
    const r = runSuite({ fs, repoRoot: home, files });
    if (r.ok) {
      process.stdout.write("validate: PASS (all validators)\n");
      return 0;
    }
    process.stdout.write("validate: FAIL\n");
    for (const f of r.failures) process.stdout.write(`  - ${f}\n`);
    return 1;
  }

  // CLI ↔ content version guard (preflight): a MAJOR-behind CLI must not operate
  // on newer content — it may misread the layout. Smaller gaps just warn.
  {
    let cliVersion = "0.0.0";
    try {
      const pkg = fs.readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)));
      if (pkg) cliVersion = (JSON.parse(pkg) as { version?: string }).version ?? "0.0.0";
    } catch {
      /* keep default */
    }
    const compat = checkVersionCompat(cliVersion, fs.readFile(path.join(home, "VERSION"))?.trim() ?? null);
    if (!compat.ok) {
      process.stderr.write(`${compat.message}\n`);
      return 1;
    }
    if (compat.status === "cli-behind" || compat.status === "content-behind") {
      process.stderr.write(`gov: ${compat.message}\n`);
    }
  }

  // Capture (don't inherit) stderr so best-effort gh failures — e.g. an
  // unsupported board op — don't spew gh's usage text to the terminal.
  const runGh: RunGh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const vcs = createGitVcs();
  const seededBy = tryRun("git", ["-C", home, "config", "user.email"]) ?? "";
  const name = tryRun("git", ["-C", home, "config", "user.name"]);
  const login = tryRun("gh", ["api", "user", "--jq", ".login"]);

  const ctx: CliContext = {
    config,
    home,
    today: now.slice(0, 10),
    seededBy,
    login,
    identity: name || seededBy ? { name, email: seededBy || undefined } : undefined,
    board: createGhBoard(runGh),
    vcs,
    fs,
    issues: createGhIssues(runGh),
    anchor: createGhAnchor(runGh),
    pulls: createGhPulls(runGh),
    projects: createGhProjects(runGh),
    cloneRepo: makeCloneRepo(vcs, { rmDir: (d) => fs.rm(d) }),
    gate: () => runSuite({ fs, repoRoot: home, files: (tryRun("git", ["-C", home, "ls-files"]) ?? "").split("\n").filter(Boolean) }),
    log: (m) => process.stderr.write(`${m}\n`),
  };

  // Security PREFLIGHT (NEED/GAP): before a route-dispatched command runs, block if its
  // identity/authorization isn't in place, pointing at `gov-work creds`. Base NEEDs (git commit
  // identity, gh auth) apply here; command/plugin-specific NEEDs join as those paths grow.
  // Silent no-op on a healthy machine. $GOV_SKIP_PREFLIGHT bypasses it for non-interactive
  // automation that provisions creds out-of-band.
  if (!("GOV_SKIP_PREFLIGHT" in process.env)) {
    const credFile = credentialsPath(config.agentWorkRoot, defaultIdentity());
    const pf = preflight(assembleNeeds(), {
      gitConfig: (k) => tryRun("git", ["-C", home, "config", "--get", k]) || undefined,
      ghAuthOk: () => { try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); return true; } catch { return false; } },
      hasCred: (k) => getCredential(credFile, k) !== undefined,
    });
    if (!pf.ok) {
      for (const line of renderGap(pf.gap)) process.stderr.write(`${line}\n`);
      return 3;
    }
  }

  const result = route(parsed, ctx);
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  return result.code;
}
