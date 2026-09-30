// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Pulls` port (SDD Part B, close-project) — propose the project branch to the default branch via a PR.
 *
 * GOV DOES NOT MERGE. It used to: `merge()` shelled to `gh pr merge --merge --admin`, the ADMINISTRATOR OVERRIDE
 * of the approving review, and this file's own header called the same pull request "the governance review point".
 * The review point was opened and overridden by one command — while `gov repo protect` installs "no bypass for
 * administrators" as one of the four controls it exists to enforce.
 *
 * The Policy Owner's ruling of 2026-09-30 separates the two things close does:
 *
 *   · a CODE repo's project branch merges back into the branch it was cut from — ALWAYS an authorized automatic
 *     merge, done locally with git, no pull request and nothing to override.
 *   · the GOVERNANCE repo's project branch merges into its base — ALWAYS a pull request a HUMAN merges.
 *
 * So `merge()` is gone and `state()` replaces it: close opens the proposal, leaves it, and on a later run reads
 * whether a person merged it before archiving the branch. Deleting the head branch of an open PR would close that
 * PR unmerged and lose the knowledge proposal, which is why the read exists at all.
 *
 * close NEVER checks out the default branch — the workspace clone is a worktree sharing .git with the home
 * checkout, which is on default. Shells to `gh`.
 */
import type { RunGh } from "./gh-board.js";

/**
 * What a pull request is doing now.
 *
 * `null` is NOT "open" and never collapses into it: it means gov could not read the answer, and the two lead to
 * opposite actions — an unread PR must never be treated as unmerged and have its branch deleted.
 */
export type PrState = "merged" | "open" | "closed" | null;

/** Pull-request operations close needs. */
export interface Pulls {
  /** Open a PR head→base (or return an existing one's URL); null on failure. */
  create(repo: string, base: string, head: string, title: string, body: string): string | null;
  /** Whether a person has merged the PR for `head`. `null` when it cannot be read — see {@link PrState}. */
  state(repo: string, head: string): PrState;
}

/** A {@link Pulls} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhPulls(runGh: RunGh): Pulls {
  const existingUrl = (repo: string, head: string): string | null => {
    try {
      return runGh(["pr", "view", head, "--repo", repo, "--json", "url", "-q", ".url"]).trim() || null;
    } catch { /* the runner logged this failure (run-process.ts); what a miss MEANS is this caller's to decide */
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
    state(repo, head) {
      try {
        const raw = runGh(["pr", "view", head, "--repo", repo, "--json", "state", "-q", ".state"]).trim().toUpperCase();
        if (raw === "MERGED") return "merged";
        if (raw === "OPEN") return "open";
        if (raw === "CLOSED") return "closed";
        // A state `gh` grew that we do not know is not "open" and not "merged". Unknown, so the caller waits.
        return null;
      } catch { /* the runner logged this failure (run-process.ts); what a miss MEANS is this caller's to decide */
        return null;
      }
    },
  };
}
