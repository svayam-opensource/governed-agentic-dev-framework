// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `sync` (SDD Part B, sync.sh, POL-122) — merge the latest default/base into the
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
import { projectBranchOf, boardNumberFromBranch } from "./task.js";

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
  readonly authorize?: (ref: BoardRef) => boolean;
  readonly log?: (msg: string) => void;
}

export type SyncResult =
  | { readonly ok: true; readonly projectBranch: string; readonly boardNumber: number; readonly synced: readonly string[] }
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
  if (deps.authorize && !deps.authorize(ref)) {
    return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` };
  }

  const codeRepoDirs = deps.board
    .fetchProject(ref)
    .repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)
    .map((u) => path.join(input.projectWorkRoot, repoNameFromUrl(u)))
    .filter((d) => deps.fs.pathExists(path.join(d, ".git")));

  // Workspace repo syncs from the default branch; code repos from their base.
  const targets = [
    { dir: input.govClone, base: config.defaultBranch },
    ...codeRepoDirs.map((dir) => ({ dir, base: config.defaultCodeBranch })),
  ];

  for (const t of targets) {
    if (!deps.vcs.isClean(t.dir)) {
      return { ok: false, code: 1, reason: "dirty", message: `Uncommitted changes in ${t.dir} — commit or stash first.`, repoDir: t.dir };
    }
  }

  const synced: string[] = [];
  for (const t of targets) {
    log(`sync ${t.base} → ${projectBranch} in ${t.dir}`);
    deps.vcs.fetch(t.dir, remote, t.base);
    deps.vcs.checkout(t.dir, projectBranch);
    if (deps.vcs.mergeNoEdit(t.dir, `${remote}/${t.base}`) === "conflict") {
      return { ok: false, code: 2, reason: "merge-conflict", repoDir: t.dir, message: `Merge conflict: ${t.base} → ${projectBranch} in ${t.dir}. Resolve, commit, then re-run.` };
    }
    deps.vcs.push(t.dir, remote, projectBranch);
    synced.push(t.dir);
  }
  return { ok: true, projectBranch, boardNumber, synced };
}
