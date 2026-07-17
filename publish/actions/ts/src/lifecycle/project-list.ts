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
}

export function createGhProjects(runGh: RunGh): Projects {
  return {
    listBoards(owner) {
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
        process.stderr.write(`  WARNING: couldn't list projects for '${owner}' — ${(e as Error).message}. Check \`gh auth status\` / network.\n`);
        return [];
      }
    },
  };
}
