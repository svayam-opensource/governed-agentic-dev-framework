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

/** Build the projectV2 GraphQL query for a board ref (mirrors seed.sh). */
export function buildProjectQuery(ref: BoardRef): string {
  return `query {
  ${ref.ownerField}(login: "${ref.owner}") {
    projectV2(number: ${ref.number}) {
      id
      title
      shortDescription
      items(first: 50) {
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
  content?: unknown | null;
}
interface ProjectV2 {
  id: string;
  title?: string | null;
  shortDescription?: string | null;
  items?: { nodes?: GraphQLNode[] };
}

/**
 * Parse a `gh api graphql` projectV2 response into a BoardProject. The owner key
 * (organization|user) is whichever the query used, so we read the single value
 * under `data`. Throws {@link BoardFetchError} on missing project / bad payload.
 */
export function parseProjectResponse(stdout: string): BoardProject {
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
  const nodes = pv.items?.nodes ?? [];
  const linkedItemCount = nodes.filter((n) => n != null && n.content != null).length;
  return {
    id: pv.id,
    title: pv.title ?? "",
    shortDescription: pv.shortDescription ?? null,
    linkedItemCount,
  };
}

const defaultRunGh: RunGh = (args) => execFileSync("gh", args, { encoding: "utf8" });

/** A {@link Board} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhBoard(runGh: RunGh = defaultRunGh): Board {
  return {
    fetchProject(ref: BoardRef): BoardProject {
      let stdout: string;
      try {
        stdout = runGh(["api", "graphql", "-f", `query=${buildProjectQuery(ref)}`]);
      } catch (e) {
        throw new BoardFetchError(
          `GitHub Project not found or not accessible (gh failed): ${(e as Error).message}`,
        );
      }
      return parseProjectResponse(stdout);
    },
  };
}
