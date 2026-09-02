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
  /**
   * Reuse a project branch that is already there, because seed's preflight decided
   * it could only have come from a failed run of this command (#180).
   */
  readonly adoptExisting?: boolean;
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
  // An existing branch is no longer fatal here (#180). seed's preflight has already
  // classified it against the remote: a branch sitting exactly on the base tip could
  // only have come from a failed run of this command, and is adopted; anything with
  // commits of its own was refused before the first write. `adoptExisting` carries
  // that verdict in, so this function never has to guess.
  const existsLocally = deps.vcs.refExists(baseClone, `refs/heads/${p.projectBranch}`);
  const existsRemotely = deps.vcs.refExists(baseClone, `refs/remotes/${remote}/${p.projectBranch}`);
  const exists = existsLocally || existsRemotely;

  // THE SAME RULE, WHEREVER THE BRANCH TURNS UP (#180).
  //
  // seed's preflight asks the REMOTE, and adopts a project branch sitting exactly on
  // the base tip because only a failed run of this command could have put it there.
  // A branch can also be left behind LOCALLY: the base clone persists between runs
  // by design (it is not rolled back), so a run that created the branch and died
  // before pushing leaves it here, invisible to `ls-remote`. The preflight then says
  // "create", and this threw "already exists — investigate" about the tool's own
  // leftover, which is the message #180 exists to remove.
  //
  // So the same question is asked again with what is knowable here: is it at the
  // base tip? Then it is ours and empty. Otherwise it holds work, and refusing is
  // right — with the reason, not with "investigate".
  let reusing = exists && p.adoptExisting === true;
  if (exists && !reusing) {
    const baseSha = deps.vcs.revParse(baseClone, `${remote}/${p.baseBranch}`);
    const branchSha = deps.vcs.revParse(baseClone, p.projectBranch)
      ?? deps.vcs.revParse(baseClone, `${remote}/${p.projectBranch}`);
    if (baseSha && branchSha && baseSha === branchSha) {
      reusing = true;
    } else {
      throw new Error(
        `Branch '${p.projectBranch}' already exists in ${p.url} and has commits of its own.\n` +
        `    That is somebody's work, not a leftover from a failed setup, so gov will not reuse it.\n` +
        `    Either finish or delete that branch, or seed this project under a different board.`,
      );
    }
  }

  deps.tx.step(
    `worktree ${repoDir}`,
    () => reusing
      // Check it out rather than create it. `-b` on an existing branch fails, and
      // deleting-then-recreating would destroy the very thing we decided to keep.
      ? deps.vcs.worktreeAddExisting(baseClone, p.projectBranch, repoDir)
      : deps.vcs.worktreeAdd(baseClone, p.projectBranch, repoDir, `${remote}/${p.baseBranch}`),
    () => {
      deps.vcs.worktreeRemove(baseClone, repoDir);
      // Only delete a branch this run created. Deleting an adopted one would undo
      // more than we did.
      if (!reusing) deps.vcs.branchDelete(baseClone, p.projectBranch);
    },
  );

  if (p.identity) deps.vcs.setIdentity(repoDir, p.identity);

  deps.tx.step(
    `push ${repoDir}`,
    () => deps.vcs.push(repoDir, remote, p.projectBranch, { setUpstream: true }),
    // Same rule: an adopted branch was already on the remote before this run.
    () => { if (!reusing) deps.vcs.pushDelete(repoDir, remote, p.projectBranch); },
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
