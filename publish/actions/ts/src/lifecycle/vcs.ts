// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Vcs` port (git) + `FsProbe` port, with `git`-CLI / node:fs adapters.
 * `git` is an external tool (not a legacy script), driven via an injected runner
 * so the adapter is testable without a real repo. Read-only queries + the
 * mutating operations seed needs for phases A/B/D and rollback.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

/** Version-control operations seed needs. */
export interface Vcs {
  // ── reads ──────────────────────────────────────────────────────────────────
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
  /**
   * The same query, keeping the SHAs (#180). Names alone can say a branch exists;
   * only the sha can say whether it carries anything — which is the difference
   * between our own failed run and somebody's work.
   */
  lsRemoteRefs(url: string): readonly { readonly name: string; readonly sha: string }[];
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

  // ── mutations ────────────────────────────────────────────────────────────────
  /** Stage `pathspec` in `repoDir`. */
  addPath(repoDir: string, pathspec: string): void;
  /** Commit staged changes with `message`. */
  commit(repoDir: string, message: string): void;
  /** Hard-reset `repoDir` to `sha`. */
  resetHard(repoDir: string, sha: string): void;
  /**
   * Move HEAD and the index back to `sha`, leaving every file on disk untouched
   * (`git reset --mixed`). The undo of choice inside a resolved workspace: it
   * un-commits without being able to destroy anything the caller did not create.
   */
  resetKeepingFiles(repoDir: string, sha: string): void;
  /** Remove untracked files under `pathspec`. */
  cleanUntracked(repoDir: string, pathspec: string): void;
  /** `git worktree add -b <newBranch> <worktreePath> <startPoint>` from `baseRepo`. */
  worktreeAdd(baseRepo: string, newBranch: string, worktreePath: string, startPoint: string): void;
  /** `git worktree add <path> <existingBranch>` — check out a branch that is already there. */
  worktreeAddExisting(baseRepo: string, branch: string, worktreePath: string): void;
  /** Remove the worktree at `worktreePath` (force; falls back to rm + prune). */
  worktreeRemove(baseRepo: string, worktreePath: string): void;
  /** Delete local `branch` in `repoDir`. */
  branchDelete(repoDir: string, branch: string): void;
  /** Push `branch` to `remote` (optionally setting upstream). */
  push(repoDir: string, remote: string, branch: string, opts?: { setUpstream?: boolean }): void;
  /** Delete `branch` on `remote`. */
  pushDelete(repoDir: string, remote: string, branch: string): void;
  /** Clone `url` into `dest` (single attempt; throws on failure). */
  clone(url: string, dest: string): void;
  /** Fetch `ref` (or everything) from `remote` into `repoDir`; best-effort (no throw). */
  fetch(repoDir: string, remote: string, ref?: string): void;
  /** Set local git identity in `repoDir` (skips undefined fields). */
  setIdentity(repoDir: string, identity: { name?: string; email?: string }): void;
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
export type RunGit = (args: string[]) => { status: number; stdout: string; stderr?: string };

const defaultRunGit: RunGit = (args) => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** A {@link Vcs} backed by the `git` CLI. `runGit` is injectable for tests. */
export function createGitVcs(runGit: RunGit = defaultRunGit): Vcs {
  /** Run a git command, throwing on non-zero exit (for mutating steps). */
  const must = (args: string[]): string => {
    const r = runGit(args);
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed (exit ${r.status})${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
    }
    return r.stdout;
  };

  return {
    localBranchExists(repoDir, branch) {
      return (
        runGit(["-C", repoDir, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status ===
        0
      );
    },
    remoteBranchExists(repoDir, remote, branch) {
      return runGit(["-C", repoDir, "ls-remote", "--exit-code", "--heads", remote, branch]).status === 0;
    },
    headSha(repoDir) {
      return must(["-C", repoDir, "rev-parse", "HEAD"]).trim();
    },
    refExists(repoDir, ref) {
      return runGit(["-C", repoDir, "show-ref", "--verify", "--quiet", ref]).status === 0;
    },
    lsRemoteRefs(url) {
      return must(["ls-remote", "--heads", url])
        .split("\n")
        .map((l) => {
          const m = /^([0-9a-f]{7,40})\s+refs\/heads\/(.+)$/.exec(l.trim());
          return m ? { sha: m[1]!, name: m[2]! } : null;
        })
        .filter((x): x is { sha: string; name: string } => x !== null);
    },
    lsRemoteHeads(url) {
      return must(["ls-remote", "--heads", url])
        .split("\n")
        .map((l) => l.match(/refs\/heads\/(.+)$/)?.[1] ?? "")
        .filter((n) => n.length > 0);
    },
    defaultBranch(url) {
      const r = runGit(["ls-remote", "--symref", url, "HEAD"]);
      if (r.status !== 0) return null;
      return r.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m)?.[1] ?? null;
    },
    revParse(repoDir, rev) {
      const r = runGit(["-C", repoDir, "rev-parse", "--verify", "--quiet", rev]);
      return r.status === 0 ? r.stdout.trim() : null;
    },
    currentBranch(repoDir) {
      return must(["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
    },
    isAncestor(repoDir, ancestor, descendant) {
      return runGit(["-C", repoDir, "merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
    },
    isClean(repoDir) {
      const r = runGit(["-C", repoDir, "status", "--porcelain"]);
      return r.status === 0 && r.stdout.trim() === "";
    },
    remoteBranchesMatching(repoDir, remote, pattern) {
      const r = runGit(["-C", repoDir, "ls-remote", "--heads", remote, pattern]);
      if (r.status !== 0) return [];
      return r.stdout
        .split("\n")
        .map((l) => l.match(/refs\/heads\/(.+)$/)?.[1] ?? "")
        .filter((n) => n.length > 0);
    },

    addPath(repoDir, pathspec) {
      must(["-C", repoDir, "add", pathspec]);
    },
    commit(repoDir, message) {
      must(["-C", repoDir, "commit", "-m", message]);
    },
    resetHard(repoDir, sha) {
      must(["-C", repoDir, "reset", "--hard", sha]);
    },
    resetKeepingFiles(repoDir, sha) {
      must(["-C", repoDir, "reset", "--mixed", sha]);
    },
    cleanUntracked(repoDir, pathspec) {
      must(["-C", repoDir, "clean", "-fd", pathspec]);
    },
    worktreeAdd(baseRepo, newBranch, worktreePath, startPoint) {
      must(["-C", baseRepo, "worktree", "add", "-b", newBranch, worktreePath, startPoint]);
    },
    worktreeAddExisting(baseRepo, branch, worktreePath) {
      // Fetch first: the branch may exist only on the remote, left by the failed run
      // this is recovering from.
      runGit(["-C", baseRepo, "fetch", "origin", `${branch}:${branch}`]);
      must(["-C", baseRepo, "worktree", "add", worktreePath, branch]);
    },
    worktreeRemove(baseRepo, worktreePath) {
      const r = runGit(["-C", baseRepo, "worktree", "remove", "--force", worktreePath]);
      if (r.status !== 0) {
        // Fallback: rm the tree, then prune the base's worktree registry.
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
        runGit(["-C", baseRepo, "worktree", "prune"]);
      }
    },
    branchDelete(repoDir, branch) {
      must(["-C", repoDir, "branch", "-D", branch]);
    },
    push(repoDir, remote, branch, opts) {
      const up = opts?.setUpstream ? ["-u"] : [];
      must(["-C", repoDir, "push", ...up, remote, branch]);
    },
    pushDelete(repoDir, remote, branch) {
      must(["-C", repoDir, "push", remote, "--delete", branch]);
    },
    clone(url, dest) {
      must(["-c", "http.postBuffer=524288000", "clone", url, dest]);
    },
    fetch(repoDir, remote, ref) {
      runGit(["-C", repoDir, "fetch", remote, ...(ref ? [ref] : []), "--tags"]); // best-effort; --tags: release tags drive content-sha
    },
    setIdentity(repoDir, identity) {
      if (identity.name) must(["-C", repoDir, "config", "user.name", identity.name]);
      if (identity.email) must(["-C", repoDir, "config", "user.email", identity.email]);
    },
    checkout(repoDir, branch) {
      must(["-C", repoDir, "checkout", branch]);
    },
    checkoutNew(repoDir, branch) {
      must(["-C", repoDir, "checkout", "-b", branch]);
    },
    mergeNoEdit(repoDir, from) {
      return runGit(["-C", repoDir, "merge", "--no-edit", from]).status === 0 ? "merged" : "conflict";
    },
    tag(repoDir, name) {
      must(["-C", repoDir, "tag", name]);
    },
  };
}

/** The real filesystem probe. */
export const nodeFsProbe: FsProbe = {
  pathExists: (p) => fs.existsSync(p),
};
