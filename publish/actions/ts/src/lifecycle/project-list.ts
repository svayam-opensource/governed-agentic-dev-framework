// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Projects` port (SDD Part D, manage) — list the org's GitHub Project boards.
 * GitHub-definitive (registry-elimination): the project universe is the org's
 * boards. gh-backed; injectable for tests.
 */
import type { RunGh } from "./gh-board.js";

export interface BoardSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly closed: boolean;
}

export interface Projects {
  /** All Project boards for `owner` (open + closed). */
  listBoards(owner: string): BoardSummary[];
  /** Why the most recent listBoards returned nothing because gh FAILED — null when it answered. An empty list
   *  is two different facts ("no boards" vs "GitHub did not answer"); callers that tell a person which one
   *  must ask (PRJ-121, 2026-09-22). */
  lastFailure?(): string | null;
}

/**
 * IS THIS FAILURE GITHUB SAYING "SLOW DOWN"? — read from a {@link Projects.lastFailure} message.
 *
 * `lastFailure` already separated "GitHub did not answer" from "you have no projects" (a walk,
 * 2026-09-22). Throttling is the next distinction that matters, because the REMEDY differs: a bad
 * token wants `gh auth status`, a dropped network wants a retry, and a rate limit wants a minute and a
 * list that costs no calls at all. Telling a person to check their auth while GitHub is simply
 * counting their requests sends them to fix something that is not broken.
 *
 * Primary limits say "API rate limit exceeded", secondary ones "You have exceeded a secondary rate
 * limit" or "was submitted too quickly"; both can arrive as HTTP 403 or 429, and older gh builds say
 * "abuse detection mechanism". Matched on the text because that is all `gh` gives a caller.
 */
const RATE_LIMITED = /rate[ -]?limit|secondary rate|too many requests|\b429\b|submitted too quickly|retry after|abuse detection/i;
export const isRateLimited = (failure: string | null | undefined): boolean => !!failure && RATE_LIMITED.test(failure);

export function createGhProjects(runGh: RunGh): Projects {
  let failure: string | null = null;
  return {
    lastFailure: () => failure,
    listBoards(owner) {
      failure = null;
      try {
        // `gh project list` is board METADATA only (no items) — it does NOT hit the org-wide
        // projectsV2×items query that 504s on large orgs. `--limit 1000` avoids the old `--limit 100`
        // truncation that could hide a user's project in an org with many boards.
        const out = runGh(["project", "list", "--owner", owner, "--format", "json", "--limit", "1000"]);
        const d = JSON.parse(out) as { projects?: Array<{ number?: number; title?: string; url?: string; closed?: boolean }> };
        return (d.projects ?? [])
          .filter((p): p is { number: number; title?: string; url?: string; closed?: boolean } => p.number !== undefined)
          .map((p) => ({ number: p.number, title: p.title ?? "", url: p.url ?? "", closed: p.closed ?? false }));
      } catch (e) {
        // Do NOT silently show "no projects" on a gh failure — surface WHY (a bad token/network looks
        // identical to "you have no projects" otherwise).
        failure = (e as Error).message.split("\n").filter(Boolean).join(" — ");
        process.stderr.write(`  WARNING: couldn't list projects for '${owner}' — ${failure}. Check \`gh auth status\` / network.\n`);
        return [];
      }
    },
  };
}
