// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Vcs` port (git) + `FsProbe` port, with `git`-CLI / node:fs adapters.
 * `git` is an external tool (not a legacy script), driven via an injected runner
 * so the adapter is testable without a real repo. Read-only methods land here in
 * seed slice 3; the mutating operations (clone / worktree / push / delete) arrive
 * in slice 4.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

/** Version-control queries seed needs (read-only for now). */
export interface Vcs {
  /** True if `branch` exists locally in `repoDir`. */
  localBranchExists(repoDir: string, branch: string): boolean;
  /** True if `branch` exists on `remote` (as seen from `repoDir`). */
  remoteBranchExists(repoDir: string, remote: string, branch: string): boolean;
}

/** A minimal filesystem-existence probe (kept separate from git). */
export interface FsProbe {
  pathExists(path: string): boolean;
}

/** Runs `git <args>`; returns the exit status + stdout (never throws). */
export type RunGit = (args: string[]) => { status: number; stdout: string };

const defaultRunGit: RunGit = (args) => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
};

/** A {@link Vcs} backed by the `git` CLI. `runGit` is injectable for tests. */
export function createGitVcs(runGit: RunGit = defaultRunGit): Vcs {
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
  };
}

/** The real filesystem probe. */
export const nodeFsProbe: FsProbe = {
  pathExists: (p) => fs.existsSync(p),
};
