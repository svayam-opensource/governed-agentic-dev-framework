// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `close` orchestrator (SDD Part B, close-project) — finish a project. Model
 * A (SDD-012): no project.yaml status write, no registry flip. Status becomes
 * "completed" by CLOSING THE BOARD. The project branch is promoted to the default
 * branch via a PR (worktree-safe + the governance review point), never a direct
 * checkout/push of the default branch.
 *
 * Gate-before-ship + forward-idempotent: the knowledge gate and the (injected)
 * test-merge gate run BEFORE any base-branch push or PR; code-repo merges are
 * local-first and skip when already merged; a conflict pauses for manual fix.
 */
import * as path from "node:path";
import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { Fs } from "./fs-io.js";
import type { Issues } from "./issues.js";
import type { Pulls } from "./pulls.js";
import type { BoardRef } from "./identity.js";
import { repoNameFromUrl, repoSlugFromUrl } from "./repo.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";
import { closeGate, type GateResult } from "./close-gate.js";
import { archiveBranch } from "./merge.js";
import { envLadder, mergeChain, baseBranchFor } from "./merge-chain.js";
import type { AnchorCreator } from "./anchor.js";

export interface CloseConfig {
  readonly githubOrg: string;
  readonly ownerField?: "organization" | "user";
  readonly workspaceRepo: string;
  readonly defaultBranch: string;
  /** The base branch code repos merge back into (model A: no stored base). */
  readonly defaultCodeBranch: string;
  /** env branches BETWEEN defaultBranch and defaultCodeBranch, highest first (e.g. ["uat"]). Absent → the
   *  two-rung ladder, which is correct for every estate that has not declared more. */
  readonly envBranches?: readonly string[];
  readonly remote?: string;
}

export interface CloseInput {
  readonly govClone: string;
  readonly projectWorkRoot: string;
  readonly today: string;
}

export interface CloseDeps {
  readonly board: Board;
  readonly vcs: Vcs;
  readonly fs: Fs;
  readonly issues: Issues;
  readonly pulls: Pulls;
  /** REQUIRED (C01) — write-access to the GitHub Project. Called unconditionally; no caller can omit it. */
  readonly authorize: (ref: BoardRef) => boolean;
  /** REQUIRED — the test-merge validators (Phase 3). Always run before any push. */
  readonly gate: () => GateResult;
  /** Reads the base branch recorded on the project's anchor issue. OPTIONAL: without it close
   *  assumes `defaultCodeBranch` and says so — which is every caller's behaviour before this
   *  existed, so no existing caller changes meaning by omitting it. */
  readonly anchor?: Pick<AnchorCreator, "find">;
  /**
   * The ORGANIZATION'S checks attached to `close` (`when=verb:close`), already evaluated.
   *
   * OPTIONAL, and that is the contract that let the hardcoded knowledge gate go: a workspace whose policy says
   * nothing about closing has no checks, and close behaves exactly as it did before any of this existed. The
   * caller reads them from the DEFAULT branch (`cli/policy-gate-io.ts`) — never from the branch being closed,
   * or deleting a clause on your own branch would remove the gate meant to hold you (POL-086b).
   */
  readonly policyGate?: (projectDir: string) => { readonly ok: boolean; readonly failures: readonly { readonly message: string }[] };
  /** Best-effort workspace teardown (worktree detach + rm); deferred if absent. */
  readonly cleanup?: () => void;
  readonly log?: (msg: string) => void;
}

export interface CloseSuccess {
  readonly ok: true;
  readonly projectId: string;
  readonly projectBranch: string;
  readonly boardNumber: number;
  readonly prUrl: string | null;
  readonly reposMerged: readonly string[];
  /**
   * The close PR is open and a person has to merge it. The project is COMPLETE — the board is closed and the code
   * is on its branches — and the governance branch is deliberately still there, because it is that PR's head.
   */
  readonly awaitingReview?: true;
  /** This run only archived the governance branch, because a previous run had done everything else. */
  readonly archivedOnly?: true;
}

export type CloseFailReason =
  | "not-a-project-branch"
  | "ambiguous-base"
  | "knowledge-gate"
  | "policy-gate"
  | "test-merge-gate"
  | "unauthorized"
  | "open-tasks"
  | "sync-conflict"
  | "code-merge-conflict"
  | "awaiting-review";

export type CloseResult =
  | CloseSuccess
  | { readonly ok: false; readonly code: number; readonly reason: CloseFailReason; readonly message: string; readonly failures?: readonly string[]; readonly repoDir?: string };

/** `BRNCH-<rest>` → `PRJ-<rest>` (inverse of deriveBranch). */
function projectIdFromBranch(branch: string): string {
  return branch.replace(/^brnch-/i, "PRJ-");
}

export function close(deps: CloseDeps, config: CloseConfig, input: CloseInput): CloseResult {
  const log = deps.log ?? (() => {});
  const remote = config.remote ?? "origin";
  const repo = `${config.githubOrg}/${config.workspaceRepo}`;

  const projectBranch = projectBranchOf(deps.vcs.currentBranch(input.govClone));
  const boardNumber = boardNumberFromBranch(projectBranch);
  if (boardNumber === null) {
    return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
  }
  const projectId = projectIdFromBranch(projectBranch);
  const ref: BoardRef = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
  const projectDir = path.join(input.govClone, "projects", projectId);

  // ── FINISH: a previous run left the governance branch for a person to merge ──
  //
  // This runs BEFORE every gate below, and that ordering is the point. By the time a close PR exists the project
  // is already complete: the board is closed and the code is on its branches. Re-running only to archive must not
  // be blocked by a gate about the state of a project that has finished — and `closeGate` would be evaluated
  // against a `projects/<id>/` directory this very run is about to make unreachable.
  //
  // `null` from `state()` means gov could not read the answer, and it is NOT treated as unmerged. Deleting the
  // head branch of a pull request gov merely failed to read would close that PR unmerged and lose the proposal:
  // the same asymmetry `gov doctor` draws between "unprotected" and "unknowable".
  const priorPr = deps.pulls.state(repo, projectBranch);
  if (priorPr === "merged") {
    archiveBranch(deps.vcs, input.govClone, projectBranch, remote);
    log(`'${projectBranch}' merged and archived — this project is closed.`);
    return { ok: true, projectId, projectBranch, boardNumber, prUrl: null, reposMerged: [], archivedOnly: true };
  }
  if (priorPr === "open") {
    return {
      ok: false, code: 1, reason: "awaiting-review",
      message: `The close PR for '${projectBranch}' is still open. A person merges it; then re-run \`gov close\` `
        + "to archive the branch. Nothing else is left to do — the board is already closed.",
    };
  }

  // ── the framework's own pre-close conditions (structural only; see close-gate.ts) ──
  const kGate = closeGate(deps.fs, projectDir);
  if (!kGate.ok) {
    return { ok: false, code: 1, reason: "knowledge-gate", message: "Pre-close conditions not met.", failures: kGate.failures };
  }

  // ── and whatever the ORGANIZATION asked for, in its own policy ──────────────
  const policy = deps.policyGate?.(projectDir);
  if (policy && !policy.ok) {
    return {
      ok: false, code: 1, reason: "policy-gate",
      message: `Blocked by ${policy.failures.length} policy check${policy.failures.length === 1 ? "" : "s"} on \`gov close\`.`,
      failures: policy.failures.map((f) => f.message),
    };
  }
  if (!deps.authorize(ref)) {
    return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized to close GitHub Project #${boardNumber}.` };
  }

  // ── No unmerged task sub-branches ───────────────────────────────────────────
  const openTasks = deps.vcs.remoteBranchesMatching(input.govClone, remote, `${projectBranch}.*`);
  if (openTasks.length > 0) {
    return { ok: false, code: 1, reason: "open-tasks", message: `Unmerged task sub-branches exist — merge or cancel first:\n  ${openTasks.join("\n  ")}` };
  }

  // ── Sync the project branch with the latest default ─────────────────────────
  deps.vcs.fetch(input.govClone, remote, config.defaultBranch);
  deps.vcs.fetch(input.govClone, remote, projectBranch);
  deps.vcs.checkout(input.govClone, projectBranch);
  if (deps.vcs.mergeNoEdit(input.govClone, `${remote}/${config.defaultBranch}`) === "conflict") {
    return { ok: false, code: 2, reason: "sync-conflict", message: `Merge conflict syncing ${config.defaultBranch} → ${projectBranch}. Resolve, commit, then re-run.`, repoDir: input.govClone };
  }

  // ── Merge code-repo branches → base, LOCAL ONLY (push deferred past the gate) ─
  const codeRepos = deps.board
    .fetchProject(ref)
    .repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)
    .map((u) => ({ dir: path.join(input.projectWorkRoot, repoNameFromUrl(u)), slug: repoSlugFromUrl(u) }))
    .filter((r) => (deps.fs as FsProbe).pathExists(path.join(r.dir, ".git")));
  const codeRepoDirs = codeRepos.map((r) => r.dir);

  // WHERE THIS BRANCH MUST LAND. An ordinary project was cut from `defaultCodeBranch` and the chain is that
  // one branch — byte-identical to the previous behaviour. A HOTFIX was cut from a higher env branch, and
  // must reach that one (or production is never fixed) AND every branch below it (or the next ordinary
  // release silently reverts it). See merge-chain.ts.
  // Read from the anchor issue, which is where seed recorded it. NOT from `project.yaml` — that file
  // is not written any more, so the old read always missed and the fallback below was taken every
  // time while looking like a decision. `assumed` makes the difference audible.
  const recordedBase = deps.anchor?.find(ref, config.workspaceRepo)?.baseBranch ?? null;
  const baseRead = baseBranchFor(recordedBase, config.defaultCodeBranch);
  log(
    baseRead.assumed
      ? `Base branch: assuming '${baseRead.base}' — the anchor issue records none. Correct for an ordinary project; if this was cut from a higher env branch, stop and record it before closing.`
      : `Base branch: '${baseRead.base}', recorded on the anchor issue at seed.`,
  );
  const chain = mergeChain(baseRead.base, envLadder(config, config.envBranches ?? []));
  // EVERY CODE-REPO LEG IS AN AUTHORIZED AUTOMATIC MERGE (Policy Owner, 2026-09-30).
  //
  // There used to be a split here: a leg equal to `default_branch` got a pull request, which close then merged
  // with `gh pr merge --admin` — the administrator override of the very approving review that `gov repo protect`
  // installs. The comment justifying it said "the release branch is GOVERNED", and the effect was the opposite:
  // the one leg called governed was the one where gov overrode the gate.
  //
  // The ruling separates close's two jobs by TARGET rather than by branch name. A code repo's project branch
  // returns to the branch it was cut from; that is gov completing work it started, and it needs no review and no
  // override. The GOVERNANCE repo's branch is a proposal about org-wide knowledge, and a person merges it. So
  // there is nothing to split: all of `chain` is merged locally with git, and the pull request below is the
  // governance repo's alone.
  const merged: string[] = [];
  for (const dir of codeRepoDirs) {
    for (const base of chain) {
      deps.vcs.fetch(dir, remote, base);
      deps.vcs.fetch(dir, remote, projectBranch);
      deps.vcs.checkout(dir, base);
      if (!deps.vcs.isAncestor(dir, projectBranch, base)) {
        if (deps.vcs.mergeNoEdit(dir, projectBranch) === "conflict") {
          return { ok: false, code: 2, reason: "code-merge-conflict", message: `Merge conflict: ${projectBranch} → ${base} in ${dir}. Resolve, commit, then re-run.`, repoDir: dir };
        }
      }
    }
    merged.push(dir);
  }

  // ── Test-merge gate (Phase 3 validators) — BEFORE any push, always run ───────
  const g = deps.gate();
  if (!g.ok) return { ok: false, code: 1, reason: "test-merge-gate", message: "Test-merge gate failed — nothing pushed.", failures: g.failures };

  // ── Gate passed — push every code-repo leg, highest first ──────────────────
  // Order is load-bearing and survives the removal of the pull-request leg: the branch nearest production goes
  // first, so that if a lower leg conflicts the fix has already reached the branch that needed it. The reverse
  // would leave production unfixed while a merge nobody is waiting for blocks the close. `mergeChain` already
  // returns the ladder in that order.
  for (const dir of merged) for (const base of chain) deps.vcs.push(dir, remote, base);

  deps.vcs.push(input.govClone, remote, projectBranch);
  const prUrl = deps.pulls.create(
    repo,
    config.defaultBranch,
    projectBranch,
    `close-project: ${projectId} → ${config.defaultBranch}`,
    `Automated project close for **${projectId}** (${input.today}). Promotes projects/${projectId}/ (knowledge + agent.md) to ${config.defaultBranch}. Status is GitHub-derived — the board is closed at close.`,
  );
  // GOV DOES NOT MERGE THIS. It is a proposal about org-wide knowledge, and §8.3 (POL-086c) says a proposal
  // becomes organizational standard only when a person with the authority merges it. close used to merge it
  // itself, with `--admin`, seconds after opening it.
  log(`Close PR opened${prUrl ? `: ${prUrl}` : ""} — a human merges it. Re-run \`gov close\` afterwards to archive '${projectBranch}'.`);

  // ── Close the board (THIS marks the project completed), then archive ────────
  //
  // The board closes NOW, without waiting for the pull request, and that is deliberate: a completed project
  // stays completed whether its knowledge proposal is merged, rejected or abandoned. The code is already on its
  // branches; the proposal's fate does not un-complete the work.
  deps.issues.closeBoard(ref);
  log(`board #${boardNumber} closed`);

  // THE CODE REPOS ARCHIVE; THE GOVERNANCE BRANCH DOES NOT.
  //
  // Archiving deletes the remote branch, and that branch is the open pull request's HEAD. Deleting it closes the
  // PR unmerged and loses the proposal — so the one thing close must not do here is tidy up. A later run, once a
  // person has merged, takes the `finish` path at the top of this function.
  for (const dir of merged) archiveBranch(deps.vcs, dir, projectBranch, remote);

  // ── Best-effort workspace teardown (deferred if not provided) ───────────────
  deps.cleanup?.();

  return { ok: true, projectId, projectBranch, boardNumber, prUrl, reposMerged: merged, awaitingReview: true };
}
