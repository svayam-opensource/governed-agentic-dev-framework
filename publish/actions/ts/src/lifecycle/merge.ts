// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `merge` orchestrator (SDD Part B, merge-task) — merge a completed task
 * sub-branch back into the project branch across all repos, archive the
 * sub-branch, and close the issue(s). Model A (SDD-012): project + repos derived
 * from the workspace + GitHub; no project.yaml.
 *
 * Forward-idempotent (NOT transactional): a merge conflict pauses for manual
 * resolution (rc=2) and a re-run skips already-merged repos via
 * `merge-base --is-ancestor`, so a partial run never strands state. Archiving is
 * deferred until every merge+push succeeds.
 */
import * as path from "node:path";
import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { Issues } from "./issues.js";
import type { BoardRef } from "./identity.js";
import { repoNameFromUrl } from "./repo.js";
import { parseIssueUrl, taskIdFor, projectBranchOf, boardNumberFromBranch } from "./task.js";

export interface MergeConfig {
  readonly githubOrg: string;
  readonly ownerField?: "organization" | "user";
  readonly workspaceRepo: string;
  readonly remote?: string;
}

export interface MergeInput {
  readonly govClone: string;
  readonly projectWorkRoot: string;
  /** Either an issue URL (single-issue task) or the task sub-branch itself. */
  readonly taskArg: string;
}

export interface MergeDeps {
  readonly board: Board;
  readonly vcs: Vcs;
  readonly fs: FsProbe;
  readonly issues: Issues;
  /** REQUIRED (C01) — write-access to the GitHub Project; called unconditionally. */
  readonly authorize: (ref: BoardRef) => boolean;
  /**
   * WHAT GOVERNED THIS CHANGE (design §10.10) — the rules hash, the POL-lock versions, the gov version.
   *
   * Optional, and a failure is a `error` rather than a throw, because this is a RECORD of a merge that has
   * already happened. By the time it is called every branch is pushed and every issue closed; refusing here
   * would leave the work landed and the command reporting failure.
   */
  readonly stamp?: () => { readonly lines?: readonly string[]; readonly error?: string };
  /**
   * Put the stamp in the pull request whose head branch is the task branch, from inside `repoDir`.
   *
   * `repoDir` rather than an `owner/name`: the task branch exists in several repositories at once, each with
   * its own pull request or none, and the directory is the only handle that resolves to the right one without
   * this module learning how repositories are named.
   */
  readonly stampPr?: (repoDir: string, head: string, lines: readonly string[]) => StampOutcome;
  readonly log?: (msg: string) => void;
}

export type StampOutcome = "stamped" | "no-pr" | "failed";

/** What merge managed to record about the rules in force, for the caller to print. */
export interface MergeStamp {
  readonly lines: readonly string[];
  readonly placed: readonly { readonly repoDir: string; readonly outcome: StampOutcome }[];
  /** Why the facts could not be computed. Present ⇒ `lines` is empty and nothing was stamped. */
  readonly error?: string;
}

export interface MergeSuccess {
  readonly ok: true;
  readonly taskId: string;
  readonly projectBranch: string;
  readonly boardNumber: number;
  readonly issueUrls: readonly string[];
  readonly reposMerged: readonly string[];
  readonly reposSkipped: readonly string[];
  /** Absent when no `stamp` dep was wired — the behaviour every caller had before §10.10. */
  readonly stamp?: MergeStamp;
}

export type MergeFailReason =
  | "not-a-project-branch"
  | "not-a-task"
  | "no-subbranch"
  | "dirty"
  | "unauthorized"
  | "merge-conflict";

export type MergeResult =
  | MergeSuccess
  | { readonly ok: false; readonly code: number; readonly reason: MergeFailReason; readonly message: string; readonly repoDir?: string };

/** Archive a merged sub-branch: tag `archive/<branch>` + push it, then delete the
 *  branch locally + remotely (delete is best-effort). Shared with close. */
export function archiveBranch(vcs: Vcs, repoDir: string, branch: string, remote: string): void {
  const tag = `archive/${branch}`;
  vcs.tag(repoDir, tag); // gating: a failed archive must not delete the branch
  vcs.push(repoDir, remote, tag);
  try {
    vcs.pushDelete(repoDir, remote, branch);
  } catch {
    /* remote branch may already be gone */
  }
  try {
    vcs.branchDelete(repoDir, branch);
  } catch {
    /* local branch may not exist (e.g. workspace never checked it out) */
  }
}

export function merge(deps: MergeDeps, config: MergeConfig, input: MergeInput): MergeResult {
  const log = deps.log ?? (() => {});
  const remote = config.remote ?? "origin";

  const projectBranch = projectBranchOf(deps.vcs.currentBranch(input.govClone));
  const boardNumber = boardNumberFromBranch(projectBranch);
  if (boardNumber === null) {
    return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
  }
  const ref: BoardRef = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };

  // Resolve taskArg → taskId + the issue URLs it closes.
  let taskId: string;
  let issueUrls: string[];
  const parsed = parseIssueUrl(input.taskArg);
  if (parsed) {
    taskId = taskIdFor(projectBranch, [parsed.number]);
    issueUrls = [input.taskArg];
  } else if (input.taskArg.startsWith(`${projectBranch}.ISSUE-`)) {
    taskId = input.taskArg;
    const numbers = taskId
      .slice(`${projectBranch}.ISSUE-`.length)
      .split("-")
      .map(Number)
      .filter((n) => Number.isInteger(n));
    issueUrls = numbers.map((n) => deps.issues.resolveIssueUrl(ref, n)).filter((u): u is string => !!u);
  } else {
    return { ok: false, code: 1, reason: "not-a-task", message: `'${input.taskArg}' is neither an issue URL nor a '${projectBranch}.ISSUE-…' branch.` };
  }

  if (!deps.authorize(ref)) {
    return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` };
  }
  if (!deps.vcs.remoteBranchExists(input.govClone, remote, taskId)) {
    return { ok: false, code: 1, reason: "no-subbranch", message: `No sub-branch '${taskId}' on the remote — was the task created?` };
  }

  const board = deps.board.fetchProject(ref);
  const codeRepoDirs = board.repoUrls
    .filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)
    .map((u) => path.join(input.projectWorkRoot, repoNameFromUrl(u)));
  const reposSkipped = codeRepoDirs.filter((d) => !deps.fs.pathExists(path.join(d, ".git")));
  const repos = [input.govClone, ...codeRepoDirs.filter((d) => deps.fs.pathExists(path.join(d, ".git")))];

  // All working trees must be clean before merging.
  for (const dir of repos) {
    if (!deps.vcs.isClean(dir)) {
      return { ok: false, code: 1, reason: "dirty", message: `Uncommitted changes in ${dir} — commit or stash first.`, repoDir: dir };
    }
  }

  // Merge per repo (idempotent: skip when already merged).
  const reposMerged: string[] = [];
  for (const dir of repos) {
    deps.vcs.fetch(dir, remote, taskId);
    if (deps.vcs.isAncestor(dir, taskId, projectBranch)) {
      log(`already merged in ${dir} — skipping`);
      reposMerged.push(dir);
      continue;
    }
    deps.vcs.checkout(dir, projectBranch);
    if (deps.vcs.mergeNoEdit(dir, taskId) === "conflict") {
      return {
        ok: false,
        code: 2,
        reason: "merge-conflict",
        repoDir: dir,
        message: `Merge conflict: ${taskId} → ${projectBranch} in ${dir}. Resolve, commit, then re-run.`,
      };
    }
    deps.vcs.push(dir, remote, projectBranch);
    reposMerged.push(dir);
  }

  // STAMP BEFORE ARCHIVING. `archiveBranch` deletes the remote task branch, and a pull request is found by its
  // HEAD BRANCH — so a stamp attempted afterwards would be looking for a branch that no longer exists and would
  // report "no pull request" for every task that had one. This is the only ordering that works.
  const stamp = stampGovernance(deps, taskId, reposMerged);

  // Every merge+push succeeded — now safe to archive across all repos.
  for (const dir of reposMerged) archiveBranch(deps.vcs, dir, taskId, remote);

  // Close the issue(s) + mark Done on the board (best-effort).
  for (const url of issueUrls) {
    deps.issues.close(url, `Task \`${taskId}\` merged into \`${projectBranch}\`.`);
    deps.issues.setBoardStatus(ref, url, "Done");
  }

  return { ok: true, taskId, projectBranch, boardNumber, issueUrls, reposMerged, reposSkipped, ...(stamp ? { stamp } : {}) };
}

/**
 * Compute the governance stamp and put it wherever there is a pull request to put it in (§10.10).
 *
 * Separate from `merge` so the ordering constraint above is the only thing `merge` has to hold, and so a
 * `stampPr` that is absent (no terminal, no `gh`) degrades to "the facts, printed" rather than to nothing: the
 * lines still reach the run log through the command's own output, which is the minimum the audit needs.
 */
function stampGovernance(deps: MergeDeps, taskId: string, reposMerged: readonly string[]): MergeStamp | undefined {
  if (!deps.stamp) return undefined;
  const got = deps.stamp();
  if (got.error || !got.lines?.length) {
    return { lines: [], placed: [], error: got.error ?? "the stamp came back empty" };
  }
  const lines = got.lines;
  const placed = deps.stampPr
    ? reposMerged.map((repoDir) => ({ repoDir, outcome: deps.stampPr!(repoDir, taskId, lines) }))
    : [];
  return { lines, placed };
}
