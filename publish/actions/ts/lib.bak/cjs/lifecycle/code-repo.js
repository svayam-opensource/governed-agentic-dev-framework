// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Phase C of seed (SDD Part B): materialize a code repo's project branch as a
 * worktree off a shared base clone, then push it. The base clone (`.bases/<repo>`)
 * is shared and persists — it is NOT rolled back; only the per-project worktree
 * and the pushed branch are compensated on failure (registered on the Transaction).
 */
import * as path from "node:path";
import { retry } from "./retry.js";
import { baseCloneDir, repoNameFromUrl } from "./repo.js";
/**
 * Ensure a shared base clone exists, guard against a pre-existing project branch,
 * then add + push the project-branch worktree. Rollback (worktree remove + branch
 * delete, and pushed-branch delete) is registered on the Transaction as steps run.
 * Throws (triggering the caller's rollback) if the base branch is missing or the
 * project branch already exists in the repo.
 */
export function setupCodeRepoWorktree(deps, p) {
    const remote = p.remote ?? "origin";
    const repoDir = path.join(p.projectWorkRoot, repoNameFromUrl(p.url));
    const baseClone = baseCloneDir(p.agentWorkRoot, p.url);
    // One shared base clone per repo (persists — not rolled back).
    if (!deps.fs.pathExists(path.join(baseClone, ".git"))) {
        deps.cloneRepo(p.url, baseClone);
    }
    deps.vcs.fetch(baseClone, remote, p.baseBranch);
    if (!deps.vcs.refExists(baseClone, `refs/remotes/${remote}/${p.baseBranch}`)) {
        throw new Error(`Base branch '${p.baseBranch}' not found in ${p.url}`);
    }
    if (deps.vcs.refExists(baseClone, `refs/heads/${p.projectBranch}`) ||
        deps.vcs.refExists(baseClone, `refs/remotes/${remote}/${p.projectBranch}`)) {
        throw new Error(`Branch '${p.projectBranch}' already exists in ${p.url} — investigate.`);
    }
    deps.tx.step(`worktree ${repoDir}`, () => deps.vcs.worktreeAdd(baseClone, p.projectBranch, repoDir, `${remote}/${p.baseBranch}`), () => {
        deps.vcs.worktreeRemove(baseClone, repoDir);
        deps.vcs.branchDelete(baseClone, p.projectBranch);
    });
    if (p.identity)
        deps.vcs.setIdentity(repoDir, p.identity);
    deps.tx.step(`push ${repoDir}`, () => deps.vcs.push(repoDir, remote, p.projectBranch, { setUpstream: true }), () => deps.vcs.pushDelete(repoDir, remote, p.projectBranch));
    return { repoDir, baseClone };
}
/**
 * Build a retry-wrapped `cloneRepo` (the `git_clone_retry` behavior): remove any
 * partial `dest`, then clone, retrying with backoff. `rmDir` + retry `sleep` are
 * injected so this is testable without touching disk or waiting.
 */
export function makeCloneRepo(vcs, deps) {
    return (url, dest) => retry(() => {
        deps.rmDir(dest);
        vcs.clone(url, dest);
    }, deps);
}
