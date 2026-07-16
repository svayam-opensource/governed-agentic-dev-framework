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
  readonly authorize?: (ref: BoardRef) => boolean;
  readonly log?: (msg: string) => void;
}

export interface MergeSuccess {
  readonly ok: true;
  readonly taskId: string;
  readonly projectBranch: string;
  readonly boardNumber: number;
  readonly issueUrls: readonly string[];
  readonly reposMerged: readonly string[];
  readonly reposSkipped: readonly string[];
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

  if (deps.authorize && !deps.authorize(ref)) {
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

  // Every merge+push succeeded — now safe to archive across all repos.
  for (const dir of reposMerged) archiveBranch(deps.vcs, dir, taskId, remote);

  // Close the issue(s) + mark Done on the board (best-effort).
  for (const url of issueUrls) {
    deps.issues.close(url, `Task \`${taskId}\` merged into \`${projectBranch}\`.`);
    deps.issues.setBoardStatus(ref, url, "Done");
  }

  return { ok: true, taskId, projectBranch, boardNumber, issueUrls, reposMerged, reposSkipped };
}
