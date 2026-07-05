// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Pulls` port (SDD Part B, close-project) — promote the project branch to
 * the default branch via a PR. close NEVER checks out the default branch (the
 * workspace clone is a worktree sharing .git with the home checkout on default),
 * so the merge-to-main goes through a PR, which is also the governance review
 * point. Shells to `gh`.
 */
import type { RunGh } from "./gh-board.js";

export type PrMergeOutcome = "merged" | "already-merged" | "failed";

/** Pull-request operations close needs. */
export interface Pulls {
  /** Open a PR head→base (or return an existing one's URL); null on failure. */
  create(repo: string, base: string, head: string, title: string, body: string): string | null;
  /** Merge the PR for `head` (admin merge). */
  merge(repo: string, head: string): PrMergeOutcome;
}

/** A {@link Pulls} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhPulls(runGh: RunGh): Pulls {
  const existingUrl = (repo: string, head: string): string | null => {
    try {
      return runGh(["pr", "view", head, "--repo", repo, "--json", "url", "-q", ".url"]).trim() || null;
    } catch {
      return null;
    }
  };
  return {
    create(repo, base, head, title, body) {
      try {
        const url = runGh(["pr", "create", "--repo", repo, "--base", base, "--head", head, "--title", title, "--body", body]).trim();
        if (url) return url;
      } catch {
        /* likely already open — fall through to reuse */
      }
      return existingUrl(repo, head);
    },
    merge(repo, head) {
      try {
        runGh(["pr", "merge", head, "--repo", repo, "--merge", "--admin"]);
        return "merged";
      } catch {
        // Already merged? Treat as success (idempotent re-run).
        try {
          const state = runGh(["pr", "view", head, "--repo", repo, "--json", "state", "-q", ".state"]).trim().toUpperCase();
          return state === "MERGED" ? "already-merged" : "failed";
        } catch {
          return "failed";
        }
      }
    },
  };
}
