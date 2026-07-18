/** Version-control operations seed needs. */
export interface Vcs {
    /** True if `branch` exists locally in `repoDir`. */
    localBranchExists(repoDir: string, branch: string): boolean;
    /** True if `branch` exists on `remote` (as seen from `repoDir`). */
    remoteBranchExists(repoDir: string, remote: string, branch: string): boolean;
    /** The current HEAD sha of `repoDir`. */
    headSha(repoDir: string): string;
    /** True if `ref` (e.g. `refs/heads/x`, `refs/remotes/origin/x`) exists in `repoDir`. */
    refExists(repoDir: string, ref: string): boolean;
    /** The branch names on `url`'s remote (`ls-remote --heads`). */
    lsRemoteHeads(url: string): string[];
    /** The default branch `url`'s HEAD points at, or null. */
    defaultBranch(url: string): string | null;
    /** Resolve `rev` to a sha, or null if it doesn't resolve. */
    revParse(repoDir: string, rev: string): string | null;
    /** The current branch of `repoDir` (`rev-parse --abbrev-ref HEAD`). */
    currentBranch(repoDir: string): string;
    /** True if `ancestor` is an ancestor of `descendant` (`merge-base --is-ancestor`). */
    isAncestor(repoDir: string, ancestor: string, descendant: string): boolean;
    /** True if `repoDir`'s working tree has no uncommitted changes. */
    isClean(repoDir: string): boolean;
    /** Remote branch names matching `pattern` (e.g. `BRNCH-43-x.*`), from `remote`. */
    remoteBranchesMatching(repoDir: string, remote: string, pattern: string): string[];
    /** Stage `pathspec` in `repoDir`. */
    addPath(repoDir: string, pathspec: string): void;
    /** Commit staged changes with `message`. */
    commit(repoDir: string, message: string): void;
    /** Hard-reset `repoDir` to `sha`. */
    resetHard(repoDir: string, sha: string): void;
    /** Remove untracked files under `pathspec`. */
    cleanUntracked(repoDir: string, pathspec: string): void;
    /** `git worktree add -b <newBranch> <worktreePath> <startPoint>` from `baseRepo`. */
    worktreeAdd(baseRepo: string, newBranch: string, worktreePath: string, startPoint: string): void;
    /** Remove the worktree at `worktreePath` (force; falls back to rm + prune). */
    worktreeRemove(baseRepo: string, worktreePath: string): void;
    /** Delete local `branch` in `repoDir`. */
    branchDelete(repoDir: string, branch: string): void;
    /** Push `branch` to `remote` (optionally setting upstream). */
    push(repoDir: string, remote: string, branch: string, opts?: {
        setUpstream?: boolean;
    }): void;
    /** Delete `branch` on `remote`. */
    pushDelete(repoDir: string, remote: string, branch: string): void;
    /** Clone `url` into `dest` (single attempt; throws on failure). */
    clone(url: string, dest: string): void;
    /** Fetch `ref` (or everything) from `remote` into `repoDir`; best-effort (no throw). */
    fetch(repoDir: string, remote: string, ref?: string): void;
    /** Set local git identity in `repoDir` (skips undefined fields). */
    setIdentity(repoDir: string, identity: {
        name?: string;
        email?: string;
    }): void;
    /** Check out an existing `branch` in `repoDir`. */
    checkout(repoDir: string, branch: string): void;
    /** Create and check out a new `branch` in `repoDir`. */
    checkoutNew(repoDir: string, branch: string): void;
    /** Merge `from` into the current branch (`--no-edit`); "merged" or "conflict" (no throw). */
    mergeNoEdit(repoDir: string, from: string): "merged" | "conflict";
    /** Create a tag `name` at HEAD in `repoDir`. */
    tag(repoDir: string, name: string): void;
}
/** A minimal filesystem-existence probe (kept separate from git). */
export interface FsProbe {
    pathExists(path: string): boolean;
}
/** Runs `git <args>`; returns exit status + stdout/stderr (never throws). */
export type RunGit = (args: string[]) => {
    status: number;
    stdout: string;
    stderr?: string;
};
/** A {@link Vcs} backed by the `git` CLI. `runGit` is injectable for tests. */
export declare function createGitVcs(runGit?: RunGit): Vcs;
/** The real filesystem probe. */
export declare const nodeFsProbe: FsProbe;
