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
import { parseTarget, preflight as createPreflight, explainFailure, waitForTemplateContent, canAdoptExisting, archivePathFor, PUBLISHER_ONLY_DIRS, INHERITED_DIRS, expectedDirs, PER_PROJECT_TOKENS, tokenValuesFromOrgConfig, renderManifest, substituteTokens, leftoverTokens, type CreateIo, type ManifestLine } from "../setup/create.js";
import { runMenu, type MenuContext, type MenuHandlers } from "./menu.js";
import { runWorkFlow, myProjects, agentLaunchSpec, type AgentKind } from "./work-flow.js";
import { prjResolveGov, resolveFailureMessage } from "../resolve/resolve-gov.js";
import { createNodeEnv, expandTilde } from "../resolve/node-env.js";
import { createNodeRegistryStore } from "../resolve/registry-store.js";
import { parseOrgConfig } from "../config/org-config.js";
import { withRepoOverrides } from "../config/repo-overrides.js";
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
import { planFixes, detectPackageManager, formatPlanNarrative, renderCommand, parseGrantedScopes, missingScopes } from "../maintain/fix-env.js";
import { checklist, renderChecklist, checklistPreamble, statusSoFar, finalStatus, stepBanner, stepDone, type ChecklistFacts } from "./checklist.js";
import { checkDeps, formatDepsReport } from "../maintain/deps.js";
import { publishGate, formatPublishGate } from "../maintain/publish.js";
import { upgradePlan, formatUpgradePlan } from "../maintain/upgrade.js";
import { runUpgradeSync, runUpgradePr, fetchTemplateContent, DEFAULT_TEMPLATE } from "../maintain/upgrade-run.js";
import { RETIRE_PATHS } from "../maintain/upgrade-sync.js";
import { checkVersionCompat } from "../maintain/version-compat.js";
import { runFirstRun, type FirstRunIo, type OrgIdentity } from "./bootstrap.js";
import { starterProject, starterSummary } from "../lifecycle/starter-project.js";
import { approvedAgentIdsFrom } from "./agent-catalog.js";
import { parseApprovedAgents, withApprovedAgents } from "../config/approved-agents.js";
import { planAgentInstall } from "./agent-verb.js";
import { adopterNextSteps, joinerNextSteps } from "./next-steps.js";
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

/**
 * What GitHub says about this adopter's standing in a repo (#194): may they push,
 * and do they have a fork of it under their own org? Both are one API call each,
 * and both are unknowable from `git ls-remote` — which is why "base branch 'dev'
 * does not exist" used to be the only thing a fork-based adopter was told.
 */
const repoStanding = (url: string, githubOrg: string): { canPush: boolean; forkUnderOrg: string | null } | undefined => {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m) return undefined;
  const [owner, name] = [m[1]!, m[2]!];
  const canPush = ((): boolean | undefined => {
    const out = tryRun("gh", ["api", `repos/${owner}/${name}`, "--jq", ".permissions.push"]);
    return out === undefined ? undefined : out.trim() === "true";
  })();
  if (canPush === undefined) return undefined;              // unknown is not "no"
  // A fork under the adopter's org, named the same, whose parent is this repo.
  const forkUnderOrg = owner.toLowerCase() === githubOrg.toLowerCase()
    ? null
    : ((): string | null => {
        const parent = tryRun("gh", ["api", `repos/${githubOrg}/${name}`, "--jq", ".parent.full_name // empty"]);
        return parent && parent.trim().toLowerCase() === `${owner}/${name}`.toLowerCase() ? `${githubOrg}/${name}` : null;
      })();
  return { canPush, forkUnderOrg };
}

/**
 * Fork mappings the last `seed` proposed (#194).
 *
 * Deliberately a handover, not a prompt: `route()` is synchronous and owns no
 * terminal, and the flow that called it — `runWorkFlow` — already holds a readline
 * on the one terminal there is. Two readers of the same terminal is how the first
 * two attempts at this question answered themselves.
 */
let pendingRepoOverrides: readonly { readonly from: string; readonly to: string }[] = [];

function performAgentInstallReal(plan: ReturnType<typeof planAgentInstall>): boolean {
    if (!plan.ok) return false;
    // HEADLESS INSTALLS, AND NEVER SIGNS ANYONE IN (#196, Q11). The consent for
    // installing already happened, in policy, by the Infrastructure Owner — that is
    // what an approved list IS. Authentication cannot be delegated to anybody, so
    // it is left, and the machine ends in a state `gov agent` can describe:
    // installed, not signed in.
    const headless = !process.stdin.isTTY;
    process.stdout.write(`\n  Installing ${plan.agent.tool}:\n`);
    for (const s of plan.steps) process.stdout.write(`    ${s.command.join(" ")}\n`);
    let ok = true;
    for (const s of plan.steps) {
      process.stdout.write(`\n  ${s.what}…\n`);
      const [bin, ...rest] = s.command;
      const r = spawnSync(bin!, rest, { stdio: "inherit" });
      if (r.status !== 0) { ok = false; process.stdout.write(`  ✗ ${s.what} failed — see above\n`); }
    }
    if (!ok) return false;
    process.stdout.write(`\n  ✓ ${plan.agent.tool} installed\n`);

    // SIGNING IN IS THE PART NOBODY CAN AUTOMATE. Even the account is theirs to
    // create — no vendor exposes signup as an API, and gov holds no credential.
    if (headless) {
      process.stdout.write("\n  No terminal here, so gov stopped before signing you in — nobody else can do\n" +
                           `  that step. On a machine with a terminal: ${plan.signIn ? plan.signIn.join(" ") : "sign in to " + plan.agent.tool}\n`);
      return true;
    }
    if (plan.signupUrl) {
      process.stdout.write(`\n  If you do not have an account yet: ${plan.signupUrl}\n`);
    }
    if (plan.signIn) {
      process.stdout.write(`  Signing you in — ${plan.signIn.join(" ")} takes over from here.\n\n`);
      const [bin, ...rest] = plan.signIn;
      spawnSync(bin!, rest, { stdio: "inherit" });
    } else {
      process.stdout.write("  This one has no sign-in command; set its API key when you have one.\n");
    }
    return true;
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
async function runCreateWorkspace(rawTarget: string, flags: Record<string, string | boolean>): Promise<{ home: string; slug: string } | number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string, def: string): Promise<string> =>
    new Promise((res) => rl.question(def ? `  ${q} [${def}]: ` : `  ${q}: `, (a) => res(a.trim() || def)));
  const quietGh = (args: readonly string[]): string | null => {
    try { return execFileSync("gh", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { return null; }                        // a 404 while the template copies is EXPECTED, not news
  };
  const io: CreateIo = {
    gh: quietGh,
    home: os.homedir(),
    exists: (p) => fsSync.existsSync(p),
    print: (l) => process.stdout.write(`${l}\n`),
  };
  try {
    const parsedTarget = parseTarget(rawTarget);
    // Asked before anything is created, because the slug decides the location (R9). Defaulted from the
    // GitHub org so the common case is one keypress.
    const defaultSlug = (parsedTarget?.org ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
    // Named for what it DECIDES. Asking "Org slug" here and again in the setup flow read as the same
    // question twice; this one chooses the governance home's location, the later one is the org-config
    // value (pre-filled from this answer). #159 finding 1a.
    const slug = parsedTarget
      ? await ask(
          "A 2-6 character uppercase token for your organization. Choose it carefully — it is used\n" +
          `  throughout, including the workspace folder where all governance files live (~/.gov/<slug>)`,
          defaultSlug,
        )
      : defaultSlug;

    const pathFlag = typeof flags["path"] === "string" ? (flags["path"] as string) : undefined;
    const pre = createPreflight(io, rawTarget, slug, pathFlag);
    if (!pre.ok) {
      for (const line of explainFailure(pre.failure)) process.stderr.write(`${line}\n`);
      return 1;
    }
    for (const w of pre.warnings) process.stdout.write(`  ⚠ ${w.detail}\n`);

    const { target, govRepo } = pre;
    const full = `${target.org}/${target.repo}`;

    // RETRY PATH (#159 finding 2). A failed run leaves a repo behind that `gh` cannot delete, and a
    // stale clone at the derived path. Archive the clone — never destroy it — and adopt the remote only
    // when it could only have come from a failed run of this command.
    if (fsSync.existsSync(govRepo)) {
      const verdict = canAdoptExisting(io, target);
      if (!verdict.adopt) {
        process.stderr.write(`gov setup: ${govRepo} already exists, and ${full} is not safe to reuse — ${verdict.detail}.\n`);
        process.stderr.write(verdict.why === "not-ours"
          ? "  refusing rather than overwriting someone's repository. Choose another name, or --path <dir>.\n"
          : "  refusing rather than guessing. Check your access, then re-run.\n");
        return 1;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archive = archivePathFor(io.home, slug, stamp);
      fsSync.mkdirSync(path.dirname(archive), { recursive: true });
      fsSync.renameSync(govRepo, archive);
      process.stdout.write(`  archived the previous attempt → ${archive}\n`);
      process.stdout.write(`  adopting the existing ${full} (${verdict.why})\n`);
    } else {
      process.stdout.write(`  creating ${full} from ${TEMPLATE_REPO} (private)…\n`);
      if (tryRun("gh", ["repo", "create", full, "--template", TEMPLATE_REPO, "--private"]) === undefined) {
        process.stderr.write(`gov setup: creating ${full} failed. Nothing was cloned.\n`);
        return 1;
      }
    }
    // The template copy is asynchronous — cloning too early yields an EMPTY repo and a setup that
    // configures nothing while appearing to succeed (#159 manual test, finding 1c).
    if (!waitForTemplateContent(io, target, 10, (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* block */ } })) {
      process.stderr.write(`gov setup: ${full} was created, but GitHub has not finished copying the template.\n`);
      process.stderr.write(`  it still exists — re-run 'gov setup ${full}' in a moment to resume.\n`);
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
    return { home: govRepo, slug };
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
  let createdSlug: string | null = null;

  // ONE VERB, THE ARGUMENT DECIDES (#159). A positional `<org>/<repo>` means CREATE; its absence means
  // configure the workspace we are in, exactly as before. `--non-interactive` never creates, whatever
  // the cwd — creation must never be inferred from location, so a CI re-run cannot make a repository.
  const positional = "error" in parsed ? [] : parsed.positionals;
  if (positional.length > 0 && !nonInteractiveFlag) {
    const created = await runCreateWorkspace(positional[0], "error" in parsed ? {} : parsed.flags);
    if (typeof created === "number") return created;
    cwd = created.home;                             // continue into the normal flow, inside the new clone
    createdHome = created.home;
    // The template copy brings the framework's OWN agent/ and knowledge/. Adopter content is GENERATED
    // from publish/, so drop the inherited copies and seed from the manifest before setup configures
    // anything (#159 finding 6c, publish-folder model). Seeding here also means a brand-new workspace is
    // never "behind the CLI" — the CLI that created it did the seeding.
    for (const d of [...PUBLISHER_ONLY_DIRS, ...INHERITED_DIRS]) {
      const dir = path.join(created.home, d);
      if (fsSync.existsSync(dir)) fsSync.rmSync(dir, { recursive: true, force: true });
    }
    const seed = runUpgradeSync(path.join(created.home, "publish", "content"), created.home, { apply: true });
    if (seed.code !== 0) {
      for (const l of seed.lines) process.stderr.write(`${l}\n`);
      process.stderr.write(`gov setup: could not seed content from publish/. The repo exists — re-run to resume.\n`);
      return 1;
    }
    // #159 finding 1a — the slug was asked BEFORE creating (it decides the location), then asked again
    // by the setup flow, with a blank default. One fact, one question: carry the answer forward.
    createdSlug = created.slug;
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
        existing: { ...(existingText ? readExistingOrgConfig(existingText) : {}), ...(createdSlug ? { orgSlug: createdSlug } : {}) },
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
      const manifest: ManifestLine[] = [{ what: "Created", detail: `${createdHome} (from the framework template)` }];
      let activeNote = "";
      if (cfg) {
        const priorActive = deps.store.readActiveOrg();
        const added = orgAdd(deps, cfg.org, createdHome);
        if (!added.ok) {
          process.stdout.write(`  ⚠ could not register the workspace: ${added.message}\n     fix with: gov org add ${cfg.org} --home ${createdHome}\n`);
        } else if (priorActive === null || priorActive === cfg.org) {
          // Nothing to displace — activating is unambiguous.
          const used = orgUse(deps, cfg.org);
          process.stdout.write(used.ok ? `  registered ${cfg.org} → ${createdHome} (active)\n` : `  ⚠ ${used.message}\n`);
        } else {
          // DO NOT HIJACK. Creating a workspace for one org silently switched the active org and broke
          // resolution in the workspace the user was standing in (#159 manual test, finding 5).
          activeNote = `active org left as '${priorActive}' — switch when you want it:  gov org use ${cfg.org}`;
        }
        manifest.push({ what: "Registered", detail: `${cfg.org} → ${createdHome}${activeNote ? "" : " (active)"}` });
      }

      // PRUNE publisher scaffolding (6c), then COMMIT AND PUSH (6b) — neither is an optional decision the
      // adopter should be asked to make, and leaving them undone is what made the runbook five steps.
      manifest.push({ what: "Seeded", detail: `agent/ knowledge/ from publish/content (framework working copies removed)` });

      // SWEEP the seeded tree. publish/ is never touched — it is the copy source, and the framework
      // replaces it on upgrade. Leftovers are reported, not tolerated: a policy the adopter opens and
      // finds <ORG_NAME> in is the first impression this whole change exists to fix.
      const cfgText = fsSync.readFileSync(path.join(createdHome, "org-config.yaml"), "utf8");
      // From the FILE, not from parseOrgConfig: that interface carries only the keys
      // gov-work reads, so the owner handles and the effective date had no values and
      // survived into the adopter's policy documents (#193).
      const values = tokenValuesFromOrgConfig(cfgText);
      const leftovers = new Map<string, string>();     // token → first file it survived in
      let swept = 0;
      const sweepDir = (dir: string): void => {
        for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) {
          const f = path.join(dir, e.name);
          if (e.isDirectory()) { sweepDir(f); continue; }
          if (!/\.(md|ya?ml|json|txt)$/i.test(e.name)) continue;
          const before = fsSync.readFileSync(f, "utf8");
          const after = substituteTokens(before, values);
          if (after !== before) { fsSync.writeFileSync(f, after, "utf8"); swept++; }
          for (const l of leftoverTokens(after)) {
            if (PER_PROJECT_TOKENS.has(l)) continue;   // resolved by `gov seed`; expected here
            if (!leftovers.has(l)) leftovers.set(l, path.relative(createdHome, f));
          }
        }
      };
      for (const d of INHERITED_DIRS) { const dir = path.join(createdHome, d); if (fsSync.existsSync(dir)) sweepDir(dir); }
      manifest.push({ what: "Swept", detail: `${swept} file(s) — org tokens resolved in ${INHERITED_DIRS.join("/ ")}/ (publish/ untouched)` });
      // Name the file. "Unresolved: <FOO>" tells you a token survived; it does not
      // tell you where to look, which is the only part that lets anyone act.
      if (leftovers.size) {
        manifest.push({
          what: "⚠ Tokens",
          detail: `unresolved: ${[...leftovers].map(([t2, f]) => `${t2} (${f})`).join(", ")} — tell gov-work; these should not reach an adopter`,
        });
      }
      const left = fsSync.readdirSync(createdHome).filter((e) => e !== ".git" && fsSync.statSync(path.join(createdHome, e)).isDirectory());
      const manifestText = fsSync.existsSync(path.join(createdHome, "publish", "content", "MANIFEST.yaml"))
        ? fsSync.readFileSync(path.join(createdHome, "publish", "content", "MANIFEST.yaml"), "utf8")
        : null;
      const expected = expectedDirs(manifestText);
      const unexpected = left.filter((d) => !expected.includes(d));
      if (unexpected.length) manifest.push({ what: "Note", detail: `unexpected directories kept: ${unexpected.join(" ")} — tell gov-work if these are publisher-only` });

      const git = (...a: string[]): boolean => { try { execFileSync("git", ["-C", createdHome, ...a], { stdio: "ignore" }); return true; } catch { return false; } };
      git("add", "-A");
      const committed = git("commit", "-m", "configure the framework for this org");
      const pushed = committed && git("push", "-u", "origin", "HEAD");
      manifest.push({ what: "Committed", detail: committed ? (pushed ? "and pushed to the default branch" : "locally — push failed, run: git push") : "nothing to commit" });

      for (const line of renderManifest(manifest, [
        "knowledge/policies/agentic-development-policy.md   — make the policy yours",
        "agent/session-protocol.md                          — what your agents read at session start",
        "gov                                                — the interactive front door",
        ...(activeNote ? [activeNote] : []),
      ])) process.stdout.write(`${line}\n`);
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
    // The adopter path is exactly `gov setup <org>/<repo>` — the same code, reached
    // from the first-run question instead of from a command the newcomer had to
    // already know the name of.
    finalStatus: () => {
      const r = prjResolveGov(createNodeEnv());
      const policyPath = r.ok ? path.join(r.home, "knowledge", "policies", "llm-governance.md") : null;
      const policy = policyPath && fsSync.existsSync(policyPath) ? fsSync.readFileSync(policyPath, "utf8") : null;
      const cfgText = r.ok && fsSync.existsSync(path.join(r.home, "org-config.yaml"))
        ? fsSync.readFileSync(path.join(r.home, "org-config.yaml"), "utf8") : null;
      const c = cfgText ? parseOrgConfig(cfgText) : null;
      const gitCfg2 = (k: string): string | null => tryRun("git", ["config", "--global", "--get", k]) ?? null;
      return finalStatus(checklist({
        gitPresent: tryRun("git", ["--version"]) !== undefined,
        ghPresent: tryRun("gh", ["--version"]) !== undefined,
        ghAuthenticated: (() => { try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); return true; } catch { return false; } })(),
        ghScopesOk: true,
        gitIdentityOk: Boolean(gitCfg2("user.name") && gitCfg2("user.email")),
        workspaceResolves: r.ok,
        orgActive: createNodeEnv().readActiveOrg(),
        workspacePath: r.ok ? r.home : null,
        orgSlug: c?.orgSlug ?? null,
        role: "adopter",
        approvedAgents: (parseApprovedAgents(policy) ?? []).map((a) => a.id),
      }));
    },
    adopterNextSteps: () => {
      const r = prjResolveGov(createNodeEnv());
      if (!r.ok) return [];
      const text = fsSync.existsSync(path.join(r.home, "org-config.yaml"))
        ? fsSync.readFileSync(path.join(r.home, "org-config.yaml"), "utf8") : null;
      if (!text) return [];
      const c = parseOrgConfig(text);
      return adopterNextSteps({ orgSlug: c.orgSlug, githubOrg: c.githubOrg, workspaceRepo: c.workspaceRepo, workspacePath: r.home });
    },
    joinerNextSteps: () => {
      const r = prjResolveGov(createNodeEnv());
      if (!r.ok) return [];
      const text = fsSync.existsSync(path.join(r.home, "org-config.yaml"))
        ? fsSync.readFileSync(path.join(r.home, "org-config.yaml"), "utf8") : null;
      if (!text) return [];
      const c = parseOrgConfig(text);
      return joinerNextSteps({ orgSlug: c.orgSlug, githubOrg: c.githubOrg, workspaceRepo: c.workspaceRepo, workspacePath: r.home });
    },
    approveAgents: (agents) => {
      const r = prjResolveGov(createNodeEnv());
      if (!r.ok) return false;
      const policy = path.join(r.home, "knowledge", "policies", "llm-governance.md");
      if (!fsSync.existsSync(policy)) return false;
      const before = fsSync.readFileSync(policy, "utf8");
      const after = withApprovedAgents(before, agents);
      if (after === null) return false;
      fsSync.writeFileSync(policy, after, "utf8");
      return true;
    },
    createStarterProject: () => {
      // ITS OWN TERMINAL. Every readline opened earlier in this flow has been closed
      // by now (`gov setup` owns and releases one), so this opens a fresh one rather
      // than reaching for a handle that is gone — which is how the last question of a
      // completed adoption became ERR_USE_AFTER_CLOSE.
      const askHere = (q: string): string => {
        try {
          const fd = fsSync.openSync("/dev/tty", "r");
          try {
            process.stdout.write(q);
            const buf = Buffer.alloc(64);
            const n = fsSync.readSync(fd, buf, 0, buf.length, null);
            return buf.toString("utf8", 0, n).trim().toLowerCase();
          } finally { fsSync.closeSync(fd); }
        } catch {
          return "";                                   // no terminal: treated as "no"
        }
      };
      process.stdout.write("\n" + [
        "One more thing, and it is the useful one.",
        "",
        "The policies that arrived are the framework's starting position, not yours.",
        "gov can create a small project for reviewing them — a board and one issue —",
        "so the first governed change in your organization is the one that decides how",
        "everything after it will be governed.",
        "",
      ].join("\n") + "\n");
      const answer = askHere("Create it? [y/N] ");
      if (!/^y(es)?$/.test(answer)) {
        return ["  Skipped. You can review the policies on GitHub or in your editor."];
      }
      // Real calls, reported honestly: a board this token cannot create is a missing
      // `project` scope, not a broken adoption, and saying so beats a stack trace.
      const cfg = ((): { org: string; repo: string; home: string } | null => {
        const r = prjResolveGov(createNodeEnv());
        if (!r.ok) return null;
        const text = fsSync.existsSync(path.join(r.home, "org-config.yaml"))
          ? fsSync.readFileSync(path.join(r.home, "org-config.yaml"), "utf8") : null;
        if (!text) return null;
        const c = parseOrgConfig(text);
        return { org: c.githubOrg, repo: c.workspaceRepo, home: r.home };
      })();
      if (!cfg) return ["  (no workspace resolved yet — skipping the starter project)"];

      const spec = starterProject(cfg.org, cfg.repo);
      const boardUrl = tryRun("gh", ["project", "create", "--owner", cfg.org, "--title", spec.boardTitle, "--format", "json"])
        ?.match(/https:\/\/github\.com\/\S+/)?.[0] ?? null;
      const issues = createGhIssues((args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      const issueUrl = boardUrl ? issues.create(spec.issueRepo, spec.issueTitle, spec.issueBody, (tryRun("gh", ["api", "user", "--jq", ".login"]) ?? "")) : null;
      if (boardUrl && issueUrl) {
        const n = Number(boardUrl.match(/\/projects\/(\d+)/)?.[1] ?? 0);
        if (n) issues.addToBoard(cfg.org, n, issueUrl);
      }
      return ["", "Starter project:", ...starterSummary({ boardUrl, issueUrl, seeded: false })];
    },
    createWorkspace: (target) => {
      // CLOSE THIS READLINE FIRST. `runSetupCommand` opens its own interface on the
      // same stdin, and two readline interfaces both echo what you type — which is
      // why "Rakesh" arrived as "RRaakkeesshh". Only one may hold the terminal.
      rl.close();
      return runSetupCommand(["setup", target], now);
    },
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
  const cfgPath = path.join(resolved.home, "org-config.yaml");
  const cfgText = fs.readFile(cfgPath);
  if (!cfgText) return null;
  const config = parseOrgConfig(cfgText);
  // The fork question's two halves: what seed proposed, and how to record it. The
  // ASKING belongs to runWorkFlow, which owns the terminal (#194).
  const pendingRepoOverridesFn = (): readonly { readonly from: string; readonly to: string }[] => pendingRepoOverrides;
  const applyRepoOverrides = (o: readonly { readonly from: string; readonly to: string }[]): boolean => {
    const before = fs.readFile(cfgPath);
    if (before === null) return false;
    const after = withRepoOverrides(before, o);
    if (after === null) return false;
    fs.writeFile(cfgPath, after);
    pendingRepoOverrides = [];
    return true;
  };
  return {
    projects: createGhProjects(runGh),
    anchor: createGhAnchor(runGh),
    fs,
    pendingRepoOverrides: pendingRepoOverridesFn,
    // The three facts the agent menu needs (#195): what is on PATH, what keys are
    // set (presence only — never the value), and what this org has approved.
    hasTool: (cmd: string) => tryRun(cmd, ["--version"]) !== undefined,
    env: process.env,
    approvedAgents: () => parseApprovedAgents(fs.readFile(path.join(resolved.home, "knowledge", "policies", "llm-governance.md"))),
    // The person's own choice, from the lowest knowledge layer (C03). Read every
    // time, and validated against the org's list at launch — not at write time.
    // The joiner's ordinary case: nothing installed, and the org already chose what
    // should be. Same plan and same performer as `gov agent install` — one path.
    installAgent: (id: string) => {
      const policy = fs.readFile(path.join(resolved.home, "knowledge", "policies", "llm-governance.md"));
      const plan = planAgentInstall(id, parseApprovedAgents(policy), (cmd: string) => tryRun(cmd, ["--version"]) !== undefined);
      if (!plan.ok) { process.stdout.write(`  ${plan.message}\n`); return false; }
      return performAgentInstallReal(plan);
    },
    agentPreference: () => {
      const prefs = fs.readFile(path.join(config.agentWorkRoot, "preferences", `${me ?? ""}.md`));
      return /^\s*preferred_agent:\s*(\S+)/m.exec(prefs ?? "")?.[1] ?? null;
    },
    applyRepoOverrides,
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
  issue: "Create an issue — assigned to you, on the board. `--from <url>` mirrors an upstream one",
  agent: "Which AI agents your org approves, what is installed, and how to add one",
  upgrade: "Pull the latest framework CONTENT into this org (not the CLI — that is `npm i -g`)", "bump-version": "Bump the CLI + content version (maintainers)", publish: "Publish gate (maintainers)",
};
const CMD_USAGE: Record<string, string> = {
  agent: "[list | install <id> | approve <id>]",
  issue: "[<org>/<repo>] --title <t> [--body <b>|--body-file <f>] [--board <n>]  |  --from <upstream-issue-url> [--board <n>]",
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
    const gitPresent = tryRun("git", ["--version"]) !== undefined;
    // NOT GUARDED BY `gitPresent`, which is captured before the run and stays false
    // on a machine where `--fix` installs git a moment later. That stale capture
    // disabled this probe for the rest of the command, so the identity step could
    // succeed and the checklist would still report it undone — the third time in
    // this issue that a value was read before the step that changes it.
    // `git config --get` simply fails when git is absent, which is the same answer.
    const gitCfg = (k: string): string | null => {
      const v = tryRun("git", ["config", "--global", "--get", k]);
      return v && v.trim() ? v.trim() : null;
    };
    const gitIdentity = gitPresent ? { name: gitCfg("user.name"), email: gitCfg("user.email") } : undefined;
    const ghPresent = tryRun("gh", ["--version"]) !== undefined;
    // Installed and signed-in are different facts; only the second predicts whether
    // the next GitHub call works (#186).
    // One call answers both questions — signed in, and with which permissions. gh
    // writes the status to stderr, so it has to be captured, not just tested.
    const ghStatus = ghPresent ? ((): string | null => {
      try { return execFileSync("gh", ["auth", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
      catch (e) { const r = (e as { stdout?: string; stderr?: string }); return (r.stdout ?? "") + (r.stderr ?? "") || null; }
    })() : null;
    const ghAuthed = ghPresent && ((): boolean => {
      try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); return true; } catch { return false; }
    })();
    const ghScopes = ghAuthed && ghStatus ? parseGrantedScopes(ghStatus) : null;
    const report = doctor({
      gitPresent,
      ghPresent,
      ghAuthenticated: ghAuthed,
      ghScopes,
      gitIdentity,
      resolve,
      activeOrg: env.readActiveOrg(),
      cliVersion,
      contentVersion: fs.readFile(path.join(home, "VERSION"))?.trim() ?? null,
      // `install.sh` is BOTH a retired adopter artifact (the vendored bash CLI's
      // installer) and the framework repo's own bootstrap installer (#186). In an
      // adopter workspace the retire rule is right; in the framework checkout it is
      // a false alarm aimed at maintainers. publish/content/MANIFEST.yaml exists
      // only in the source repo, so it tells the two apart.
      staleArtifacts: fs.pathExists(path.join(home, "publish", "content", "MANIFEST.yaml"))
        ? []
        : RETIRE_PATHS.filter((rp) => fs.pathExists(path.join(home, rp.replace(/\/$/, "")))),
    });
    for (const line of formatDoctorReport(report)) process.stdout.write(`${line}\n`);

    // `--fix` (#186): act on the report instead of leaving the reader to translate
    // hints into commands for a package manager they may not have. Interactive by
    // default — each command is shown and consented to before it runs; `--yes` is
    // for unattended use (CI, a provisioning script).
    if (parsed.flags["fix"]) {
      // /etc/os-release is the only reliable way to tell Fedora from Rocky, and they
      // need different plans despite sharing `dnf`.
      const osId = ((): string | null => {
        try {
          const m = /^ID=("?)([^"\n]+)\1/m.exec(fsSync.readFileSync("/etc/os-release", "utf8"));
          return m?.[2]?.toLowerCase() ?? null;
        } catch { return null; }
      })();
      const plan = planFixes(
        { gitPresent, ghPresent, ghAuthenticated: ghAuthed, platform: process.platform, osId, ghScopes, gitIdentity },
        detectPackageManager((n) => tryRun(n, ["--version"]) !== undefined),
      );
      // THE WHOLE THING, BEFORE ANY OF IT (#186). An adopter met these one surprise
      // at a time and could not tell how far along they were. Derived from what gov
      // can see, never from a progress file: two processes writing one would
      // disagree, and a stale tick is worse than none.
      const facts = (): ChecklistFacts => ({
        gitPresent, ghPresent, ghAuthenticated: ghAuthed,
        ghScopesOk: Boolean(ghScopes && missingScopes(ghScopes).length === 0),
        gitIdentityOk: Boolean(gitIdentity?.name && gitIdentity.email),
        workspaceResolves: resolve.ok,
        orgActive: env.readActiveOrg(),
        workspacePath: resolve.ok ? resolve.home : null,
        orgSlug: null,
        role: null,
        installCmd: plan.steps.length
          ? {
              git: plan.steps.find((s) => s.fixes === "git") ? renderCommand(plan.steps.find((s) => s.fixes === "git")!) : "already installed",
              ghRepo: plan.steps.find((s) => s.fixes === "gh repo") ? renderCommand(plan.steps.find((s) => s.fixes === "gh repo")!) : undefined,
              gh: plan.steps.find((s) => s.fixes === "gh") ? renderCommand(plan.steps.find((s) => s.fixes === "gh")!) : "already installed",
            }
          : undefined,
      });
      for (const line of checklistPreamble()) process.stdout.write(`${line}\n`);
      for (const line of renderChecklist(checklist(facts()))) process.stdout.write(`${line}\n`);

      process.stdout.write("\n");
      for (const line of formatPlanNarrative(plan)) process.stdout.write(`${line}\n`);
      if (!plan.steps.length) {
        if (!plan.manual.length) process.stdout.write("doctor --fix: nothing to fix\n");
        return report.ok ? 0 : 1;
      }

      const assumeYes = Boolean(parsed.flags["yes"]);
      // A SYNCHRONOUS prompt, not readline: main() is sync by design (it returns an
      // exit code, and every other command is pure over injected IO). Reading stdin
      // directly keeps that contract rather than making the whole entry point async
      // for one interactive branch.
      //
      // EAGAIN IS NOT AN ANSWER. Node leaves a terminal fd non-blocking, so the very
      // first `readSync` usually throws EAGAIN — there is nothing typed yet, because
      // the human has not had time to type it. Treating that as an empty reply meant
      // the consent gate answered itself "no" the instant it was printed, and the
      // installer reported "Nothing was changed" to someone who never got to press a
      // key. It retries until there is something to read.
      //
      // Only a genuinely unreadable stdin returns null, and the caller must then say
      // so rather than assume either answer.
      const askSync = (q: string): string | null => {
        process.stdout.write(q);
        const buf = Buffer.alloc(256);
        const deadline = Date.now() + 10 * 60_000;      // a person, not a timeout
        for (;;) {
          try {
            const n = fsSync.readSync(0, buf, 0, buf.length, null);
            if (n === 0) return null;                   // EOF: stdin closed, no answer coming
            return buf.toString("utf8", 0, n).trim().toLowerCase();
          } catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            if (code !== "EAGAIN" && code !== "EWOULDBLOCK") return null;
            if (Date.now() > deadline) return null;
            // Nothing typed yet. Sleep synchronously — a busy loop on a terminal is
            // a hot CPU for no reason, and Atomics.wait is the only way to pause a
            // synchronous function without spawning something.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
          }
        }
      };

      // Elevation facts, gathered once: `process.getuid` is undefined on Windows,
      // where the whole question does not arise.
      const amRoot = typeof process.getuid === "function" && process.getuid() === 0;
      const haveSudo = tryRun("sudo", ["--version"]) !== undefined;
      // Can we actually elevate, or only invoke the command? `sudo -n true` answers
      // without prompting: it succeeds for a passwordless sudoer and fails both for
      // someone who must type a password and for someone with no rights at all.
      const sudoNoPassword = haveSudo && ((): boolean => {
        // Silent on purpose: `sudo: a password is required` on stderr IS the answer,
        // not an error to show the reader in the middle of a plan.
        try { execFileSync("sudo", ["-n", "true"], { stdio: "ignore" }); return true; } catch { return false; }
      })();
      const needElevation = plan.steps.some((s) => s.sudo) && !amRoot;
      // Say what the plan will ASK OF THEM before the first command, not after a
      // wall of sudo's own error text. Installing git and gh is a change to the
      // machine, and on Linux that is an administrator's act — the adopter who does
      // not have those rights should learn it here, in a sentence, not from
      // "sudo: a password is required".
      if (needElevation && !sudoNoPassword) {
        process.stdout.write(
          !haveSudo
            ? "\n  Note: installing git or gh changes the system, and `sudo` is not available here.\n" +
              "  Ask whoever administers this machine to install them, or install them yourself.\n"
            : assumeYes
              ? "\n  Note: installing git or gh needs administrator rights, and --yes cannot type a\n" +
                "  password. Re-run `gov doctor --fix` without --yes, or ask your administrator.\n"
              : "\n  Note: installing git or gh needs administrator rights — you will be asked for\n" +
                "  your password. If you do not have those rights, ask whoever administers this\n" +
                "  machine; nothing else in gov needs them.\n",
        );
      }
      // Unattended AND unable to elevate: emitting sudo's own failure for every step
      // teaches nothing. Say it once, above, and do the steps that need no rights.
      const skipElevated = needElevation && assumeYes && !sudoNoPassword;
      // ONE gate, before anything runs, defaulting to NO.
      //
      // Asking per command made the reader agree four times to a plan they had
      // already been shown, and each prompt arrived after the previous command's
      // output had scrolled the plan away. One informed yes is better consent than
      // four uninformed ones — and defaulting to N means a stray Enter changes
      // nothing on their machine.
      if (!assumeYes) {
        const go = askSync("\nDo you want to continue (y/N)? ");
        if (go === null) {
          // Never invent an answer. Silence here is our failure to ask, not their
          // refusal, and reporting it as "you said no" is how a working install
          // ends looking like an abandoned one.
          process.stdout.write("\n\nCould not read your answer — this terminal is not accepting input.\n" +
                               "Nothing was changed. Run `gov doctor --fix` directly, or run the commands above yourself.\n");
          return 1;
        }
        if (go !== "y" && go !== "yes") {
          process.stdout.write("\nNothing was changed. The commands above are safe to run yourself.\n");
          return report.ok ? 0 : 1;
        }
      }
      let ran = 0, failed = 0;
      const broken = new Set<string>();
      {
        for (const step of plan.steps) {
          const unmet = step.dependsOn?.filter((d) => broken.has(d)) ?? [];
          if (unmet.length) {
            process.stdout.write(`\n  skipped: ${step.what}\n    (it needs ${unmet.map((u) => `"${u}"`).join(" and ")}, which did not succeed)\n`);
            broken.add(step.fixes);
            continue;
          }
          const elevationBlocked = step.sudo && !amRoot && skipElevated;
          if (elevationBlocked) {
            process.stdout.write(`\n  skipped: ${step.what}\n    (needs administrator rights — see the note above)\n`);
            broken.add(step.fixes);
            continue;
          }
          // `--yes` means "do not ask me", which cannot include a step whose whole
          // purpose is to ask: `gh auth login` opens a browser and waits. In
          // unattended use it would hang forever with no one at the terminal. Name
          // it as the human's remaining job instead.
          if (assumeYes && step.interactive && step.fixes !== "git identity") {
            process.stdout.write(`\n  ${step.what}\n    needs you — run it yourself:  ${renderCommand(step)}\n`);
            broken.add(step.fixes);
            continue;
          }
          // The identity step has no canned command: its VALUES are the point, and the
          // best source is the GitHub account the sign-in just proved. Ask, defaulting
          // to that — after the login, so the defaults exist.
          if (step.fixes === "git identity") {
            process.stdout.write(`\n  ${step.what}\n`);
            const ghName = tryRun("gh", ["api", "user", "--jq", ".name // empty"]) ?? "";
            const ghLogin = tryRun("gh", ["api", "user", "--jq", ".login // empty"]) ?? "";
            const ghId = tryRun("gh", ["api", "user", "--jq", ".id // empty"]) ?? "";
            const ghEmail = tryRun("gh", ["api", "user", "--jq", ".email // empty"]) ?? "";
            // GitHub hides most people's address. The noreply form is what GitHub
            // itself recommends and what its web edits use, so commits still attribute.
            const defEmail = ghEmail || (ghId && ghLogin ? `${ghId}+${ghLogin}@users.noreply.github.com` : "");
            const defName = ghName || ghLogin;
            // ASK AGAIN rather than give up (#192). An empty name or a mistyped
            // address is a slip, not a decision to abandon the setup — and the only
            // way out that belongs to the user is Ctrl-C, which they already know.
            // Bounded, because against a closed stdin "ask again" is a hang.
            const askUntil = (label: string, def: string, ok: (v: string) => string | null): string | null => {
              for (let i = 0; i < 5; i++) {
                const raw = askSync(`    ${label}${def ? ` [${def}]` : ""}: `);
                if (raw === null) return null;                 // no stdin: not a refusal, an absence
                const v = (raw || def).trim();
                const problem = ok(v);
                if (!problem) return v;
                process.stdout.write(`    ✗ ${problem}\n`);
              }
              return null;
            };
            const finalName = askUntil("Your name for git commits", defName,
              (v) => (v ? null : "git will not commit without a name."));
            const finalEmail = finalName === null ? null : askUntil("Your email for git commits", defEmail,
              (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : `'${v}' does not look like an email address (name@example.com).`));
            if (!finalName || !finalEmail) {
              failed++; broken.add(step.fixes);
              process.stdout.write("  ✗ skipped — git needs both a name and an email. Set them yourself with:\n" +
                                   "      git config --global user.name  \"Your Name\"\n" +
                                   "      git config --global user.email \"you@your-org\"\n");
              continue;
            }
            const okName = spawnSync("git", ["config", "--global", "user.name", finalName], { stdio: "inherit" }).status === 0;
            const okMail = spawnSync("git", ["config", "--global", "user.email", finalEmail], { stdio: "inherit" }).status === 0;
            if (okName && okMail) { ran++; process.stdout.write(`  ✓ git will sign your commits as ${finalName} <${finalEmail}>\n`); }
            else { failed++; broken.add(step.fixes); process.stdout.write("  ✗ could not write your git config\n"); }
            continue;
          }
          // The run reads as the plan did: a banner opens the step, the command is
          // shown, and a ticked line closes it. Same numbers, same words.
          const item = checklist(facts()).find((c) => c.text.toLowerCase().includes(step.fixes.split(" ")[0]!));
          if (item) for (const line of stepBanner(item)) process.stdout.write(`${line}\n`);
          process.stdout.write(`  run:  ${renderCommand(step)}\n`);
          // sudo is prepended only here, where the user has just seen and accepted the
          // exact line — never silently inside the plan. Two environments make the
          // naive prefix wrong: a container running as root has no `sudo` and does
          // not need one, and a locked-down machine has neither. Say which, rather
          // than failing with an exit code the reader cannot interpret.
          const needsElevation = step.sudo && !amRoot;
          if (needsElevation && !haveSudo) {
            failed++;
            process.stdout.write("  ✗ needs administrator rights, and `sudo` is not installed here.\n" +
                                 "    Run the command above as an administrator, then re-run `gov doctor`.\n");
            continue;
          }
          const [bin, ...rest] = needsElevation ? ["sudo", ...step.command] : [...step.command];
          const r = spawnSync(bin!, rest, { stdio: "inherit" });
          if (r.status === 0) {
            ran++;
            const it = checklist(facts()).find((c) => c.text.toLowerCase().includes(step.fixes.split(" ")[0]!));
            process.stdout.write(it ? `\n${stepDone(it)}\n` : "  ✓ done\n");
          }
          else {
            failed++;
            broken.add(step.fixes);
            const why = r.error ? r.error.message : `exit ${r.status ?? "unknown"}`;
            process.stdout.write(`  ✗ failed — ${why}\n`);
          }
        }
      }
      process.stdout.write(`\n${ran} fixed, ${failed} failed.\n`);
      // Recomputed, not decremented: the list describes the machine as it is now,
      // which is the only version of it worth showing.
      const after: ChecklistFacts = {
        ...facts(),
        gitPresent: tryRun("git", ["--version"]) !== undefined,
        ghPresent: tryRun("gh", ["--version"]) !== undefined,
        ghAuthenticated: (() => { try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); return true; } catch { return false; } })(),
        ghScopesOk: (() => {
          try {
            const s = execFileSync("gh", ["auth", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
            const g = parseGrantedScopes(s);
            return Boolean(g && missingScopes(g).length === 0);
          } catch { return false; }
        })(),
        gitIdentityOk: Boolean(gitCfg("user.name") && gitCfg("user.email")),
      };
      // `doctor --fix` is a waypoint, not the end: the organization comes next.
      for (const line of statusSoFar(checklist(after))) process.stdout.write(`${line}\n`);
      return failed ? 1 : 0;
    }

    // Only when something IS missing: a healthy machine does not need install instructions, and a report
    // that prints them anyway trains the reader to skim past the part that matters.
    if (!depsReport.ok) {
      process.stdout.write("\n");
      for (const line of formatDepsReport(depsReport)) process.stdout.write(`${line}\n`);
      process.stdout.write("\n  or let gov do it:  gov doctor --fix\n");
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
    repoStanding,
    hasTool: (cmd: string) => tryRun(cmd, ["--version"]) !== undefined,
    approvedAgents: () => parseApprovedAgents(fs.readFile(path.join(home, "knowledge", "policies", "llm-governance.md"))),
    /**
     * Install, then offer the sign-in (#196, Q5). gov orchestrates; the vendor
     * authenticates — the `gh auth login` shape, including its browser fallback.
     * Every command is shown before it runs, because approval means the org agreed
     * to the tool, not that the person at the keyboard agreed to this moment.
     */
    performAgentInstall: performAgentInstallReal,

    /**
     * `approve` raises a pull request. It does not edit the policy: the approved
     * list is C01 (POL-136) and belongs to the Infrastructure Owner, not to whoever
     * typed the command — the same reason `gov knowledge` exists.
     */
    proposeAgentApproval: (id) => [
      `Proposing ${id} for your organization's approved list.`,
      "",
      "  This is a policy change, so it goes to whoever owns",
      "  knowledge/policies/llm-governance.md — not straight into the file.",
      "",
      `  gov knowledge propose approve-agent-${id}`,
      `  …edit the approved_agents block, then:`,
      `  gov knowledge submit approve-agent-${id}`,
    ],
    // Consent, then record. The prompt is what makes the mapping a decision; writing
    // it is what makes it reviewable. Neither needs a human to retype what the
    // preflight already worked out (#194).
    noteRepoOverrides: (proposed) => { pendingRepoOverrides = proposed; },
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
