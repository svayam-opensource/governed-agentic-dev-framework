// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `gh`-backed `Board` adapter (SDD Part B, seed). Shells out to the `gh` CLI
 * — an external tool, not a legacy script — and parses its JSON in-process (no
 * `python3`/`yq`). Query building and response parsing are pure and unit-tested;
 * the subprocess runner is injected so the adapter is testable without `gh`.
 */
import { execFileSync } from "node:child_process";
import type { BoardRef } from "./identity.js";
import { type Board, type BoardProject, BoardFetchError } from "./board.js";

/** Runs `gh <args>` and returns stdout; throws on non-zero exit. */
export type RunGh = (args: string[]) => string;

/** GraphQL's hard maximum page size for a connection. Not a tuning knob. */
const PAGE_SIZE = 100;

/**
 * Build the projectV2 GraphQL query for a board ref, optionally from a cursor.
 *
 * NOTE (#148): this used to request `items(first: 50)` with no `pageInfo` and no
 * loop, so everything past the 50th board item was invisible — including entire
 * repositories, which made `task`/`merge`/`sync` silently skip them. Raising the
 * number is not a fix: 100 is GraphQL's per-page maximum, so the cliff would just
 * move. The caller must paginate; see {@link createGhBoard}.
 */
export function buildProjectQuery(ref: BoardRef, after?: string | null): string {
  const cursor = after ? `, after: "${after}"` : "";
  return `query {
  ${ref.ownerField}(login: "${ref.owner}") {
    projectV2(number: ${ref.number}) {
      id
      title
      shortDescription
      items(first: ${PAGE_SIZE}${cursor}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          content {
            ... on Issue       { url repository { url } }
            ... on PullRequest { url repository { url } }
          }
        }
      }
    }
  }
}`;
}

interface GraphQLNode {
  content?: { repository?: { url?: string } } | null;
}
interface PageInfo {
  hasNextPage?: boolean;
  endCursor?: string | null;
}
interface ProjectV2 {
  id: string;
  title?: string | null;
  shortDescription?: string | null;
  items?: { pageInfo?: PageInfo; nodes?: GraphQLNode[] };
}

/** One page of a board: the project facts it carries, plus how to get the next. */
export interface BoardPage {
  project: BoardProject;
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * Parse a `gh api graphql` projectV2 response into a BoardProject. The owner key
 * (organization|user) is whichever the query used, so we read the single value
 * under `data`. Throws {@link BoardFetchError} on missing project / bad payload.
 */
export function parseProjectPage(stdout: string): BoardPage {
  let root: unknown;
  try {
    root = JSON.parse(stdout);
  } catch {
    throw new BoardFetchError("gh returned non-JSON output.");
  }
  const data = (root as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== "object") {
    throw new BoardFetchError("GitHub Project not found or not accessible.");
  }
  const ownerVal = Object.values(data)[0] as { projectV2?: ProjectV2 | null } | undefined;
  const pv = ownerVal?.projectV2;
  if (!pv) throw new BoardFetchError("GitHub Project not found or not accessible.");
  const linked = (pv.items?.nodes ?? []).filter((n) => n != null && n.content != null);
  const repoUrls = [
    ...new Set(linked.map((n) => n.content?.repository?.url).filter((u): u is string => !!u)),
  ];
  return {
    project: {
      id: pv.id,
      title: pv.title ?? "",
      shortDescription: pv.shortDescription ?? null,
      linkedItemCount: linked.length,
      repoUrls,
    },
    hasNextPage: pv.items?.pageInfo?.hasNextPage === true,
    endCursor: pv.items?.pageInfo?.endCursor ?? null,
  };
}

/** The first page's project facts. Prefer {@link createGhBoard}, which paginates. */
export function parseProjectResponse(stdout: string): BoardProject {
  return parseProjectPage(stdout).project;
}

/** Fold a later page into the accumulated board: counts sum, repo URLs union. */
export function mergeBoardPages(acc: BoardProject, next: BoardProject): BoardProject {
  return {
    ...acc,
    linkedItemCount: acc.linkedItemCount + next.linkedItemCount,
    repoUrls: [...new Set([...acc.repoUrls, ...next.repoUrls])],
  };
}

const defaultRunGh: RunGh = (args) => execFileSync("gh", args, { encoding: "utf8" });

/** A {@link Board} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhBoard(runGh: RunGh = defaultRunGh): Board {
  return {
    fetchProject(ref: BoardRef): BoardProject {
      // Walk every page. A board is not required to fit in one, and a partial
      // read is worse than a failure here: it makes whole repositories vanish
      // from `repoUrls` while every command still reports success (#148).
      let acc: BoardProject | null = null;
      let cursor: string | null = null;
      // Bounded so a server that never clears hasNextPage cannot spin forever.
      for (let page = 0; page < 100; page++) {
        let stdout: string;
        try {
          stdout = runGh(["api", "graphql", "-f", `query=${buildProjectQuery(ref, cursor)}`]);
        } catch (e) {
          throw new BoardFetchError(
            `GitHub Project not found or not accessible (gh failed): ${(e as Error).message}`,
          );
        }
        const { project, hasNextPage, endCursor } = parseProjectPage(stdout);
        acc = acc === null ? project : mergeBoardPages(acc, project);
        if (!hasNextPage || !endCursor) return acc;
        cursor = endCursor;
      }
      throw new BoardFetchError(
        "GitHub Project paging did not terminate — refusing to return a partial board.",
      );
    },
  };
}
