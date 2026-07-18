/**
 * The `Board` port + C01 validation gates (SDD Part B, seed). GitHub is the
 * source of truth; seed reads the board to derive identity and to gate on
 * (POL-056…075). The gh-backed adapter lives in gh-board.ts.
 */
import type { BoardRef } from "./identity.js";
/** The board metadata seed needs from a GitHub Project. */
export interface BoardProject {
    readonly id: string;
    readonly title: string;
    readonly shortDescription: string | null;
    /** Count of board items that link an Issue or PR (content != null). */
    readonly linkedItemCount: number;
    /** Distinct repo URLs from the linked items (Phase C; workspace repo filtered by the caller). */
    readonly repoUrls: readonly string[];
}
/** Read-side of a GitHub Project board. */
export interface Board {
    /** Fetch a project's board metadata; throws {@link BoardFetchError} when the
     *  project is missing/inaccessible or the payload is malformed. */
    fetchProject(ref: BoardRef): BoardProject;
}
/** Raised when the board can't be fetched or parsed. */
export declare class BoardFetchError extends Error {
    constructor(message: string);
}
/** Result of the C01 seed gates. */
export type BoardValidation = {
    readonly ok: true;
    readonly warnings: readonly string[];
} | {
    readonly ok: false;
    readonly code: 1;
    readonly reason: "no-title" | "no-linked-items";
};
/**
 * C01 gates (SDD seed): a non-empty title and ≥1 linked Issue/PR are **fatal**
 * requirements; a missing description is a warning. Pure — the orchestrator
 * decides how to act on the result.
 */
export declare function validateBoard(p: BoardProject): BoardValidation;
/** A human message for a failed gate (matches the bash hard_stop wording). */
export declare function boardValidationMessage(v: Extract<BoardValidation, {
    ok: false;
}>): string;
