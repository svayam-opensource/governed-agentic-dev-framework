// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Phase C of seed (SDD Part B): materialize a code repo's project branch as a
 * worktree off a shared base clone, then push it. The base clone (`.bases/<repo>`)
 * is shared and persists — it is NOT rolled back; only the per-project worktree
 * and the pushed branch are compensated on failure (registered on the Transaction).
 */
import * as path from "node:path";
import type { FsProbe, Vcs } from "./vcs.js";
import type { Transaction } from "./transaction.js";
import { retry, type RetryOptions } from "./retry.js";
import { ensureBaseFresh, repoNameFromUrl } from "./repo.js";

/** Parameters for setting up one code repo's project-branch worktree. */
export interface CodeRepoParams {
  readonly url: string;
  readonly baseBranch: string;
  readonly projectBranch: string;
  readonly agentWorkRoot: string;
  readonly projectWorkRoot: string;
  readonly remote?: string;
  readonly identity?: { name?: string; email?: string };
}

/** Dependencies for {@link setupCodeRepoWorktree}. */
export interface CodeRepoDeps {
  readonly vcs: Vcs;
  readonly fs: FsProbe;
  readonly tx: Transaction;
  /** Clone `url` into `dest` (retry-wrapped; see {@link makeCloneRepo}). */
  readonly cloneRepo: (url: string, dest: string) => void;
}

/**
 * Ensure a shared base clone exists, guard against a pre-existing project branch,
 * then add + push the project-branch worktree. Rollback (worktree remove + branch
 * delete, and pushed-branch delete) is registered on the Transaction as steps run.
 * Throws (triggering the caller's rollback) if the base branch is missing or the
 * project branch already exists in the repo.
 */
export function setupCodeRepoWorktree(
  deps: CodeRepoDeps,
  p: CodeRepoParams,
): { repoDir: string; baseClone: string } {
  const remote = p.remote ?? "origin";
  const repoDir = path.join(p.projectWorkRoot, repoNameFromUrl(p.url));

  // One shared base clone per repo (persists — not rolled back): ensure it exists AND is synced, via the
  // single base-access seam so a worktree is never cut from a stale base (same guarantee as a governed deploy).
  const baseClone = ensureBaseFresh(
    { pathExists: (x) => deps.fs.pathExists(x), cloneRepo: (u, d) => deps.cloneRepo(u, d), fetch: (d, r, ref) => deps.vcs.fetch(d, r, ref) },
    p.agentWorkRoot, p.url, remote, p.baseBranch,
  );

  if (!deps.vcs.refExists(baseClone, `refs/remotes/${remote}/${p.baseBranch}`)) {
    throw new Error(`Base branch '${p.baseBranch}' not found in ${p.url}`);
  }
  if (
    deps.vcs.refExists(baseClone, `refs/heads/${p.projectBranch}`) ||
    deps.vcs.refExists(baseClone, `refs/remotes/${remote}/${p.projectBranch}`)
  ) {
    throw new Error(`Branch '${p.projectBranch}' already exists in ${p.url} — investigate.`);
  }

  deps.tx.step(
    `worktree ${repoDir}`,
    () => deps.vcs.worktreeAdd(baseClone, p.projectBranch, repoDir, `${remote}/${p.baseBranch}`),
    () => {
      deps.vcs.worktreeRemove(baseClone, repoDir);
      deps.vcs.branchDelete(baseClone, p.projectBranch);
    },
  );

  if (p.identity) deps.vcs.setIdentity(repoDir, p.identity);

  deps.tx.step(
    `push ${repoDir}`,
    () => deps.vcs.push(repoDir, remote, p.projectBranch, { setUpstream: true }),
    () => deps.vcs.pushDelete(repoDir, remote, p.projectBranch),
  );

  return { repoDir, baseClone };
}

/**
 * Build a retry-wrapped `cloneRepo` (the `git_clone_retry` behavior): remove any
 * partial `dest`, then clone, retrying with backoff. `rmDir` + retry `sleep` are
 * injected so this is testable without touching disk or waiting.
 */
export function makeCloneRepo(
  vcs: Pick<Vcs, "clone">,
  deps: { rmDir: (dir: string) => void } & RetryOptions,
): (url: string, dest: string) => void {
  return (url, dest) =>
    retry(() => {
      deps.rmDir(dest);
      vcs.clone(url, dest);
    }, deps);
}
