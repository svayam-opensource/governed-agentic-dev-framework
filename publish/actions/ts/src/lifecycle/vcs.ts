// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Vcs` port (git) + `FsProbe` port, with `git`-CLI / node:fs adapters.
 * `git` is an external tool (not a legacy script), driven via an injected runner
 * so the adapter is testable without a real repo. Read-only queries + the
 * mutating operations seed needs for phases A/B/D and rollback.
 */
import { runResult } from "../run-process.js";
import * as fs from "node:fs";
import * as path from "node:path";

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
  /** True if `repoDir`'s working tree has no uncommitted changes. Counts untracked files. */
  isClean(repoDir: string): boolean;
  /**
   * The paths `git status --porcelain -uall` reports (every untracked file, not its directory), without status letters.
   *
   * Exists because "is this repo dirty?" is the wrong question when GOV ITSELF writes files into a repo: the
   * agent harness it places is untracked, so `isClean` says no and `gov` would refuse to clean up a work root
   * because of its own output. A caller that needs to discount its own files needs to see which files they are.
   */
  dirtyPaths(repoDir: string): readonly string[];
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
  /**
   * Is `dir` a worktree registered to `baseRepo`? (#224: a present worktree is reused, not re-added.)
   *
   * OPTIONAL, like `Fs.mtimeMs`: every existing double of this port predates it, and a double without it
   * answers "no" — which sends an occupied path down the archive route, never down a destructive one.
   */
  worktreeOf?(baseRepo: string, dir: string): boolean;
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
  /**
   * Fetch `branch` from `remote` and return the sha of `<remote>/<branch>` as fetched, or null when it could not
   * be fetched (gadf#180, ruling Q3). Updates the remote-tracking ref ONLY — the local `branch` is never moved:
   * it is the developer's, and they may be standing on it. Unlike {@link fetch}, failure is an answer here, not
   * something to shrug off: a caller about to cut a branch from the result must know it is current.
   */
  fetchDefault(repoDir: string, remote: string, branch: string): string | null;
  /** Set local git identity in `repoDir` (skips undefined fields). */
  setIdentity(repoDir: string, identity: { name?: string; email?: string }): void;
  /** Check out an existing `branch` in `repoDir`. */
  checkout(repoDir: string, branch: string): void;
  /** Create and check out a new `branch` in `repoDir` — at HEAD, or at `startPoint` when given. */
  checkoutNew(repoDir: string, branch: string, startPoint?: string): void;
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

const defaultRunGit: RunGit = (args) => runResult("git", args, { pgm: "gov-work:lifecycle:vcs", fn: "git" });

/** A {@link Vcs} backed by the `git` CLI. `runGit` is injectable for tests. */
/**
 * A push GitHub refused for ITS OWN reasons, not ours — worth one more try. Seen live: `remote: fatal error in
 * commit_refs` / `[remote rejected] … (failure)` on a joiner's first push (svayam-e2e run 38482423935), a server
 * error that the same push, seconds later, does not hit; GitHub also words it `(failed)` (adopter-e2e run 38754541610). A rejection that IS ours (non-fast-forward, protected
 * branch, permission) never matches, so it fails at once, as before.
 */
export const TRANSIENT_PUSH = /fatal error in commit_refs|remote rejected\][^\n]*\(fail(?:ure|ed)\)|internal server error|returned error: 5\d\d|HTTP 5\d\d|RPC failed|early EOF|Connection reset|Could not resolve host|unexpected disconnect/i;

/**
 * git refusing to commit because it does not know who the author is (no user.name / user.email anywhere — a fresh
 * machine, a container, a CI runner): `*** Please tell me who you are.` … `fatal: empty ident name … not allowed` /
 * `fatal: unable to auto-detect email address`. git's own last line names neither setting, so gov says what to run.
 */
export const NO_GIT_IDENTITY = /Please tell me who you are|empty ident name|unable to auto-detect email address|auto-detection is disabled/i;
export const GIT_IDENTITY_HINT =
  'git does not know who you are, so it cannot commit — set it once: git config --global user.name "Your Name" && git config --global user.email you@example.com';

const sleepSync = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export function createGitVcs(runGit: RunGit = defaultRunGit, sleep: (ms: number) => void = sleepSync): Vcs {
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
    dirtyPaths(repoDir) {
      // -uall: list every untracked FILE. Without it an untracked `.cursor/` is reported as the directory, and a
      // caller discounting gov's own `.cursor/rules/agent.mdc` by name can never match it (PRJ-121 Item 6).
      const r = runGit(["-C", repoDir, "status", "--porcelain", "-uall"]);
      if (r.status !== 0) return [];
      return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
        // `XY path` — and `R  old -> new` for a rename, where the new name is what exists now.
        .map((l) => l.replace(/^\S+\s+/, "").replace(/^.*->\s*/, "").replace(/^"|"$/g, ""));
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
      const r = runGit(["-C", repoDir, "commit", "-m", message]);
      if (r.status === 0) return;
      if (NO_GIT_IDENTITY.test(r.stderr ?? "")) throw new Error(GIT_IDENTITY_HINT);
      throw new Error(`git commit failed (exit ${r.status})${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
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
      // A worktree whose directory was deleted by hand is still registered, and git then refuses the path as
      // "missing but already registered". Forgetting registrations that point at nothing is all prune does.
      runGit(["-C", baseRepo, "worktree", "prune"]);
      must(["-C", baseRepo, "worktree", "add", "-b", newBranch, worktreePath, startPoint]);
    },
    worktreeAddExisting(baseRepo, branch, worktreePath) {
      // Fetch first: the branch may exist only on the remote, left by the failed run
      // this is recovering from.
      runGit(["-C", baseRepo, "fetch", "origin", `${branch}:${branch}`]);
      runGit(["-C", baseRepo, "worktree", "prune"]);
      must(["-C", baseRepo, "worktree", "add", worktreePath, branch]);
    },
    worktreeOf(baseRepo, dir) {
      const r = runGit(["-C", baseRepo, "worktree", "list", "--porcelain"]);
      if (r.status !== 0) return false;
      // Compared through realpath: git prints resolved paths, and a caller's path may run through a symlink
      // (macOS /var → /private/var) or use the other separator (Windows). The NATIVE realpath, because only it
      // expands a Windows short name (`C:\Users\RUNNER~1\…` — what %TEMP% often is) to the long one git prints;
      // and without case on Windows, whose file names have none.
      const real = (p: string): string => {
        let r: string;
        try {
          r = fs.realpathSync.native(p);
        } catch { /* a registered worktree whose directory is gone has no realpath; compare it as written */
          r = path.resolve(p);
        }
        return process.platform === "win32" ? r.toLowerCase() : r;
      };
      const want = real(dir);
      return r.stdout.split("\n")
        .filter((l) => l.startsWith("worktree "))
        .some((l) => real(l.slice("worktree ".length).trim()) === want);
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
      const args = ["-C", repoDir, "push", ...up, remote, branch];
      // Three tries, 2 s then 4 s apart, and only for a failure on GitHub's side (TRANSIENT_PUSH).
      for (let attempt = 1; ; attempt++) {
        const r = runGit(args);
        if (r.status === 0) return;
        if (attempt >= 3 || !TRANSIENT_PUSH.test(r.stderr ?? "")) {
          throw new Error(`git ${args.join(" ")} failed (exit ${r.status})${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
        }
        sleep(2000 * attempt);
      }
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
    fetchDefault(repoDir, remote, branch) {
      // An explicit refspec, so the tracking ref is written whatever `remote.<name>.fetch` says (a single-branch
      // clone's refspec names only the branch it was cloned on). Forced (`+`) because a remote-tracking ref
      // mirrors the remote, rewinds included — it is never anyone's work.
      const r = runGit(["-C", repoDir, "fetch", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
      if (r.status !== 0) return null;
      const sha = runGit(["-C", repoDir, "rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}^{commit}`]);
      return sha.status === 0 && sha.stdout.trim() ? sha.stdout.trim() : null;
    },
    setIdentity(repoDir, identity) {
      if (identity.name) must(["-C", repoDir, "config", "user.name", identity.name]);
      if (identity.email) must(["-C", repoDir, "config", "user.email", identity.email]);
    },
    checkout(repoDir, branch) {
      must(["-C", repoDir, "checkout", branch]);
    },
    checkoutNew(repoDir, branch, startPoint) {
      must(["-C", repoDir, "checkout", "-b", branch, ...(startPoint ? [startPoint] : [])]);
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
