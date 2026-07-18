// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `add-repo` / repo-on-demand (SDD Part B, add-repo.sh) — bring a code repo into
 * an active project by materializing its project-branch worktree. Model A
 * (SDD-012): there is no project.yaml repos[] to update — "membership" is the
 * board's linked items + the local worktree. So add-repo is exactly
 * `setupCodeRepoWorktree` (shared base clone → worktree off base → push), with a
 * Transaction so a failure unwinds.
 */
import { Transaction, type RollbackFailure } from "./transaction.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { BoardRef } from "./identity.js";
import { setupCodeRepoWorktree } from "./code-repo.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";

export interface AddRepoConfig {
  readonly githubOrg: string;
  readonly ownerField?: "organization" | "user";
  readonly agentWorkRoot: string;
  readonly defaultCodeBranch: string;
  readonly remote?: string;
}

export interface AddRepoInput {
  readonly govClone: string;
  readonly projectWorkRoot: string;
  readonly repoUrl: string;
  readonly baseBranch?: string;
  readonly identity?: { name?: string; email?: string };
}

export interface AddRepoDeps {
  readonly vcs: Vcs;
  readonly fs: FsProbe;
  readonly cloneRepo: (url: string, dest: string) => void;
  /** REQUIRED (C01) — write-access to the GitHub Project; called unconditionally. */
  readonly authorize: (ref: BoardRef) => boolean;
  readonly log?: (msg: string) => void;
}

export type AddRepoResult =
  | { readonly ok: true; readonly repoDir: string; readonly projectBranch: string; readonly boardNumber: number }
  | { readonly ok: false; readonly code: number; readonly reason: "not-a-project-branch" | "unauthorized" | "add-failed"; readonly message: string; readonly rollbackFailures?: readonly RollbackFailure[] };

export function addRepo(deps: AddRepoDeps, config: AddRepoConfig, input: AddRepoInput): AddRepoResult {
  const projectBranch = projectBranchOf(deps.vcs.currentBranch(input.govClone));
  const boardNumber = boardNumberFromBranch(projectBranch);
  if (boardNumber === null) {
    return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
  }
  const ref: BoardRef = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
  if (!deps.authorize(ref)) {
    return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` };
  }

  const tx = new Transaction();
  try {
    const { repoDir } = setupCodeRepoWorktree(
      { vcs: deps.vcs, fs: deps.fs, tx, cloneRepo: deps.cloneRepo },
      {
        url: input.repoUrl,
        baseBranch: input.baseBranch ?? config.defaultCodeBranch,
        projectBranch,
        agentWorkRoot: config.agentWorkRoot,
        projectWorkRoot: input.projectWorkRoot,
        remote: config.remote ?? "origin",
        identity: input.identity,
      },
    );
    tx.commit();
    return { ok: true, repoDir, projectBranch, boardNumber };
  } catch (error) {
    const rollbackFailures = tx.rollback();
    return { ok: false, code: 1, reason: "add-failed", message: (error as Error).message, rollbackFailures };
  }
}
