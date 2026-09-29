// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `prj` command router — maps a parsed command to its lifecycle orchestrator,
 * building each command's config/input from the assembled {@link CliContext} +
 * argv. Model A (SDD-012): project context comes from the resolved workspace +
 * GitHub, never a state file. Pure over the injected ports, so it's fully testable.
 *
 * Context asymmetry: `seed` runs from the gov HOME (creates the workspace);
 * task/merge/close/pause/resume/cancel run from WITHIN the project workspace
 * (ctx.home is the project clone; projectWorkRoot is its parent).
 */
import * as path from "node:path";
import { type ParsedArgs, flagStr, flagBool } from "./args.js";
import type { OrgConfig } from "../config/org-config.js";
import type { Board } from "../lifecycle/board.js";
import type { Vcs } from "../lifecycle/vcs.js";
import type { Fs } from "../lifecycle/fs-io.js";
import type { Issues } from "../lifecycle/issues.js";
import type { AnchorCreator } from "../lifecycle/anchor.js";
import type { Pulls } from "../lifecycle/pulls.js";
import type { BoardRef } from "../lifecycle/identity.js";
import type { GateResult } from "../lifecycle/close-gate.js";
import { planIssue, issueSummary } from "../lifecycle/issue-create.js";
import { agentReport, formatAgentReport, planAgentInstall } from "./agent-verb.js";
import { seed, inspectLeftovers, applyCleanup } from "../lifecycle/seed.js";
import { planLines } from "../lifecycle/cleanup.js";
import { expandTilde } from "../resolve/node-env.js";
import { task } from "../lifecycle/task-run.js";
import { merge } from "../lifecycle/merge.js";
import { close } from "../lifecycle/close.js";
import { sync } from "../lifecycle/sync.js";
import { ensureRootProtocol, mirrorWarnings } from "../lifecycle/root-protocol.js";
import { addRepo } from "../lifecycle/add-repo.js";
import { join } from "../lifecycle/join.js";
import { pause, resume, cancel } from "../lifecycle/state.js";
import { orgAdd, orgUse, orgList, orgRemove, type OrgDeps } from "../resolve/org.js";
import { manageList, manageAssign, formatOwnerRows, anchorShow, projectStatus, type ManageListResult } from "../lifecycle/manage.js";
import { boardNumberFromProjectId } from "../lifecycle/task.js";
import type { Projects } from "../lifecycle/project-list.js";
import { proposeKnowledge, submitKnowledge, archiveKnowledge } from "../lifecycle/knowledge.js";
import { policyGate } from "./policy-gate-io.js";
import { approverLogins, protectRepo, type GhApi } from "../maintain/repo-protect.js";
import { rules } from "./rules-verb.js";
import { buildRulesAt } from "./rules-lifecycle.js";
import { clearPending, isMutatingVerb, readPending, refuseForPendingRules } from "../rules-pending.js";
import type { MergeStamp, StampOutcome } from "../lifecycle/merge.js";
import { stampFacts } from "../lifecycle/governance-stamp.js";
import { log } from "../log.js";
import { search, formatHits, formatList, formatDoc, hitsJson } from "../knowledge-search.js";
import { loadDocs, resolveDoc } from "./knowledge-io.js";
import { onboard } from "../lifecycle/onboard.js";

// TOOL_FILES IS GONE (Decision 1, 2026-09-14). It listed the nine harness files for seed's
// per-project scaffold loop, which read them from `<repo>/framework/<rel>` — a directory in
// RETIRE_PATHS that was never shipped. Every read returned null; nothing was ever written.
// The harness reaches an agent through `ensureRootProtocol`, which mirrors to the project
// directory on every launch.

/** Everything the router needs: config, the resolved workspace, identity + ports. */
export interface CliContext {
  readonly config: OrgConfig;
  /** The resolved gov workspace — the gov HOME for seed, else the project clone. */
  readonly home: string;
  readonly today: string;
  /** The current user's git email — recorded as seeded_by. */
  readonly seededBy: string;
  /** The current user's gh login — the default issue assignee / anchor assignee. */
  readonly login?: string;
  readonly identity?: { name?: string; email?: string };
  readonly board: Board;
  readonly vcs: Vcs;
  readonly fs: Fs;
  readonly issues: Issues;
  readonly anchor: AnchorCreator;
  readonly pulls: Pulls;
  readonly projects: Projects;
  readonly cloneRepo: (url: string, dest: string) => void;
  /** Write access + a fork under this org, per repo (#194). Absent → branch checks only. */
  readonly repoStanding?: (url: string, githubOrg: string) => { readonly canPush: boolean; readonly forkUnderOrg: string | null } | undefined;
  /**
   * Ask whether to record a fork mapping, and write it to org-config.yaml on yes
   * (#194). Returns whether anything was written. Absent → the message stands on
   * its own and the adopter edits the file themselves.
   */
  /** Record what the preflight proposed, for the caller that owns the terminal to ask about (#194). */
  readonly noteRepoOverrides?: (proposed: readonly { readonly from: string; readonly to: string }[]) => void;
  /** Is this command on PATH? The same probe the work flow uses (#195/#196). */
  readonly hasTool?: (cmd: string) => boolean;
  /** The org's approved-agent block, or null when the policy carries none (#196). */
  readonly approvedAgents?: () => readonly { readonly id: string; readonly default?: boolean }[] | null;
  /** Does the backup copy of this agent's key differ from the one it uses? Never the values. */
  readonly credentialDrift?: (agentId: string) => boolean;
  /** Run an install plan, and offer the sign-in. Owns the terminal; returns success. */
  /**
   * Absent by design since #213: installing ASKS and SPAWNS, so `bin.ts` handles
   * `agent install` before routing — next to `work`, for the reason stated below.
   */
  readonly performAgentInstall?: (plan: ReturnType<typeof planAgentInstall>) => boolean;
  /** Raise a pull request adding an agent to the org's authorized_agents (org-config.yaml). */
  readonly proposeAgentApproval?: (id: string) => readonly string[];
  /** REQUIRED (C01) — write-access to the GitHub Project (viewerCanUpdate). The lifecycle ops call it
   *  unconditionally; wiring it here is what makes the CLI actually ENFORCE authorization. */
  readonly authorize: (ref: BoardRef) => boolean;
  /** REQUIRED — close's test-merge gate (governance.runSuite). Always run before any push. */
  readonly gate: () => GateResult;
  /**
   * `git -C <repo> <args>` → stdout, or null. Used to read the organization's policy from the DEFAULT branch
   * (`policy-gate-io.ts`) rather than from the branch a command is running on. Absent → no verb checks are
   * found, which is the same behaviour as a workspace that has none.
   */
  readonly git?: (repo: string, args: readonly string[]) => string | null;
  /**
   * `gh <args>` → stdout, with an optional JSON body on stdin; throws on a non-zero exit. The door
   * `gov repo protect` writes branch protection through (framework-policy §3.3; the controls
   * themselves are specified in `framework/docs/specs/gov-behaviour.md` §7).
   *
   * Absent → `gov repo protect` says it has no way to call `gh` and changes nothing. Deliberately optional and
   * deliberately NOT one of the typed ports: a port would invite other verbs to reach the API their own way,
   * and the reason this exists at all is that installing a rule needs a REQUEST BODY (see repo-protect.ts).
   */
  readonly ghApi?: GhApi;
  /**
   * The clock, for the `rules-pending` marker and the `gov rules reload` attestation. Absent → real time.
   *
   * Injected rather than read, because "the rules changed at T, the person attested at T+2m" is a fact a test
   * has to be able to assert, and a test that cannot control the clock asserts the shape of a timestamp instead
   * of its meaning.
   */
  readonly now?: () => Date;
  /** §10.10 — the three facts `gov merge` stamps into a pull request body. Absent → merge says nothing. */
  readonly governanceStamp?: () => { readonly lines?: readonly string[]; readonly error?: string };
  /** Put those lines in the pull request whose head is `head`, working from inside `repoDir`. */
  readonly stampPullRequest?: (repoDir: string, head: string, lines: readonly string[]) => StampOutcome;
  readonly log?: (msg: string) => void;
}

export interface CommandResult {
  readonly code: number;
  readonly lines: readonly string[];
}

/**
 * Verbs that USED to be `gov <verb>` and are now their own client's (adr-three-clients, PRJ-43).
 *
 * Kept as data rather than dropped, because the cost of removing a verb is paid by whoever types it next.
 * A stale muscle-memory invocation should land on the answer, not on "unknown command". Deliberately not
 * a delegation table — gov does not run these, it points at them.
 */
const MOVED_VERBS: Readonly<Record<string, string>> = {
  auth: "gov-cicd", creds: "gov-cicd",
  catalog: "gov-cicd", build: "gov-cicd", deploy: "gov-cicd", data: "gov-cicd", "data-access": "gov-cicd",
  promote: "gov-cicd", rollback: "gov-cicd", drift: "gov-cicd", standards: "gov-cicd", attest: "gov-cicd",
  authorize: "gov-cicd", secret: "gov-cicd", policy: "gov-cicd", "deploy-check": "gov-cicd",
  infra: "gov-infra",
};

/** `infra` was a NAMESPACE, not a verb: `gov infra <cmd>` forwarded `<cmd>` to the infra plugin. So the
 *  advice for it is `gov-infra <verb>`, never `gov-infra infra` — which is what the first version of this
 *  message said, and it was wrong in the only way that matters: it would not have worked if typed. */
const MOVED_NAMESPACES = new Set(["infra"]);

/** Clients that DO NOT EXIST YET. `@svayam/gov-infra` is unpublished (404) and 909 carries no such
 *  package, so telling anyone to install it is advice that fails when typed — the same defect as
 *  `gov-infra infra`. Naming the client is still right (the verbs are its, not ours); promising an
 *  install is not. Delete an entry the day its package publishes. */
const UNRELEASED_CLIENTS = new Set(["gov-infra"]);

const usage = (spec: string): CommandResult => ({ code: 2, lines: [`usage: gov ${spec}`] });

/** Render a PAGINATED project list: "<header> (X–Y of TOTAL):" + rows + a next-page hint when there's more. */
function pagedListLines(header: string, cmd: string, res: ManageListResult, page: number, limit: number): string[] {
  const to = res.offset + res.rows.length;
  const from = res.total === 0 ? 0 : res.offset + 1;
  const lines = [`${header} (${from}–${to} of ${res.total}):`, ...formatOwnerRows(res.rows)];
  if (to < res.total) lines.push(`  … more — next: gov-work ${cmd} --page ${page + 1}${limit !== 20 ? ` --limit ${limit}` : ""}`);
  return lines;
}

/**
 * Route `prj org …` — the multi-home registry commands. Handled SEPARATELY from
 * {@link route} because they run WITHOUT a resolved workspace (`gov org add` is
 * the bootstrap that makes resolution work).
 */
export function routeOrg(positionals: readonly string[], flags: ParsedArgs["flags"], deps: OrgDeps): CommandResult {
  const [sub, ...rest] = positionals;
  const toResult = (r: ReturnType<typeof orgList>): CommandResult =>
    r.ok ? { code: 0, lines: r.lines } : { code: r.code, lines: [r.message] };
  switch (sub) {
    case "add": {
      const home = flagStr(flags, "home");
      if (!rest[0] || !home) return usage("org add <github_org> --home <path>");
      return toResult(orgAdd(deps, rest[0], path.resolve(expandTilde(home))));
    }
    case "use":
      if (rest.length < 1) return usage("org use <github_org>");
      return toResult(orgUse(deps, rest[0]));
    case "list":
      return toResult(orgList(deps));
    case "remove":
      if (rest.length < 1) return usage("org remove <github_org>");
      return toResult(orgRemove(deps, rest[0]));
    default:
      return usage("org <add|use|list|remove> …");
  }
}

/**
 * Where the person's `state/` lives, when gov knows enough to say.
 *
 * Both halves are needed and either may be missing — `agent_work_root` is unset in a workspace nobody has
 * finished configuring, and the login is absent whenever `gh` cannot answer. Returning null means "no marker
 * can be read", which is the same answer `rules-lifecycle.ts` gives for "no marker can be written": one keying
 * rule, used by the writer and the reader, so the two can never disagree about where to look.
 */
function markerKey(ctx: CliContext): { workRoot: string; login: string } | null {
  return ctx.config.agentWorkRoot && ctx.login ? { workRoot: ctx.config.agentWorkRoot, login: ctx.login } : null;
}

/**
 * What `gov merge` says about the stamp (§10.10).
 *
 * IT NEVER READS AS A FAILURE, because it never is one: the merge has landed by the time this is computed. A
 * stamp that could not be computed is stated as a fact with its reason, and the facts are printed anyway when
 * there was no pull request to hold them — so the run log carries them even where GitHub does not.
 */
function stampReport(stamp: MergeStamp | undefined): string[] {
  if (!stamp) return [];
  if (stamp.error) return [`  governance stamp: not recorded — ${stamp.error} (the merge is done)`];
  const stamped = stamp.placed.filter((p) => p.outcome === "stamped");
  const failed = stamp.placed.filter((p) => p.outcome === "failed");
  const facts = stampFacts(stamp.lines);
  return [
    stamped.length
      ? `  governed by: ${facts.join(" · ")} — stamped into ${stamped.length} pull request(s)`
      : `  governed by: ${facts.join(" · ")} — no pull request to stamp; recorded here and in the run log`,
    ...failed.map((f) => `  ⚠ could not stamp the pull request in ${f.repoDir} (the merge is done)`),
  ];
}

/** Route a parsed command to its orchestrator; returns an exit code + output. */
export function route(parsed: ParsedArgs, ctx: CliContext): CommandResult {
  const { command, positionals, flags } = parsed;
  const c = ctx.config;
  const projectWorkRoot = path.dirname(ctx.home);
  const ownerField = "organization" as const;

  // ── A CHANGED RULE STOPS WORK UNTIL THE SESSION RESTARTS (design §8) ──────────────────────────────────────
  //
  // BEFORE THE SWITCH, so there is one place it is decided and no verb can be added that forgets. gov cannot
  // replace the rules inside a session that is already running, so the only honest alternative to refusing is
  // letting work land judged against rules that session never read — and that failure is invisible: nothing
  // errors, the merge succeeds, and the record says the change was reviewed under the current policy.
  //
  // ONLY THE MUTATING VERBS. `status`, `knowledge search|show|list`, `rules` and `validate` keep working, and
  // `doctor` and `log` never reach this function at all (main.ts answers them before resolution). A workspace
  // where nothing can be inspected is a workspace nobody can get out of this state — bricking it would make
  // the refusal worse than the thing it prevents.
  {
    const key = markerKey(ctx);
    const pending = key && isMutatingVerb(command, positionals[0]) ? readPending(ctx.fs, key.workRoot, key.login) : null;
    if (pending) {
      log("warn", "refused a mutating verb — the rules changed since the session started", "gov-work:cli:dispatch", "route",
        { command, hash: pending.hash, clauses: pending.clauses.length });
      return { code: 1, lines: refuseForPendingRules(pending, command) };
    }
  }

  switch (command) {
    // `gov agent` — the door that stays open (#196). Reporting is here; installing
    // and signing in are performed by the caller, which owns the terminal.
    case "agent": {
      const sub = positionals[0] ?? "";
      const approved = ctx.approvedAgents?.() ?? null;

      if (!sub || sub === "list") {
        return { code: 0, lines: formatAgentReport(agentReport({
          approved,
          hasTool: ctx.hasTool ?? (() => false),
          env: process.env,
          credentialDrift: ctx.credentialDrift,
        })) };
      }

      if (sub === "install") {
        const id = positionals[1];
        if (!id) return usage("agent install <id>");
        const plan = planAgentInstall(id, approved, ctx.hasTool ?? (() => false));
        if (!plan.ok) return { code: 1, lines: [plan.message] };
        return ctx.performAgentInstall
          ? { code: ctx.performAgentInstall(plan) ? 0 : 1, lines: [] }
          : { code: 1, lines: ["No terminal to install in. Run `gov agent install` from a shell."] };
      }

      if (sub === "approve") {
        const id = positionals[1];
        if (!id) return usage("agent approve <id>");
        // A pull request, never an edit: the approved list is C01 (gov-behaviour.md §8) and
        // belongs to the Infrastructure Owner, not to whoever typed the command.
        return ctx.proposeAgentApproval
          ? { code: 0, lines: ctx.proposeAgentApproval(id) }
          : { code: 1, lines: ["Cannot propose a change here — run this inside your governance workspace."] };
      }

      return usage("agent [list | install <id> | approve <id>]");
    }

    // `gov issue` — the first step of governed work, which had no verb (#182, #194).
    case "issue": {
      const from = flagStr(flags, "from");
      const bodyFile = flagStr(flags, "body-file");
      const boardFlag = flagStr(flags, "board");
      const planned = planIssue(
        {
          repo: positionals[0] ?? flagStr(flags, "repo"),
          title: flagStr(flags, "title"),
          body: bodyFile ? (ctx.fs.readFile(bodyFile) ?? "") : flagStr(flags, "body"),
          from,
          board: boardFlag ? Number(boardFlag) : null,
          // POL-413: the actor, not an option with a blank default.
          assignee: flagStr(flags, "assignee") ?? ctx.login ?? "",
          githubOrg: c.githubOrg,
          defaultRepo: `${c.githubOrg}/${c.workspaceRepo}`,
        },
        (repo, number) => ctx.issues.read(repo, number),
      );
      if (!planned.ok) return { code: 1, lines: [planned.message] };
      const plan = planned.plan;

      const url = ctx.issues.create(plan.repo, plan.title, plan.body, plan.assignee);
      if (!url) return { code: 1, lines: [`Could not create the issue in ${plan.repo}. Check that you can write there.`] };
      const added = plan.board === null ? false : ctx.issues.addToBoard(c.githubOrg, plan.board, url);
      // A board issue that never reached the board is invisible to gov, so it is a
      // non-zero exit even though the issue itself exists — the summary says which.
      return { code: plan.board !== null && !added ? 1 : 0, lines: issueSummary(plan, url, added) };
    }

    case "seed": {
      if (positionals.length < 1) return usage("seed <board-url> [--assignee <login>] [--clean [--consent]]");

      // ── `--clean`: reverse what a failed run left behind (#230) ───────────────
      //
      // A separate entry point rather than a mode of the seed below, so it can never fall through
      // into creating a project. Two steps on purpose: `--clean` shows the plan and does the items
      // whose safety is established by evidence; `--clean --consent` additionally does the ones that
      // risk something, which the operator has by then been told about item by item. Items gov
      // REFUSES are never done under either — a confirmation does not make destroying unpushed work
      // correct, so it is not offered.
      if (flagBool(flags, "clean")) {
        const seedCfg = {
          govHome: ctx.home, workspaceRepo: c.workspaceRepo, agentWorkRoot: c.agentWorkRoot,
          defaultBranch: c.defaultBranch, defaultCodeBranch: c.defaultCodeBranch,
          githubOrg: c.githubOrg, repoOverrides: c.repoOverrides, orgTokens: c.orgTokens,
        };
        const seedDeps = { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, anchor: ctx.anchor, cloneRepo: ctx.cloneRepo, log: ctx.log, repoStanding: ctx.repoStanding };
        const found = inspectLeftovers(seedDeps, seedCfg, { boardUrl: positionals[0] });
        if (!found.ok) return { code: found.code, lines: [found.message] };
        if (found.leftovers.length === 0) {
          return { code: 0, lines: ["Nothing to reverse — this board has no leftover state on this machine."] };
        }

        const consent = flagBool(flags, "consent");
        const r = applyCleanup(seedDeps, seedCfg, found.plan, found.paths, consent);
        const lines = [
          ...planLines(found.plan), "",
          ...r.done.map((d) => `  reversed: ${d}`),
          ...r.skipped.map((d) => `  left:     ${d}`),
          ...r.failed.map((d) => `  FAILED:   ${d}`),
        ];
        if (r.skipped.some((x) => x.includes("needs --consent"))) {
          lines.push("", "  Re-run with --consent to do the items above that risk something.");
        }
        // Non-zero while anything remains: a cleanup that cleared three of four artifacts has not
        // cleared the way for a re-seed, and exiting 0 would say it had.
        const remaining = r.skipped.length + r.failed.length;
        return { code: r.failed.length ? 1 : remaining ? 1 : 0, lines };
      }

      const r = seed(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, anchor: ctx.anchor, cloneRepo: ctx.cloneRepo, log: ctx.log, repoStanding: ctx.repoStanding },
        {
          govHome: ctx.home,
          workspaceRepo: c.workspaceRepo,
          agentWorkRoot: c.agentWorkRoot,
          defaultBranch: c.defaultBranch,
          defaultCodeBranch: c.defaultCodeBranch,
          githubOrg: c.githubOrg,
          repoOverrides: c.repoOverrides,
          orgTokens: c.orgTokens,
        },
        {
          boardUrl: positionals[0],
          assignee: flagStr(flags, "assignee") ?? ctx.seededBy,
          seededBy: ctx.seededBy,
          today: ctx.today,
          identity: ctx.identity,
          seederLogin: flagStr(flags, "login") ?? ctx.login ?? null,
        },
      );
      if (r.ok) {
        return { code: 0, lines: [`Project ${r.projectId} seeded on ${r.branch}`, `  workspace: ${r.projectWorkRoot}`, `  anchor: ${r.anchorRef ?? "(none — designate with prj manage)"}`] };
      }
      // The preflight found the fork. It is NOT asked about here: this function has
      // no terminal of its own, and the flow that called it does. Hand the finding
      // up; `runWorkFlow` asks with the readline that owns the terminal (#194).
      if (r.suggestOverrides?.length) ctx.noteRepoOverrides?.(r.suggestOverrides);
      return { code: r.code, lines: [r.message] };
    }

    case "task": {
      if (positionals.length < 1) return usage("task <issue-url[,issue-url...]>");
      const r = task(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo },
        { govClone: ctx.home, projectWorkRoot, issueUrls: positionals[0].split(","), assignee: flagStr(flags, "assignee") ?? ctx.login ?? ctx.seededBy },
      );
      return r.ok
        ? { code: 0, lines: [`Task ${r.taskId}`, `  branched: ${r.reposBranched.length} repo(s)`, ...(r.reposSkipped.length ? [`  skipped (not cloned): ${r.reposSkipped.join(", ")}`] : [])] }
        : { code: r.code, lines: [r.message] };
    }

    case "merge": {
      if (positionals.length < 1) return usage("merge <issue-url | task-branch>");
      const r = merge(
        {
          board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log,
          // §10.10 — what governed this change, into the pull request body. Both ports are optional in `merge`
          // and both are wired here, because a stamp that only exists when someone remembers to pass a flag is
          // the same "implemented, called by nothing" state the rules compiler was in.
          ...(ctx.governanceStamp ? { stamp: ctx.governanceStamp } : {}),
          ...(ctx.stampPullRequest ? { stampPr: ctx.stampPullRequest } : {}),
        },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo },
        { govClone: ctx.home, projectWorkRoot, taskArg: positionals[0] },
      );
      return r.ok
        ? { code: 0, lines: [`Merged ${r.taskId} → ${r.projectBranch}`, `  closed issue(s): ${r.issueUrls.length}`, ...stampReport(r.stamp)] }
        : { code: r.code, lines: [r.message] };
    }

    case "close": {
      const r = close(
        // `anchor` is what lets close read the base branch seed recorded, instead of assuming dev.
        {
          board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, pulls: ctx.pulls, authorize: ctx.authorize,
          gate: ctx.gate, anchor: ctx.anchor, log: ctx.log,
          // The organization's own `when=verb:close` checks, read from the DEFAULT branch — the socket that
          // replaced the hardcoded knowledge gate (2026-09-28). A workspace with no such clause has none.
          policyGate: (projectDir) => policyGate(
            { git: ctx.git ?? (() => null), fs: ctx.fs },
            { repo: ctx.home, ref: c.defaultBranch, projectDir, branch: ctx.vcs.currentBranch(ctx.home) },
            "close",
          ),
        },
        // envBranches: the rungs BETWEEN main and dev, so a hotfix lands in every branch below its base.
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, defaultBranch: c.defaultBranch, defaultCodeBranch: c.defaultCodeBranch, envBranches: c.envBranches },
        { govClone: ctx.home, projectWorkRoot, today: ctx.today },
      );
      return r.ok
        ? { code: 0, lines: [`Project ${r.projectId} closed`, `  PR: ${r.prUrl ?? "(merged)"}`] }
        : { code: r.code, lines: [r.message, ...(r.failures ?? [])] };
    }

    case "sync": {
      const r = sync(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, defaultBranch: c.defaultBranch, defaultCodeBranch: c.defaultCodeBranch },
        { govClone: ctx.home, projectWorkRoot },
      );
      if (!r.ok) return { code: r.code, lines: [r.message] };
      // RE-MIRROR AFTER SYNC, OR THE SYNC GOVERNS NOTHING (Policy Owner, 2026-09-11).
      //
      // `sync` merges the default branch — which is where ratified governance lives (POL-086a)
      // — into the project branch. So a sync is exactly the moment the protocol can have
      // changed. It was also the moment nothing re-copied it: the rendered files moved forward
      // in the workspace repo while the mirrored copies at the project root, the ones every
      // agent actually reads, stayed at whatever they were seeded with. A sync that updates
      // governance everywhere except where it is read is a sync that reports success and
      // changes nothing an agent sees.
      // A SYNC MUST NOT CLAIM WHAT IT DID NOT DO. This line was unconditional, so a structure-only
      // organization — one that authorized no agents — was told the protocol had been re-placed when nothing
      // was written at all, and a workspace whose harness source is missing was told the same. Both are the
      // "reports success, changes nothing an agent sees" failure the comment above warns about.
      // COMPILE BEFORE MIRRORING, OR THE MIRROR CARRIES THE OLD RULES (design §7, PRJ-121, 2026-09-28).
      //
      // `sync` has just merged the default branch — where ratified governance lives (POL-086a) — into the
      // project branch. So this is the one moment an ORG'S OWN ratified clause can reach a project already in
      // flight, and it was the moment nothing compiled it: the policy documents moved forward and the resident
      // block every agent reads stayed at whatever the last hand-run of the verb produced. `ensureRootProtocol`
      // below copies `agent/harness/*` to the project root, so it must run AFTER the render or it faithfully
      // mirrors the stale bytes and reports success.
      //
      // FROM THE DEFAULT BRANCH, never `ctx.home`'s worktree: `ctx.home` is on the PROJECT branch, and a clause
      // edited there is a proposal (POL-086b). Compiling it would put a rule nobody ratified into the one block
      // guaranteed to be read — by the agent whose session wrote it.
      const built = buildRulesAt(
        { fs: ctx.fs, ...(ctx.git ? { git: ctx.git } : {}), ...(markerKey(ctx) ? { marker: { ...markerKey(ctx)!, now: ctx.now ?? (() => new Date()) } } : {}) },
        { home: ctx.home, defaultBranch: c.defaultBranch },
        "sync",
      );
      const mirror = ensureRootProtocol(ctx.fs, projectWorkRoot, c.workspaceRepo);
      return {
        // A SYNC IS NOT FAILED BY A QUESTION ABOUT CLAUSE NUMBERING. Every branch is merged and pushed by the
        // time this line runs; a non-zero exit would report failure for work that landed, and an agent reading
        // the code would re-run a sync that has nothing left to do.
        code: 0,
        lines: [
          `Synced ${r.projectBranch}`,
          `  ${r.synced.length} repo(s) up to date`,
          ...built.lines,
          ...(mirror.structureOnly
            ? ["  no agent harness placed — this organization authorized none (structure-only)"]
            : [`  session-start protocol re-placed in ${mirror.targets.length} director${mirror.targets.length === 1 ? "y" : "ies"}`]),
          ...mirrorWarnings(mirror),
          "",
          // THE MID-SESSION HALF OF THE GUARANTEE. gov cannot reach into a session already
          // running: the agent read its instructions file and will read it again next turn, but
          // whether it re-reads from disk is the agent's business, not gov's. What gov CAN do is
          // hand the person the one sentence that makes it certain — same mechanism for every
          // agent, no vendor hook.
          //
          // AND ONCE THE MARKER IS RECORDED, THE PASTE IS NOT ENOUGH. "Ask it to re-read the file" was the best
          // gov could do before §8; it is now the WRONG advice, because a re-read does not clear the marker and
          // the person would follow it, find `gov merge` still refusing, and conclude gov is broken. So the two
          // messages are mutually exclusive by construction rather than both printed and left to be reconciled.
          ...(built.pendingRecorded
            ? ["The rules in your agent's context changed, so work is closed until the session restarts:",
               "  gov work            start a fresh, governed session",
               "  gov rules reload    if you have already restarted it"]
            : ["Governance may have changed. Paste this into your running session:",
               "  Re-read the session-start protocol from disk; it has changed. Then continue."]),
        ],
      };
    }

    case "join": {
      if (positionals.length < 1) return usage("join <board-url>");
      const r = join(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, cloneRepo: ctx.cloneRepo, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, orgRepoUrl: c.orgRepoUrl, agentWorkRoot: c.agentWorkRoot },
        { boardUrl: positionals[0], identity: ctx.identity },
      );
      return r.ok
        ? { code: 0, lines: [`Joined ${r.projectId} on ${r.branch}`, `  workspace: ${r.orgGovClone}`, `  code repos: ${r.repos.length}`] }
        : { code: r.code, lines: [r.message] };
    }

    // `work` is handled in main.ts — it walks the state ladder and LAUNCHES an agent, and neither
    // prompting nor spawning belongs in a pure router.
    case "add-repo": {
      if (positionals.length < 1) return usage("add-repo <repo-url> [--base-branch <branch>]");
      const r = addRepo(
        { vcs: ctx.vcs, fs: ctx.fs, cloneRepo: ctx.cloneRepo, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, agentWorkRoot: c.agentWorkRoot, defaultCodeBranch: c.defaultCodeBranch },
        { govClone: ctx.home, projectWorkRoot, repoUrl: positionals[0], baseBranch: flagStr(flags, "base-branch"), identity: ctx.identity },
      );
      return r.ok
        ? { code: 0, lines: [`Added ${r.repoDir} on ${r.projectBranch}`] }
        : { code: r.code, lines: [r.message] };
    }

    case "list":
    case "list-all": {
      const limit = Number(flagStr(flags, "limit") ?? 20);
      const page = Math.max(1, Number(flagStr(flags, "page") ?? 1));
      const res = manageList({ projects: ctx.projects, anchor: ctx.anchor }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, command === "list-all", limit, (page - 1) * limit);
      return { code: 0, lines: pagedListLines(command === "list-all" ? "All projects" : "Ongoing projects", command, res, page, limit) };
    }

    case "status": {
      const arg = positionals[0];   // optional explicit project (id / #n / n); blank → derive from branch
      const explicitBoard = arg ? (boardNumberFromProjectId(arg) ?? undefined) : undefined;
      if (arg && explicitBoard === undefined) return { code: 2, lines: [`status: '${arg}' is not a project id or number (e.g. PRJ-43-… or 43)`] };
      const r = projectStatus({ vcs: ctx.vcs, projects: ctx.projects, anchor: ctx.anchor }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, ctx.home, explicitBoard);
      return r.ok
        ? { code: 0, lines: [`Project #${r.boardNumber}: ${r.title}`, `  status: ${r.status}`, `  owners: ${r.owners.join(", ") || "(none)"}`, `  board:  ${r.url}`] }
        : { code: r.code, lines: [r.message] };
    }

    case "manage": {
      const sub = positionals[0];
      const mcfg = { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo };
      if (sub === "list" || sub === "list-all") {
        const limit = Number(flagStr(flags, "limit") ?? 20);
        const page = Math.max(1, Number(flagStr(flags, "page") ?? 1));
        const res = manageList({ projects: ctx.projects, anchor: ctx.anchor }, mcfg, sub === "list-all", limit, (page - 1) * limit);
        return { code: 0, lines: pagedListLines("Projects (owners = anchor assignees)", `manage ${sub}`, res, page, limit) };
      }
      if (sub === "assign" || sub === "unassign") {
        if (positionals.length < 2) return usage(`manage ${sub} <github-login> [--board <n>]`);
        const boardFlag = flagStr(flags, "board");   // GOVERNED (org-home) has no project branch → target a board explicitly
        const r = manageAssign({ vcs: ctx.vcs, anchor: ctx.anchor }, mcfg, ctx.home, positionals[1], sub === "assign" ? "add" : "remove", boardFlag ? Number(boardFlag) : undefined);
        return r.ok
          ? { code: 0, lines: [`${r.action === "add" ? "Added" : "Removed"} owner ${r.login}${r.applied ? "" : " (not applied — check gh access)"}`] }
          : { code: r.code, lines: [r.message] };
      }
      return usage("manage <list|list-all|assign|unassign> …");
    }

    case "onboard": {
      const repoUrl = positionals[0], owner = flagStr(flags, "owner"), description = flagStr(flags, "description");
      if (!repoUrl || !owner || !description) return usage('onboard <repo-url> --owner <owner> --description "<description>"');
      const r = onboard(
        { vcs: ctx.vcs, fs: ctx.fs, pulls: ctx.pulls, cloneRepo: ctx.cloneRepo, log: ctx.log },
        { agentWorkRoot: c.agentWorkRoot, workspaceRepo: c.workspaceRepo, orgName: c.orgName },
        { repoUrl, owner, description },
      );
      return r.ok ? { code: 0, lines: r.lines } : { code: r.code, lines: [r.message] };
    }

    case "repo": {
      // INSTALLING POL-040a §3.3, rather than only reporting on it (Policy Owner, 2026-09-29). `plan` is the
      // default because the sub-command that changes a repository's rules should be the one you TYPE — the
      // reverse default would make a bare `gov repo protect` reconfigure a branch for somebody who wanted to
      // look.
      const sub = positionals[0];
      const USAGE = "repo protect [plan|apply] [--repo <owner/name>] [--branch <name>] [--repo-dir <path>] [--check <name>]";
      if (sub !== "protect") return usage(USAGE);
      const mode = positionals[1] ?? "plan";
      if (mode !== "plan" && mode !== "apply") return usage(USAGE);
      if (!ctx.ghApi) {
        return { code: 1, lines: ["repo protect: gov has no way to call `gh` in this context, so it neither read nor wrote anything."] };
      }
      if (!c.githubOrg) return { code: 1, lines: ["repo protect: org-config.yaml does not name this organization's GitHub org (`github_org`) — run `gov setup`."] };
      const named = flagStr(flags, "repo");
      if (!named && !c.workspaceRepo) {
        return { code: 1, lines: ["repo protect: org-config.yaml does not name this organization's governance repo (`org_gov_repo`) — run `gov setup`, or name a repo with --repo."] };
      }
      const repo = named ? (named.includes("/") ? named : `${c.githubOrg}/${named}`) : `${c.githubOrg}/${c.workspaceRepo}`;
      // THE DEFAULT BRANCH OF THE REPOSITORY IN QUESTION, which is a different key for each kind (gov-behaviour.md §3):
      // the governance repo lands on `default_branch`, a code repo on `default_code_branch`. Getting this wrong
      // would protect a branch nobody merges into and report success.
      const branch = flagStr(flags, "branch") ?? (named ? (c.defaultCodeBranch || "main") : (c.defaultBranch || "main"));
      // The governance repo IS `ctx.home` — that clone is where the workflow has to be written. For a code repo
      // gov will not guess at a path: an `apply` that wrote .github/workflows into the wrong clone is worse than
      // one that tells you where the template is.
      const repoDir = flagStr(flags, "repo-dir") ?? (named ? undefined : ctx.home);
      const check = flagStr(flags, "check");
      const orgConfigText = ctx.fs.readFile(path.join(ctx.home, "org-config.yaml"));
      const r = protectRepo(
        { gh: ctx.ghApi, fs: ctx.fs },
        {
          repo, branch, home: ctx.home, posture: c.governancePosture,
          approvers: approverLogins(orgConfigText),
          isGovernanceRepo: !named,
          ...(repoDir ? { repoDir } : {}),
          ...(check ? { approverCheck: check } : {}),
        },
        mode,
      );
      return { code: r.code, lines: r.lines };
    }

    case "rules": {
      // COMPILING THE POLICIES INTO WHAT AGENTS AND CHECKS USE. Reads the RATIFIED branch by default: a clause
      // on a project branch is a proposal (POL-086b), and compiling it would put an unratified rule into the one
      // place an agent is guaranteed to read. `--working-tree` is for an author mid-draft and says so in the output.
      const mode = positionals[0] ?? "report";

      // ── `gov rules reload` — THE HUMAN ATTESTATION THAT CLEARS THE MARKER (design §8) ────────────────────
      //
      // The marker has exactly two ways out, and neither is "a command succeeded":
      //
      //   1. A GOV-LAUNCHED SESSION. `gov work` re-places every harness file and `verifyAgentContext` refuses
      //      to hand over a session that is not governed — so by the time an agent is running, gov KNOWS it
      //      started after the change. That clearing is not a claim anybody makes; it is a consequence of a
      //      launch the agent does not control. It happens in main.ts, at the launch.
      //
      //   2. THIS. A person says "I restarted it". gov cannot verify that, so instead of pretending to, it
      //      makes the claim ATTRIBUTABLE: who, when, and which rules hash they were acknowledging, written to
      //      the run log. An agent CAN type this command — nothing in a CLI can stop it — but it cannot type it
      //      anonymously. The record names the person whose credentials ran it, and a session that cleared its
      //      own refusal and then landed work under superseded rules is visible in the log beside the merge.
      //      That is the whole mechanism: not prevention, attribution. Prevention is (1).
      //
      // It is deliberately NOT a mutating verb, so it keeps working while the marker is present — a clearing
      // command the marker blocks would be a workspace nobody can recover.
      if (mode === "reload") {
        const key = markerKey(ctx);
        if (!key) {
          return { code: 1, lines: [
            "gov rules reload: gov does not know whose session this is, so there is no marker to clear.",
            "  it is keyed by your GitHub login and your org's agent_work_root — check `gh auth status` and org-config.yaml.",
          ] };
        }
        const pending = readPending(ctx.fs, key.workRoot, key.login);
        if (!pending) return { code: 0, lines: ["gov rules reload: nothing pending — the rules have not changed since your session started."] };
        clearPending(ctx.fs, key.workRoot, key.login);
        log("info", "a person attested that they restarted their agent session", "gov-work:cli:dispatch", "rules-reload", {
          attestedBy: ctx.login, attestedEmail: ctx.seededBy, at: (ctx.now ?? (() => new Date()))().toISOString(),
          hash: pending.hash, previous: pending.previous, clauses: pending.clauses, recordedBy: pending.by, recordedAt: pending.at,
        });
        return { code: 0, lines: [
          `gov rules reload — ${pending.clauses.length} rule(s) changed at ${pending.at} (\`gov ${pending.by}\`):`,
          "",
          ...pending.clauses.map((cl) => `  ${cl}`),
          ...(pending.clauses.length ? [""] : []),
          `  rules ${pending.hash}${pending.previous ? ` (was ${pending.previous})` : ""}`,
          `  attested by ${ctx.login ?? "(unknown)"} — recorded in the run log.`,
          "",
          "  task · merge · close · knowledge propose are open again. If your session is in fact still the old",
          "  one, it is now working from rules it has not read — stop it and start again with `gov work`.",
        ] };
      }

      if (!["build", "check", "report"].includes(mode)) return usage("rules <build|check|report|reload> [--working-tree]");
      const r = rules(
        { fs: ctx.fs, ...(ctx.git ? { git: ctx.git } : {}) },
        {
          home: ctx.home, defaultBranch: c.defaultBranch, workingTree: flagBool(flags, "working-tree"),
          confirm: (flagStr(flags, "confirm") ?? "").split(",").map((p) => p.trim()).filter(Boolean),
          restamp: flagBool(flags, "restamp"),
        },
        mode as "build" | "check" | "report",
      );
      return { code: r.code, lines: r.lines };
    }

    case "knowledge": {
      const sub = positionals[0], slug = positionals[1];

      // READING comes before WRITING (tier 0, 2026-09-23). `search`/`show`/`list` answer from the markdown that
      // is already cloned — no index service, no network — and are the same three answers an agent gets through
      // `--json`. They take no slug, so they are routed before the propose/submit/archive argument check.
      if (sub === "search" || sub === "show" || sub === "list") {
        const docs = loadDocs(ctx.fs, ctx.home);
        const json = flagBool(flags, "json");

        if (sub === "list") return { code: 0, lines: json ? [JSON.stringify({ documents: docs.map((d) => d.path) }, null, 2)] : formatList(docs, positionals[1]) };

        if (sub === "show") {
          if (!slug) return usage("knowledge show <path>");
          const { doc, candidates } = resolveDoc(docs, slug);
          if (doc) return { code: 0, lines: json ? [JSON.stringify({ path: doc.path, text: doc.text }, null, 2)] : formatDoc(doc) };
          return { code: 1, lines: candidates.length ? [`'${slug}' matches ${candidates.length} documents:`, ...candidates.map((p) => `  ${p}`)] : [`No knowledge document matches '${slug}'. Try: gov knowledge search ${slug}`] };
        }

        const query = positionals.slice(1).join(" ");
        if (!query) return usage("knowledge search <text> [--json]");
        const hits = search(docs, query, Number(flagStr(flags, "limit")) || 20);
        return { code: 0, lines: json ? [hitsJson(hits, query)] : formatHits(hits, query) };
      }

      if (!["propose", "submit", "archive"].includes(sub ?? "") || !slug) return usage('knowledge <search|show|list|propose|submit|archive> …');
      const kcfg = { defaultBranch: c.defaultBranch, githubOrg: c.githubOrg, workspaceRepo: c.workspaceRepo };
      const r =
        sub === "propose" ? proposeKnowledge(ctx.vcs, kcfg, ctx.home, slug)
        : sub === "submit" ? submitKnowledge(ctx.pulls, kcfg, slug, flagStr(flags, "description") ?? "")
        : archiveKnowledge(ctx.vcs, kcfg, ctx.home, slug);
      return r.ok ? { code: 0, lines: r.lines } : { code: r.code, lines: [r.message] };
    }

    case "anchor": {
      const r = anchorShow({ vcs: ctx.vcs, anchor: ctx.anchor }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, ctx.home);
      return r.ok
        ? { code: 0, lines: [`Anchor #${r.number}: ${r.url}`, `  labels: ${r.labels.join(", ") || "(none)"}`, `  owners: ${r.owners.join(", ") || "(none)"}`] }
        : { code: r.code, lines: [r.message] };
    }

    case "pause":
    case "resume":
    case "cancel": {
      const fn = command === "pause" ? pause : command === "resume" ? resume : cancel;
      const r = fn(
        { vcs: ctx.vcs, anchor: ctx.anchor, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo },
        { govClone: ctx.home },
      );
      return r.ok
        ? { code: 0, lines: [`Project #${r.boardNumber} → ${r.status}${r.applied ? "" : " (anchor label not applied — check gh access)"}`] }
        : { code: r.code, lines: [r.message] };
    }

    default: {
      // A verb that MOVED must say where it went. `gov` used to delegate these to the gov-cicd and
      // do-admin plugins; the three clients are invoked directly now (adr-three-clients, PRJ-43), and
      // "unknown command 'deploy'" would be a worse answer than the one we can give — the reader knows
      // the verb exists, so the useful information is which binary owns it.
      const moved = MOVED_VERBS[command];
      return {
        code: 2,
        lines: [
          ...(moved
            ? [MOVED_NAMESPACES.has(command)
                 ? `'${command}' was a namespace for the ${moved} client — gov no longer forwards it.`
                 : `'${command}' is a ${moved} verb — gov no longer runs it.`,
               ...(UNRELEASED_CLIENTS.has(moved)
                 ? [`  ${moved} is not released yet — these verbs are unavailable, and there is nothing to install.`]
                 : [`  run:  ${moved} ${MOVED_NAMESPACES.has(command) ? "<verb>" : command} …`,
                    `  (install:  npm i -g @svayam/${moved})`]),
               ""]
            : [`unknown command '${command}'`]),
          "bootstrap: setup org",
          "lifecycle: seed join task merge sync add-repo close pause resume cancel",
          "info+owners: list list-all status manage anchor validate",
          "repo+knowledge+org: onboard repo knowledge org",
          "maintain: bump-version doctor deps publish upgrade",
        ],
      };
    }
  }
}
