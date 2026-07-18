// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `gh`-backed `Board` adapter (SDD Part B, seed). Shells out to the `gh` CLI
 * — an external tool, not a legacy script — and parses its JSON in-process (no
 * `python3`/`yq`). Query building and response parsing are pure and unit-tested;
 * the subprocess runner is injected so the adapter is testable without `gh`.
 */
import { execFileSync } from "node:child_process";
import { BoardFetchError } from "./board.js";
/** Build the projectV2 GraphQL query for a board ref (mirrors seed.sh). */
export function buildProjectQuery(ref) {
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
/**
 * Parse a `gh api graphql` projectV2 response into a BoardProject. The owner key
 * (organization|user) is whichever the query used, so we read the single value
 * under `data`. Throws {@link BoardFetchError} on missing project / bad payload.
 */
export function parseProjectResponse(stdout) {
    let root;
    try {
        root = JSON.parse(stdout);
    }
    catch {
        throw new BoardFetchError("gh returned non-JSON output.");
    }
    const data = root.data;
    if (!data || typeof data !== "object") {
        throw new BoardFetchError("GitHub Project not found or not accessible.");
    }
    const ownerVal = Object.values(data)[0];
    const pv = ownerVal?.projectV2;
    if (!pv)
        throw new BoardFetchError("GitHub Project not found or not accessible.");
    const linked = (pv.items?.nodes ?? []).filter((n) => n != null && n.content != null);
    const repoUrls = [
        ...new Set(linked.map((n) => n.content?.repository?.url).filter((u) => !!u)),
    ];
    return {
        id: pv.id,
        title: pv.title ?? "",
        shortDescription: pv.shortDescription ?? null,
        linkedItemCount: linked.length,
        repoUrls,
    };
}
const defaultRunGh = (args) => execFileSync("gh", args, { encoding: "utf8" });
/** A {@link Board} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhBoard(runGh = defaultRunGh) {
    return {
        fetchProject(ref) {
            let stdout;
            try {
                stdout = runGh(["api", "graphql", "-f", `query=${buildProjectQuery(ref)}`]);
            }
            catch (e) {
                throw new BoardFetchError(`GitHub Project not found or not accessible (gh failed): ${e.message}`);
            }
            return parseProjectResponse(stdout);
        },
    };
}
