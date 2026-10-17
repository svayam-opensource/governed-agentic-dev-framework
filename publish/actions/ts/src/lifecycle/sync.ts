// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `sync` (SDD Part B, sync.sh) — merge the latest default/base into the
 * active project branch across all repos, mid-project, without pausing. Model A
 * (SDD-012): project + repos derived from the workspace + GitHub. Forward-
 * idempotent (re-merging an up-to-date branch is a no-op); a conflict pauses for
 * manual resolution (rc=2).
 */
import * as path from "node:path";
import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { BoardRef } from "./identity.js";
import { repoNameFromUrl } from "./repo.js";
import { userDirtyPaths, dirtyRefusal } from "./root-protocol.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";
import { ensureProjectBranch } from "./code-repo.js";

export interface SyncConfig {
  readonly githubOrg: string;
  readonly ownerField?: "organization" | "user";
  readonly workspaceRepo: string;
  readonly defaultBranch: string;
  readonly defaultCodeBranch: string;
  readonly remote?: string;
}

export interface SyncInput {
  readonly govClone: string;
  readonly projectWorkRoot: string;
}

export interface SyncDeps {
  readonly board: Board;
  readonly vcs: Vcs;
  readonly fs: FsProbe;
  /** REQUIRED (C01) — write-access to the GitHub Project; called unconditionally. */
  readonly authorize: (ref: BoardRef) => boolean;
  readonly log?: (msg: string) => void;
}

export type SyncResult =
  | { readonly ok: true; readonly projectBranch: string; readonly boardNumber: number; readonly synced: readonly string[]; readonly recreated: readonly string[] }
  | { readonly ok: false; readonly code: number; readonly reason: "not-a-project-branch" | "unauthorized" | "dirty" | "merge-conflict"; readonly message: string; readonly repoDir?: string };

export function sync(deps: SyncDeps, config: SyncConfig, input: SyncInput): SyncResult {
  const log = deps.log ?? (() => {});
  const remote = config.remote ?? "origin";

  const projectBranch = projectBranchOf(deps.vcs.currentBranch(input.govClone));
  const boardNumber = boardNumberFromBranch(projectBranch);
  if (boardNumber === null) {
    return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
  }
  const ref: BoardRef = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
  if (!deps.authorize(ref)) {
    return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` };
  }

  const codeRepoDirs = deps.board
    .fetchProject(ref)
    .repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)
    .map((u) => path.join(input.projectWorkRoot, repoNameFromUrl(u)))
    .filter((d) => deps.fs.pathExists(path.join(d, ".git")));

  // Workspace repo syncs from the default branch; code repos from their base.
  const targets = [
    { dir: input.govClone, base: config.defaultBranch, code: false },
    ...codeRepoDirs.map((dir) => ({ dir, base: config.defaultCodeBranch, code: true })),
  ];

  for (const t of targets) {
    // gov's own harness files never block (Q7); anything else is somebody's work, so it is named.
    const dirty = userDirtyPaths(deps.vcs, t.dir);
    if (dirty.length > 0) {
      return { ok: false, code: 1, reason: "dirty", message: dirtyRefusal(t.dir, dirty), repoDir: t.dir };
    }
  }

  const synced: string[] = [];
  const recreated: string[] = [];
  for (const t of targets) {
    log(`sync ${t.base} → ${projectBranch} in ${t.dir}`);
    deps.vcs.fetch(t.dir, remote, t.base);
    // A reopened project's code repo has its worktree but not its branch — `gov close` deleted it (#224, Q17 A).
    // Recreated off the base and said, instead of dying on `checkout` after the earlier repos were synced.
    // The workspace repo needs no such check: its current branch is where the project branch was read from.
    if (t.code && ensureProjectBranch(deps.vcs, { repoDir: t.dir, projectBranch, baseBranch: t.base, remote }, log) === "recreated") {
      recreated.push(t.dir);
    }
    deps.vcs.checkout(t.dir, projectBranch);
    if (deps.vcs.mergeNoEdit(t.dir, `${remote}/${t.base}`) === "conflict") {
      return { ok: false, code: 2, reason: "merge-conflict", repoDir: t.dir, message: `Merge conflict: ${t.base} → ${projectBranch} in ${t.dir}. Resolve, commit, then re-run.` };
    }
    deps.vcs.push(t.dir, remote, projectBranch);
    synced.push(t.dir);
  }
  return { ok: true, projectBranch, boardNumber, synced, recreated };
}
