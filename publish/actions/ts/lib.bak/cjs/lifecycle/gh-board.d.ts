import type { BoardRef } from "./identity.js";
import { type Board, type BoardProject } from "./board.js";
/** Runs `gh <args>` and returns stdout; throws on non-zero exit. */
export type RunGh = (args: string[]) => string;
/** Build the projectV2 GraphQL query for a board ref (mirrors seed.sh). */
export declare function buildProjectQuery(ref: BoardRef): string;
/**
 * Parse a `gh api graphql` projectV2 response into a BoardProject. The owner key
 * (organization|user) is whichever the query used, so we read the single value
 * under `data`. Throws {@link BoardFetchError} on missing project / bad payload.
 */
export declare function parseProjectResponse(stdout: string): BoardProject;
/** A {@link Board} backed by the `gh` CLI. `runGh` is injectable for tests. */
export declare function createGhBoard(runGh?: RunGh): Board;
