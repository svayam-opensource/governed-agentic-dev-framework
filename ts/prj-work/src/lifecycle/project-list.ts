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
        const out = runGh(["project", "list", "--owner", owner, "--format", "json", "--limit", "100"]);
        const d = JSON.parse(out) as { projects?: Array<{ number?: number; title?: string; url?: string; closed?: boolean }> };
        return (d.projects ?? [])
          .filter((p): p is { number: number; title?: string; url?: string; closed?: boolean } => p.number !== undefined)
          .map((p) => ({ number: p.number, title: p.title ?? "", url: p.url ?? "", closed: p.closed ?? false }));
      } catch {
        return [];
      }
    },
  };
}
