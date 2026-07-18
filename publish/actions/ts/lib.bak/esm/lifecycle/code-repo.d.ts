import type { FsProbe, Vcs } from "./vcs.js";
import type { Transaction } from "./transaction.js";
import { type RetryOptions } from "./retry.js";
/** Parameters for setting up one code repo's project-branch worktree. */
export interface CodeRepoParams {
    readonly url: string;
    readonly baseBranch: string;
    readonly projectBranch: string;
    readonly agentWorkRoot: string;
    readonly projectWorkRoot: string;
    readonly remote?: string;
    readonly identity?: {
        name?: string;
        email?: string;
    };
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
export declare function setupCodeRepoWorktree(deps: CodeRepoDeps, p: CodeRepoParams): {
    repoDir: string;
    baseClone: string;
};
/**
 * Build a retry-wrapped `cloneRepo` (the `git_clone_retry` behavior): remove any
 * partial `dest`, then clone, retrying with backoff. `rmDir` + retry `sleep` are
 * injected so this is testable without touching disk or waiting.
 */
export declare function makeCloneRepo(vcs: Pick<Vcs, "clone">, deps: {
    rmDir: (dir: string) => void;
} & RetryOptions): (url: string, dest: string) => void;
