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
import { repoNameFromUrl } from "./repo.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";
import { closeGate, type GateResult } from "./close-gate.js";
import { archiveBranch } from "./merge.js";

export interface CloseConfig {
  readonly githubOrg: string;
  readonly ownerField?: "organization" | "user";
  readonly workspaceRepo: string;
  readonly defaultBranch: string;
  /** The base branch code repos merge back into (model A: no stored base). */
  readonly defaultCodeBranch: string;
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
  readonly authorize?: (ref: BoardRef) => boolean;
  /** The test-merge validators (Phase 3). If absent, the gate is skipped. */
  readonly gate?: () => GateResult;
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
}

export type CloseFailReason =
  | "not-a-project-branch"
  | "knowledge-gate"
  | "test-merge-gate"
  | "unauthorized"
  | "open-tasks"
  | "sync-conflict"
  | "code-merge-conflict"
  | "pr-merge-failed";

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

  // ── C01 pre-close knowledge gate ────────────────────────────────────────────
  const kGate = closeGate(deps.fs, projectDir);
  if (!kGate.ok) {
    return { ok: false, code: 1, reason: "knowledge-gate", message: "Pre-close knowledge gate failed.", failures: kGate.failures };
  }
  if (deps.authorize && !deps.authorize(ref)) {
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
  const codeRepoDirs = deps.board
    .fetchProject(ref)
    .repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)
    .map((u) => path.join(input.projectWorkRoot, repoNameFromUrl(u)))
    .filter((d) => (deps.fs as FsProbe).pathExists(path.join(d, ".git")));

  const merged: string[] = [];
  for (const dir of codeRepoDirs) {
    const base = config.defaultCodeBranch;
    deps.vcs.fetch(dir, remote, base);
    deps.vcs.fetch(dir, remote, projectBranch);
    deps.vcs.checkout(dir, base);
    if (!deps.vcs.isAncestor(dir, projectBranch, base)) {
      if (deps.vcs.mergeNoEdit(dir, projectBranch) === "conflict") {
        return { ok: false, code: 2, reason: "code-merge-conflict", message: `Merge conflict: ${projectBranch} → ${base} in ${dir}. Resolve, commit, then re-run.`, repoDir: dir };
      }
    }
    merged.push(dir);
  }

  // ── Test-merge gate (Phase 3 validators) — BEFORE any push ──────────────────
  if (deps.gate) {
    const g = deps.gate();
    if (!g.ok) return { ok: false, code: 1, reason: "test-merge-gate", message: "Test-merge gate failed — nothing pushed.", failures: g.failures };
  }

  // ── Gate passed — push code bases, then promote the branch via PR ───────────
  for (const dir of merged) deps.vcs.push(dir, remote, config.defaultCodeBranch);

  deps.vcs.push(input.govClone, remote, projectBranch);
  const prUrl = deps.pulls.create(
    repo,
    config.defaultBranch,
    projectBranch,
    `close-project: ${projectId} → ${config.defaultBranch}`,
    `Automated project close for **${projectId}** (${input.today}). Promotes projects/${projectId}/ (knowledge + agent.md) to ${config.defaultBranch}. Status is GitHub-derived — the board is closed at close.`,
  );
  const outcome = deps.pulls.merge(repo, projectBranch);
  if (outcome === "failed") {
    return { ok: false, code: 1, reason: "pr-merge-failed", message: `Could not merge the close PR${prUrl ? ` (${prUrl})` : ""}. Merge it manually, then re-run.` };
  }
  deps.vcs.fetch(input.govClone, remote, config.defaultBranch);

  // ── Close the board (THIS marks the project completed), then archive ────────
  deps.issues.closeBoard(ref);
  log(`board #${boardNumber} closed`);

  archiveBranch(deps.vcs, input.govClone, projectBranch, remote);
  for (const dir of merged) archiveBranch(deps.vcs, dir, projectBranch, remote);

  // ── Best-effort workspace teardown (deferred if not provided) ───────────────
  deps.cleanup?.();

  return { ok: true, projectId, projectBranch, boardNumber, prUrl, reposMerged: merged };
}
