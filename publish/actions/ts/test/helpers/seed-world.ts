// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A recorded world for `seed` — a fake board, Vcs, Fs and anchor — where every MUTATING call is logged with
 * ALL of its arguments, normalised to POSIX paths.
 *
 * `seed.test.ts` has its own fakes, tuned to its assertions. This one exists for tests that ask a question
 * of the WHOLE call log ("was anything ever pushed to the default branch?", "did the undo ever touch the
 * workspace?"), which only holds if no mutating call can escape the log. So mutators are not listed one by
 * one: anything not answered as a QUERY below is a mutator by construction, and a method added to `Vcs`
 * later is recorded without anyone remembering to add it here.
 */
import type { Board, BoardProject } from "../../src/lifecycle/board.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";
import type { SeedConfig, SeedInput } from "../../src/lifecycle/seed.js";
import { px } from "./paths.js";

export const SEED_CONFIG: SeedConfig = {
  govHome: "/gov",
  workspaceRepo: "acme-gov",
  agentWorkRoot: "/awr",
  defaultBranch: "main",
  defaultCodeBranch: "dev",
  githubOrg: "Acme",
  orgTokens: { ORG_NAME: "Acme" },
  toolFiles: [],
  remote: "origin",
};
export const SEED_INPUT: SeedInput = {
  boardUrl: "https://github.com/orgs/Acme/projects/7",
  assignee: "rk",
  seededBy: "rk@acme.io",
  today: "2026-10-12",
  identity: { name: "rk", email: "rk@acme.io" },
  seederLogin: "rk",
};
export const CODE_REPO = "https://github.com/Acme/app";
export const PROJECT_BRANCH = "BRNCH-7-alpha";
export const GOV_WORKTREE = "/awr/PRJ-7-alpha/acme-gov";

export function seedBoard(over: Partial<BoardProject> = {}): Board {
  return {
    fetchProject: () => ({ id: "PVT", title: "Alpha", shortDescription: "d", linkedItemCount: 1, repoUrls: [CODE_REPO], ...over }),
  };
}

export const seedAnchor = (): AnchorCreator => ({
  createAnchorIssue: () => "Acme/acme-gov#1",
  setState: () => true,
  find: () => null,
  setAssignee: () => true,
});

export interface SeedVcsOptions {
  /** Remote refs per code-repo URL. Default: the base branch only, no project branch yet. */
  readonly remoteRefs?: readonly { readonly name: string; readonly sha: string }[];
  /** Push from these directories throws (POSIX form). */
  readonly throwPushFor?: readonly string[];
  readonly leftoverLocalBranch?: boolean;
  /** Fail any recorded call whose line matches — the message thrown is git's, as the caller would see it. */
  readonly failWhen?: (line: string) => string | null;
}

/** A Vcs whose queries answer as configured and whose every other call is recorded as `name arg1 arg2 …`. */
export function recordingVcs(opts: SeedVcsOptions = {}): { vcs: Vcs; log: string[] } {
  const log: string[] = [];
  const queries: Partial<Record<keyof Vcs, (...a: never[]) => unknown>> = {
    localBranchExists: () => opts.leftoverLocalBranch ?? false,
    remoteBranchExists: () => false,
    headSha: () => "presha",
    refExists: (_r: string, ref: string) => ref === "refs/remotes/origin/dev",
    lsRemoteHeads: () => [],
    lsRemoteRefs: () => opts.remoteRefs ?? [{ name: "dev", sha: "base-sha" }],
    defaultBranch: () => null,
    revParse: () => null,
    currentBranch: () => "main",
    isAncestor: () => false,
    isClean: () => true,
    dirtyPaths: () => [],
    remoteBranchesMatching: () => [],
    mergeNoEdit: () => "merged",
  };
  const vcs = new Proxy({} as Vcs, {
    get: (_t, name: string) => {
      const q = queries[name as keyof Vcs];
      if (q) return q;
      return (...args: unknown[]) => {
        const line = px([name, ...args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))].join(" "));
        if (name === "push" && opts.throwPushFor?.includes(px(String(args[0])))) throw new Error(`push failed: ${String(args[0])}`);
        const failure = opts.failWhen?.(line);
        if (failure) throw new Error(failure);
        log.push(line);
      };
    },
  });
  return { vcs, log };
}

/** An in-memory Fs. `existing` paths report as present; removals are modelled, not ignored. */
export function recordingFs(existing: Set<string> = new Set()): { fs: Fs; writes: string[]; removed: string[]; existing: Set<string> } {
  const writes: string[] = [];
  const removed: string[] = [];
  const fs: Fs = {
    pathExists: (p) => existing.has(px(p)),
    mkdirp: () => {},
    writeFile: (f) => { writes.push(px(f)); existing.add(px(f)); },
    readFile: (f: string) => (/todo-template\.md$/.test(f) ? "# To-do for <PROJECT_ID>\n\n## Open\n\n## Done\n" : null),
    rm: (f) => { removed.push(px(f)); existing.delete(px(f)); },
    readdir: () => [],
  };
  return { fs, writes, removed, existing };
}
