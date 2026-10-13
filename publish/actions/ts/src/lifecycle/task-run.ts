// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `task` orchestrator (SDD Part B, create-task) — model A (SDD-012): derives
 * the project from the workspace (current branch → board number) and the repos
 * from GitHub (board linked items); NO project.yaml. Creates the task sub-branch
 * in the workspace clone + each present code-repo worktree through a Transaction,
 * then reflects the task on GitHub (assign, best-effort; board Status through the
 * WorkTrackerPort, its outcome reported).
 */
import * as path from "node:path";
import { Transaction, type RollbackFailure } from "./transaction.js";
import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { Issues } from "./issues.js";
import { NO_TRACKER, STATE_NAMES, type BoardStatusOutcome, type BoardWriter } from "../ports/work-tracker.js";
import type { BoardRef } from "./identity.js";
import { repoNameFromUrl } from "./repo.js";
import { ensureProjectBranch, removedRecreatedLine } from "./code-repo.js";
import {
  parseIssueUrl,
  taskIdFor,
  projectBranchOf,
  boardNumberFromBranch,
  createSubBranch,
} from "./task.js";

export interface TaskConfig {
  readonly githubOrg: string;
  readonly ownerField?: "organization" | "user";
  readonly workspaceRepo: string;
  /**
   * The code repos' base. With it, a code repo whose project branch is missing (a closed project, reopened —
   * #224) has the branch recreated off this base instead of failing the task; without it, the old checkout error.
   */
  readonly defaultCodeBranch?: string;
  readonly remote?: string;
}

export interface TaskInput {
  /** The workspace (gov) clone the developer is in, on the project branch. */
  readonly govClone: string;
  /** The per-project workspace root holding the code-repo worktrees. */
  readonly projectWorkRoot: string;
  readonly issueUrls: readonly string[];
  readonly assignee: string;
}

export interface TaskDeps {
  readonly board: Board;
  readonly vcs: Vcs;
  readonly fs: FsProbe;
  readonly issues: Issues;
  /** Sets the board Status (gadf#225). Absent → every issue reports `unreachable`, never a silent skip. */
  readonly tracker?: BoardWriter;
  /** Optional authorization gate (viewerCanUpdate); deny → abort. */
  /** REQUIRED (C01) — write-access to the GitHub Project; called unconditionally. */
  readonly authorize: (ref: BoardRef) => boolean;
  readonly log?: (msg: string) => void;
}

export interface TaskSuccess {
  readonly ok: true;
  readonly taskId: string;
  readonly projectBranch: string;
  readonly boardNumber: number;
  readonly issueNumbers: readonly number[];
  /** Repo dirs where the sub-branch was created or resumed. */
  readonly reposBranched: readonly string[];
  /** What happened to each issue's board Status — the caller prints it; a failure never fails the task. */
  readonly boardStatus: readonly BoardStatusOutcome[];
  /** Linked repos with no local worktree (need repo-on-demand — deferred). */
  readonly reposSkipped: readonly string[];
  /** Code repos whose missing project branch was recreated off the base (#224). */
  readonly recreated: readonly string[];
}

export type TaskResult =
  | TaskSuccess
  | { readonly ok: false; readonly code: number; readonly reason: string; readonly message: string; readonly rollbackFailures?: readonly RollbackFailure[] };

export function task(deps: TaskDeps, config: TaskConfig, input: TaskInput): TaskResult {
  const log = deps.log ?? (() => {});
  const remote = config.remote ?? "origin";

  // ── Derive the project from the workspace branch ────────────────────────────
  const rawBranch = deps.vcs.currentBranch(input.govClone);
  const projectBranch = projectBranchOf(rawBranch);
  const boardNumber = boardNumberFromBranch(projectBranch);
  if (boardNumber === null) {
    return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${rawBranch}' is not a project branch (expected BRNCH-<n>-…).` };
  }
  const ref: BoardRef = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };

  // ── Parse + validate issues (open only) ─────────────────────────────────────
  if (input.issueUrls.length === 0) return { ok: false, code: 1, reason: "no-issues", message: "No issue URLs given." };
  const issueNumbers: number[] = [];
  for (const url of input.issueUrls) {
    const parsed = parseIssueUrl(url);
    if (!parsed) return { ok: false, code: 1, reason: "bad-issue-url", message: `Could not extract an issue number from '${url}'.` };
    if (deps.issues.state(url) === "CLOSED") {
      return { ok: false, code: 1, reason: "issue-closed", message: `Issue ${url} is closed — cannot start a task on it.` };
    }
    issueNumbers.push(parsed.number);
  }

  // ── Authorization (best-effort gate) ────────────────────────────────────────
  if (!deps.authorize(ref)) {
    return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` };
  }

  const taskId = taskIdFor(projectBranch, issueNumbers);
  const board = deps.board.fetchProject(ref);
  const codeRepoUrls = board.repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo);

  // ── Create sub-branches (workspace + present code worktrees) ─────────────────
  const tx = new Transaction();
  const reposBranched: string[] = [];
  const reposSkipped: string[] = [];
  const recreated: string[] = [];
  try {
    log(`task ${taskId}: workspace repo`);
    createSubBranch({ vcs: deps.vcs, tx }, { repoDir: input.govClone, projectBranch, taskId, label: "workspace repo", remote });
    reposBranched.push(input.govClone);

    for (const url of codeRepoUrls) {
      const repoDir = path.join(input.projectWorkRoot, repoNameFromUrl(url));
      if (!deps.fs.pathExists(path.join(repoDir, ".git"))) {
        reposSkipped.push(repoDir); // needs repo-on-demand (add-repo) — deferred
        continue;
      }
      // On the transaction (D3, revising #224's keep): if a later step fails, the recreated branch is deleted —
      // local and remote — and the failure says so; the next attempt recreates it.
      if (config.defaultCodeBranch
        && ensureProjectBranch(deps.vcs, { repoDir, projectBranch, baseBranch: config.defaultCodeBranch, remote }, log, tx) === "recreated") {
        recreated.push(repoDir);
      }
      createSubBranch({ vcs: deps.vcs, tx }, { repoDir, projectBranch, taskId, label: url, remote });
      reposBranched.push(repoDir);
    }
    tx.commit();
  } catch (error) {
    const rollbackFailures = tx.rollback();
    const failedUndo = new Set(rollbackFailures.map((f) => f.label));
    const removed = recreated
      .filter((dir) => !failedUndo.has(`recreated ${projectBranch} in ${dir}`))
      .map((dir) => removedRecreatedLine(projectBranch, dir));
    const message = [(error as Error).message, ...removed].join("\n");
    return { ok: false, code: 1, reason: "task-failed", message, rollbackFailures };
  }

  // ── Reflect the task on GitHub (best-effort, post-branch) ────────────────────
  const boardStatus: BoardStatusOutcome[] = [];
  for (const url of input.issueUrls) {
    deps.issues.assign(url, input.assignee);
    const result = deps.tracker ? deps.tracker.setState(ref, url, "in-progress") : NO_TRACKER;
    boardStatus.push({ issueUrl: url, status: STATE_NAMES["in-progress"], result });
  }

  return { ok: true, taskId, projectBranch, boardNumber, issueNumbers, reposBranched, reposSkipped, recreated, boardStatus };
}
