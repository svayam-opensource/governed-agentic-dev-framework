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
import * as os from "node:os";
import * as fsSync from "node:fs";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { runSetup } from "../setup/setup-run.js";
import { readExistingOrgConfig } from "../setup/setup.js";
import { parseTarget, preflight as createPreflight, explainFailure, type CreateIo } from "../setup/create.js";
import { runMenu, type MenuContext, type MenuHandlers } from "./menu.js";
import { runWorkFlow, myProjects, agentLaunchSpec, type AgentKind } from "./work-flow.js";
import { prjResolveGov, resolveFailureMessage } from "../resolve/resolve-gov.js";
import { createNodeEnv, expandTilde } from "../resolve/node-env.js";
import { createNodeRegistryStore } from "../resolve/registry-store.js";
import { parseOrgConfig } from "../config/org-config.js";
import { assembleNeeds } from "../security/needs.js";
import { preflight, renderGap } from "../security/preflight.js";
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
import { runFirstRun, type FirstRunIo, type OrgIdentity } from "./bootstrap.js";
import { parseArgv, flagStr } from "./args.js";
import { route, routeOrg, type CliContext } from "./dispatch.js";
import { orgAdd, orgUse } from "../resolve/org.js";
import { PACKAGE_NAME } from "../index.js";

/** Run a command, swallowing failures (returns undefined). */
function tryRun(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/** The template every governance repo is created from. */
const TEMPLATE_REPO = "svayam-opensource/governed-agentic-dev-framework";

/**
 * `gov setup <org>/<repo>` — create the repo, clone it, and hand back the clone for the normal setup
 * flow to configure (#159).
 *
 * Returns the cloned path, or an exit code when it refused.
 *
 * NOTHING REMOTE HAPPENS UNTIL PREFLIGHT PASSES. `gh` cannot delete a repository without `delete_repo`,
 * which a normal `gh auth login` does not grant, so a half-made repo in someone's org is not recoverable
 * by this tool. The org slug is asked first because it is what decides where the clone goes (contract R9)
 * — there is no point creating anything before we know that.
 */
async function runCreateWorkspace(rawTarget: string, flags: Record<string, string | boolean>): Promise<string | number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string, def: string): Promise<string> =>
    new Promise((res) => rl.question(def ? `  ${q} [${def}]: ` : `  ${q}: `, (a) => res(a.trim() || def)));
  const io: CreateIo = {
    gh: (args) => tryRun("gh", [...args]) ?? null,
    home: os.homedir(),
    exists: (p) => fsSync.existsSync(p),
    print: (l) => process.stdout.write(`${l}\n`),
  };
  try {
    const parsedTarget = parseTarget(rawTarget);
    // Asked before anything is created, because the slug decides the location (R9). Defaulted from the
    // GitHub org so the common case is one keypress.
    const defaultSlug = (parsedTarget?.org ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
    const slug = parsedTarget ? await ask("Org slug (uppercase, 2-6 chars; e.g. ACME)", defaultSlug) : defaultSlug;

    const pathFlag = typeof flags["path"] === "string" ? (flags["path"] as string) : undefined;
    const pre = createPreflight(io, rawTarget, slug, pathFlag);
    if (!pre.ok) {
      for (const line of explainFailure(pre.failure)) process.stderr.write(`${line}\n`);
      return 1;
    }
    for (const w of pre.warnings) process.stdout.write(`  ⚠ ${w.detail}\n`);

    const { target, govRepo } = pre;
    const full = `${target.org}/${target.repo}`;
    process.stdout.write(`  creating ${full} from ${TEMPLATE_REPO} (private)…\n`);
    if (tryRun("gh", ["repo", "create", full, "--template", TEMPLATE_REPO, "--private"]) === undefined) {
      process.stderr.write(`gov setup: creating ${full} failed. Nothing was cloned.\n`);
      return 1;
    }
    fsSync.mkdirSync(path.dirname(govRepo), { recursive: true });
    process.stdout.write(`  cloning to ${govRepo}…\n`);
    if (tryRun("gh", ["repo", "clone", full, govRepo]) === undefined) {
      // The repo EXISTS now and cannot be deleted back. Say so plainly and name the resume path, rather
      // than leaving the adopter to work out that re-running is safe.
      process.stderr.write(`gov setup: ${full} was created but could not be cloned.\n`);
      process.stderr.write(`  it still exists — re-run 'gov setup ${full}' to resume, or clone it yourself.\n`);
      return 1;
    }
    return govRepo;
  } finally {
    rl.close();
  }
}

/**
 * `gov setup` — the interactive workspace BOOTSTRAP (port of setup.sh). Async
 * (readline prompts), so bin.ts routes it here instead of through resolution.
 * Runs in cwd (the cloned framework repo), before any resolution.
 */
export async function runSetupCommand(
  argv: readonly string[],
  now: string = new Date().toISOString(),
  cwd: string = process.cwd(),
): Promise<number> {
  const parsed = parseArgv(argv);
  const nonInteractiveFlag = !("error" in parsed) && "non-interactive" in parsed.flags;
  const fs = createNodeFs();
  let createdHome: string | null = null;

  // ONE VERB, THE ARGUMENT DECIDES (#159). A positional `<org>/<repo>` means CREATE; its absence means
  // configure the workspace we are in, exactly as before. `--non-interactive` never creates, whatever
  // the cwd — creation must never be inferred from location, so a CI re-run cannot make a repository.
  const positional = "error" in parsed ? [] : parsed.positionals;
  if (positional.length > 0 && !nonInteractiveFlag) {
    const created = await runCreateWorkspace(positional[0], "error" in parsed ? {} : parsed.flags);
    if (typeof created === "number") return created;
    cwd = created;                                  // continue into the normal flow, inside the new clone
    createdHome = created;
  }

  if (tryRun("git", ["-C", cwd, "rev-parse", "--git-dir"]) === undefined) {
    process.stderr.write("gov setup: not a git repository — clone your governance repo first, or create one with `gov setup <org>/<repo>`.\n");
    return 1;
  }
  const originUrl = tryRun("git", ["-C", cwd, "remote", "get-url", "origin"]) ?? "";
  const existingText = fs.readFile(path.join(cwd, "org-config.yaml"));
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string, def: string): Promise<string> =>
    new Promise((res) => rl.question(def ? `  ${q} [${def}]: ` : `  ${q}: `, (a) => res(a.trim() || def)));
  try {
    const rc = await runSetup(
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

    // REGISTER WHAT WE JUST CREATED. Registration used to happen only in the first-run flow, which is
    // skipped when an active org already exists — so `gov setup <org>/<repo>` produced a configured
    // workspace the registry had never heard of. Every governance read resolves through the registry
    // (workspace-resolution contract R2), so an unregistered workspace only works from inside its own
    // directory: exactly the location-dependence this command exists to remove, and the README promises
    // is gone.
    if (createdHome !== null && rc === 0) {
      const env = createNodeEnv();
      const deps = { store: createNodeRegistryStore(), govConfigAt: (p: string) => env.govConfigAt(p) };
      const cfg = env.govConfigAt(createdHome);
      if (cfg) {
        const added = orgAdd(deps, cfg.org, createdHome);
        const used = added.ok ? orgUse(deps, cfg.org) : added;
        process.stdout.write(used.ok
          ? `  registered ${cfg.org} → ${createdHome} (active)\n`
          : `  ⚠ could not register the workspace: ${used.message}\n     fix with: gov org add ${cfg.org} --home ${createdHome}\n`);
      }
    }
    return rc;
  } finally {
    rl.close();
  }
}

/**
 * FIRST RUN — the real environment behind {@link runFirstRun}. Returns null when an org is already
 * registered and active, which is the overwhelmingly common case and costs two file reads.
 *
 * Everything interesting lives in bootstrap.ts, which knows nothing about git, disks or terminals. This
 * function is the part that cannot be unit-tested, so it is kept to plumbing with no decisions in it.
 */
export async function runFirstRunIfNeeded(now: string = new Date().toISOString()): Promise<number | null> {
  const store = createNodeRegistryStore();
  const homes = store.readHomes();
  const facts = {
    orgs: homes.map((h) => h.org),
    active: store.readActiveOrg(),
    interactive: process.stdin.isTTY === true,
  };
  // The common path: decided from the registry alone, before a readline interface is opened.
  if (facts.active && facts.orgs.includes(facts.active)) return null;
  if (facts.orgs.length === 1) return null;

  const env = createNodeEnv();
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const identityAt = (repoDir: string): OrgIdentity | null => {
    const cfg = env.govConfigAt(repoDir);
    if (!cfg) return null;
    const text = fsSync.readFileSync(path.join(repoDir, "org-config.yaml"), "utf8");
    const slug = parseOrgConfig(text).orgSlug;
    return slug ? { org: cfg.org, orgSlug: slug } : null;
  };
  const io: FirstRunIo = {
    facts,
    homeDir: os.homedir(),
    prompt: (q, def) => new Promise((res) => rl.question(def ? `  ${q}[${def}] ` : `  ${q}`, (a) => res(a.trim() || def))),
    print: (l) => process.stderr.write(`${l}\n`),
    tempDir: () => fsSync.mkdtempSync(path.join(os.tmpdir(), "gov-firstrun-")),
    clone: (url, dest) => { execFileSync("git", ["clone", url, dest], { stdio: ["ignore", "ignore", "inherit"] }); },
    readIdentity: identityAt,
    exists: (d) => fsSync.existsSync(d),
    place: (from, to) => { fsSync.mkdirSync(path.dirname(to), { recursive: true }); fsSync.renameSync(from, to); },
    discard: (d) => { try { fsSync.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } },
    found: async (repoDir) => (await runSetupCommand([], now, repoDir)) === 0 ? identityAt(repoDir) : null,
    register: (org, home) => {
      const deps = { store, govConfigAt: (p: string) => env.govConfigAt(p) };
      const added = orgAdd(deps, org, home);
      if (!added.ok) return { ok: false, message: added.message };
      const used = orgUse(deps, org);
      return used.ok ? { ok: true } : { ok: false, message: used.message };
    },
    activate: (org) => {
      const used = orgUse({ store, govConfigAt: (p: string) => env.govConfigAt(p) }, org);
      return used.ok ? { ok: true } : { ok: false, message: used.message };
    },
  };
  try {
    return await runFirstRun(io);
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
        if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version;
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
  let agentWorkRoot: string | undefined;
  let mode: "project" | "governed" | "none" = "none";
  const resolve = prjResolveGov(env);
  if (resolve.ok) {
    mode = "governed";
    const cfg = fs.readFile(path.join(resolve.home, "org-config.yaml"));
    if (cfg) {
      const c = parseOrgConfig(cfg);
      orgName = c.orgName || undefined;
      githubOrg = c.githubOrg || undefined;
      branch = c.defaultBranch || undefined;
      agentWorkRoot = c.agentWorkRoot || undefined;
    }
    branch = tryRun("git", ["-C", resolve.home, "rev-parse", "--abbrev-ref", "HEAD"]) ?? branch;
  }
  // PROJECT context = cwd is inside a project dir under agent_work_root.
  let project: string | undefined;
  if (agentWorkRoot && process.cwd().startsWith(agentWorkRoot + path.sep)) {
    const seg = path.relative(agentWorkRoot, process.cwd()).split(path.sep)[0];
    if (seg) { mode = "project"; project = seg; }
  }
  const user = tryRun("gh", ["api", "user", "--jq", ".login"]) ?? tryRun("git", ["config", "user.email"]) ?? undefined;
  let workspaceCount: number | undefined;
  try {
    workspaceCount = createNodeRegistryStore().readHomes().length;
  } catch {
    /* omit */
  }
  return { orgName, githubOrg, branch, user, workspaceCount, cliVersion, mode, project };
}

/**
 * The guided Work flow's operational deps — ONE construction, used by the menu and by `gov work`.
 *
 * Built twice, they drift: the menu would launch an agent one way and the verb another, and the difference
 * would show up as "it works from the menu but not from the command", which is a bad hour for whoever hits
 * it. `null` when no workspace resolves — the caller says what to do about that, because the answer differs
 * (the menu offers setup; the verb prints and exits).
 */
function buildWorkDeps(me: string | null): Parameters<typeof runWorkFlow>[0] | null {
  const fs = createNodeFs();
  const env = createNodeEnv();
  const runGh: RunGh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const resolved = prjResolveGov(env);
  if (!resolved.ok) return null;
  const cfgText = fs.readFile(path.join(resolved.home, "org-config.yaml"));
  if (!cfgText) return null;
  const config = parseOrgConfig(cfgText);
  return {
    projects: createGhProjects(runGh),
    anchor: createGhAnchor(runGh),
    fs,
    config: { githubOrg: config.githubOrg, workspaceRepo: config.workspaceRepo, agentWorkRoot: config.agentWorkRoot },
    me,
    canWriteBoard: (n) =>
      tryRun("gh", ["api", "graphql", "-f", "query=query($o:String!,$n:Int!){organization(login:$o){projectV2(number:$n){viewerCanUpdate}}}", "-F", `o=${config.githubOrg}`, "-F", `n=${n}`, "--jq", ".data.organization.projectV2.viewerCanUpdate"]) !== "false",
    run: runAny,
    prompt: async () => "",
    print: () => {},
    // stdout carries the prompt and NOTHING else, so `--print-prompt` can be captured or piped; every other
    // line the flow writes goes to stderr through `print`.
    printPrompt: (prompt) => process.stdout.write(`${prompt}\n`),
    // Launch with cwd = the project dir via the tested spec: detached (GUI editor) opens and returns;
    // a terminal agent or shell inherits stdio and blocks until it exits.
    launch: async (agent, cwd, inject) => {
      const s = agentLaunchSpec(agent, cwd, inject);
      if (s.detached) { spawn(s.cmd, [...s.args], { cwd, stdio: "ignore", detached: true }).unref(); return 0; }
      const r = spawnSync(s.cmd, [...s.args], { cwd, stdio: "inherit" });
      if (r.error) { process.stderr.write(`  could not launch '${s.cmd}' — is it installed and on PATH?\n`); return 1; }
      return r.status ?? 0;
    },
  };
}

/**
 * `gov work [--project=<regex>] [--agent=<kind>] [--seed] [--print-prompt]` — the one command.
 *
 * It walks the state ladder and does the missing rungs: not cloned → join; not started → seed (with
 * consent); ready → launch the agent with the session-start prompt. Both flags are optional; supply both
 * and it runs start to finish without a prompt, which is what makes it usable from a script.
 *
 * WITH NO TERMINAL, an unresolved choice FAILS NAMING THE FLAG that would have resolved it. It does not
 * guess a project or an agent: there is nobody to correct a wrong guess, and a session started on the wrong
 * project is worse than no session.
 */
export async function runWork(argv: readonly string[]): Promise<number> {
  const flagOf = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1] : undefined;
  };
  const me = tryRun("gh", ["api", "user", "--jq", ".login"]) ?? tryRun("git", ["config", "user.email"]) ?? null;
  const deps = buildWorkDeps(me);
  if (!deps) {
    // Reachable only when the first run was skipped or declined (see runFirstRunIfNeeded), or when the
    // registry resolves but org-config.yaml does not.
    process.stderr.write("no organization is registered on this machine yet — run `gov` in a terminal to set one up.\n");
    return 1;
  }
  // A positional project id still works (`gov work PRJ-43-…`), because it did before and breaking it would
  // buy nothing; `--project` is the pattern form.
  const positional = argv.slice(1).find((a) => !a.startsWith("--"));
  const pattern = flagOf("project") ?? positional;
  const agent = flagOf("agent");
  const interactive = process.stdin.isTTY === true;
  // Prompts and progress go to STDERR; stdout is reserved for `--print-prompt`'s single line.
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const prompt = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
  try {
    return await runWorkFlow(
      { ...deps, prompt, print: (l) => process.stderr.write(`${l}\n`) },
    {
      ...(pattern ? { projectPattern: pattern } : {}),
      ...(agent ? { agent: agent as AgentKind } : {}),
      seedOk: argv.includes("--seed"),
      printPromptOnly: argv.includes("--print-prompt"),
      interactive,
      },
    );
  } finally { rl.close(); }
}

/** Route any command (setup / normal) — used by the menu. There is no plugin routing: `auth`, `creds`,
 *  the deploy verbs and the infra verbs belong to the other clients and are invoked directly
 *  (adr-three-clients, PRJ-43). */
export function runAny(argv: readonly string[]): Promise<number> | number {
  if (argv[0] === "setup") return runSetupCommand(argv);
  return main(argv);
}

/** The command reference (git-help style): one-line description per command + optional usage args. */
/**
 * The command reference, grouped by WHO TYPES IT (PRJ-43 CLI-surface walkthrough, 2026-08-07).
 *
 * It used to be four groups of ~27 verbs, all presented as equally yours. Almost none of them are: a
 * developer works inside an agent session, and the lifecycle verbs are what the AGENT runs when asked. So
 * the reference now says which is which, rather than making everyone learn the difference by trying.
 *
 * Nothing is removed — every verb still runs. `seed`, `join`, `task`, `merge` and the rest are reachable
 * for recovery, for scripts, and for the day the agent cannot start. They are simply no longer taught as
 * the way in.
 */
const HELP_GROUPS: Record<string, string[]> = {
  "Your commands": ["work", "org", "doctor", "upgrade"],
  "Your agent runs these (you can too)": [
    "seed", "join", "task", "merge", "sync", "add-repo", "close", "pause", "resume", "cancel",
    "manage", "anchor", "knowledge", "onboard", "validate", "list", "list-all", "status",
  ],
  "Framework maintainers": ["bump-version", "publish"],
};
const CMD_DESC: Record<string, string> = {
  seed: "Seed a new project workspace from a GitHub Project board", join: "Join an existing project (clone its repos on the project branch)",
  work: "Start a session on a project — picks it up wherever it is, and launches your agent",
  task: "Create a task issue + sub-branch on the current project", merge: "Land a task sub-branch back to the project branch",
  sync: "Sync the project branch with upstream changes", "add-repo": "Add a code repository to the current project",
  close: "Close a completed project (closes its board)", pause: "Pause the current project", resume: "Resume a paused project", cancel: "Cancel the current project",
  manage: "Project access — assign / unassign owners", anchor: "Show the current project's anchor issue",
  knowledge: "Propose / submit / archive org knowledge changes", onboard: "Onboard a repository into the framework",
  org: "Manage governance workspaces (the active org)", validate: "Validate the workspace / shipped content",
  list: "List YOUR active projects", "list-all": "List ALL org projects (owners = anchor assignees)", status: "Show the current project's status",
  doctor: "Diagnose this machine: git · gh · workspace · active org · versions",
  upgrade: "Pull the latest framework CONTENT into this org (not the CLI — that is `npm i -g`)", "bump-version": "Bump the CLI + content version (maintainers)", publish: "Publish gate (maintainers)",
};
const CMD_USAGE: Record<string, string> = {
  seed: "<board-url> [--assignee <login>]", work: "[<project-id>] [--print-prompt]", "add-repo": "<repo-url> [--base-branch <branch>]", manage: "<assign|unassign> <github-login>",
  knowledge: '<propose|submit|archive> <slug> [--description "<text>"]', onboard: '<repo-url> --owner <owner> --description "<text>"',
  org: "add <github_org> --home <path> | use|list|remove <github_org>",
  upgrade: "[--ref <branch>] [--from <dir>] [--apply]", "bump-version": "<x.y.z>",
};

/** All commands in reference order (for the Help → "help for one command" picker). */
export const helpCommandNames = (): string[] => Object.values(HELP_GROUPS).flat();

/** The command reference shown under the Help menu (git-help style), or per-command help. */
export function helpLines(command?: string): string[] {
  if (command) {
    const desc = CMD_DESC[command];
    if (!desc) return ["", `  Unknown command '${command}'. Run \`gov help\` for the reference.`, ""];
    const out = ["", `  gov ${command} — ${desc}.`];
    if (CMD_USAGE[command]) out.push(`  usage: gov ${command} ${CMD_USAGE[command]}`);
    out.push("");
    return out;
  }
  const out = ["", "  usage: gov <command> [<args>]", "", "  These are the gov commands used in various situations:", ""];
  for (const [g, cmds] of Object.entries(HELP_GROUPS)) {
    out.push(`  ${g}`);
    for (const c of cmds) out.push(`     ${c.padEnd(14)} ${CMD_DESC[c] ?? ""}`);
    out.push("");
  }
  out.push("  See `gov help <command>` for a specific command (or menu → Help → help for one command).", "");
  return out;
}

/** Build + run the interactive main menu (no-args TTY). Async — routed from bin.ts. */
export async function runMainMenu(): Promise<number> {
  const ctx = await gatherMenuContext();
  // fs/env/runGh moved into buildWorkDeps with the deps they served — the menu itself needs none of them.
  const workDeps = buildWorkDeps(ctx.user ?? null);

  const handlers: MenuHandlers = {
    runCommand: runAny,
    runWork: async (io) => {
      if (!workDeps) {
        io.print("  No governance workspace resolved. Set one up first: `gov setup`, then `gov org add/use`.");
        return 1;
      }
      return runWorkFlow({ ...workDeps, prompt: io.prompt, print: io.print });
    },
    switchOrg: (org) => runAny(["org", "use", org]),
    help: (command) => helpLines(command),
    helpCommands: helpCommandNames,
    listOrgs: () => { try { return createNodeRegistryStore().readHomes(); } catch { return []; } },
    listMyProjects: () => { try { return workDeps ? myProjects(workDeps).map((p) => p.projectId) : []; } catch { return []; } },
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

  // `gov deps` — report runtime prerequisites (git/gh); pre-resolve.
  // `deps` folded into `doctor` (PRJ-43, 2026-08-07): doctor already probes git and gh, so two verbs were
  // answering one question. Kept working, and it says where it went — a removed command that only prints
  // "unknown" costs whoever typed it next.
  if (parsed.command === "deps") {
    process.stderr.write("gov deps is now part of `gov doctor` — it reports the same prerequisites.\n  run:  gov doctor\n");
    return 2;
  }

  // `prj publish` — the pre-publish GATE (version-sync); never publishes by hand.
  if (parsed.command === "publish") {
    const gate = publishGate(fs, process.cwd());
    for (const line of formatPublishGate(gate)) process.stdout.write(`${line}\n`);
    return gate.ok ? 0 : 1;
  }

  // `gov upgrade --from <content-dir> [--apply]` — overlay-sync an adopter
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
          process.stderr.write(`gov upgrade: ${(e as Error).message}\n`);
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
    // The prerequisite report `deps` used to print — same probe, same per-OS install hints, now in the one
    // place a person looks when something is wrong.
    const depsReport = checkDeps((n) => tryRun(n, ["--version"]) !== undefined, process.platform);
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
    // Only when something IS missing: a healthy machine does not need install instructions, and a report
    // that prints them anyway trains the reader to skim past the part that matters.
    if (!depsReport.ok) {
      process.stdout.write("\n");
      for (const line of formatDepsReport(depsReport)) process.stdout.write(`${line}\n`);
    }
    return report.ok && depsReport.ok ? 0 : 1;
  }

  // `prj org …` runs BEFORE resolution — it's the bootstrap that makes resolution
  // work (registering a gov home / selecting the active org).
  if (parsed.command === "org") {
    const orgResult = routeOrg(parsed.positionals, parsed.flags, { store: createNodeRegistryStore(), govConfigAt: (p) => env.govConfigAt(p) });
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

  // `gov validate` — run the governance validate suite on the resolved workspace.
  if (parsed.command === "validate") {
    const files = (tryRun("git", ["-C", home, "ls-files"]) ?? "").split("\n").filter(Boolean);
    // THE CHANGED SCOPE — what this branch touches, so POL-408 is enforced on docs you WROTE without
    // failing on the 205 historical ones (governance/project-knowledge.ts explains why that matters).
    // Uncommitted work counts: the point is to catch a broken doc BEFORE it is pushed. `--base` overrides
    // the comparison point; the merge-base with the default branch is the sensible default on a project
    // branch. If git answers nothing, the scope is empty and the validator stays silent — it never guesses.
    const base = flagStr(parsed.flags, "base") ?? "main";
    const mergeBase = tryRun("git", ["-C", home, "merge-base", "HEAD", base]) ?? base;
    const committed = (tryRun("git", ["-C", home, "diff", "--name-only", mergeBase]) ?? "").split("\n");
    const working = (tryRun("git", ["-C", home, "status", "--porcelain"]) ?? "")
      .split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    const changedFiles = [...new Set([...committed, ...working])].filter(Boolean);
    const r = runSuite({ fs, repoRoot: home, files, changedFiles });
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
    // C01 authorization — write-access to the GitHub Project (viewerCanUpdate), the SoT for authority
    // (`prj manage assign`). The lifecycle ops now call this unconditionally, so wiring it here is what
    // makes the CLI enforce it. Only "false" denies; a null/errored probe does NOT silently authorize —
    // fail closed unless GitHub explicitly says the viewer can update.
    authorize: (ref) =>
      tryRun("gh", ["api", "graphql", "-f", "query=query($o:String!,$n:Int!){organization(login:$o){projectV2(number:$n){viewerCanUpdate}}}", "-F", `o=${config.githubOrg}`, "-F", `n=${ref.number}`, "--jq", ".data.organization.projectV2.viewerCanUpdate"]) === "true",
    gate: () => runSuite({ fs, repoRoot: home, files: (tryRun("git", ["-C", home, "ls-files"]) ?? "").split("\n").filter(Boolean) }),
    log: (m) => process.stderr.write(`${m}\n`),
  };

  // PREFLIGHT (NEED/GAP): before a route-dispatched command runs, check gov-work's OWN two
  // requirements — a git commit identity and an authenticated `gh`. Both are the USER'S OWN TOOLS, and
  // each NEED carries the command that fixes it. There is no credential store to probe: gov-work stores
  // no secrets and needs no identity provider (ADR: three clients). Silent no-op on a healthy machine;
  // $GOV_SKIP_PREFLIGHT bypasses it for non-interactive automation.
  if (!("GOV_SKIP_PREFLIGHT" in process.env)) {
    const pf = preflight(assembleNeeds(), {
      gitConfig: (k) => tryRun("git", ["-C", home, "config", "--get", k]) || undefined,
      ghAuthOk: () => { try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); return true; } catch { return false; } },
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
