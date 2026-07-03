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
  /** The default branch `url`'s HEAD points at, or null. */
  defaultBranch(url: string): string | null;
  /** Resolve `rev` to a sha, or null if it doesn't resolve. */
  revParse(repoDir: string, rev: string): string | null;

  // ── mutations ────────────────────────────────────────────────────────────────
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

    addPath(repoDir, pathspec) {
      must(["-C", repoDir, "add", pathspec]);
    },
    commit(repoDir, message) {
      must(["-C", repoDir, "commit", "-m", message]);
    },
    resetHard(repoDir, sha) {
      must(["-C", repoDir, "reset", "--hard", sha]);
    },
    cleanUntracked(repoDir, pathspec) {
      must(["-C", repoDir, "clean", "-fd", pathspec]);
    },
    worktreeAdd(baseRepo, newBranch, worktreePath, startPoint) {
      must(["-C", baseRepo, "worktree", "add", "-b", newBranch, worktreePath, startPoint]);
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
      runGit(["-C", repoDir, "fetch", remote, ...(ref ? [ref] : [])]); // best-effort
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
  };
}

/** The real filesystem probe. */
export const nodeFsProbe: FsProbe = {
  pathExists: (p) => fs.existsSync(p),
};
