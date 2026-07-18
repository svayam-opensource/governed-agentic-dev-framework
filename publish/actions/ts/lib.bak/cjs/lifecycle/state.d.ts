/**
 * Lifecycle state transitions (SDD Part B, SDD-020) — pause / resume / cancel.
 * Model A (SDD-012): status is DERIVED from GitHub, never stored. The state map:
 *   active    = board open,   anchor NOT 'paused'
 *   paused    = board open,   anchor 'paused'
 *   completed = board closed,  anchor NOT 'cancelled'
 *   cancelled = board closed,  anchor 'cancelled'
 * So pause/resume toggle the anchor 'paused' label; cancel adds 'cancelled' and
 * closes the board.
 */
import type { Vcs } from "./vcs.js";
import type { AnchorCreator } from "./anchor.js";
import type { Issues } from "./issues.js";
import type { BoardRef } from "./identity.js";
export type ProjectStatus = "active" | "paused" | "completed" | "cancelled";
/** Derive a project's status from the board state + anchor labels (SDD-020). */
export declare function deriveStatus(boardOpen: boolean, anchorLabels: readonly string[]): ProjectStatus;
export interface StateConfig {
    readonly githubOrg: string;
    readonly ownerField?: "organization" | "user";
    readonly workspaceRepo: string;
}
export interface StateInput {
    readonly govClone: string;
}
export interface StateDeps {
    readonly vcs: Vcs;
    readonly anchor: AnchorCreator;
    readonly issues: Issues;
    readonly authorize?: (ref: BoardRef) => boolean;
    readonly log?: (msg: string) => void;
}
export type StateResult = {
    readonly ok: true;
    readonly status: ProjectStatus;
    readonly boardNumber: number;
    readonly applied: boolean;
} | {
    readonly ok: false;
    readonly code: number;
    readonly reason: "not-a-project-branch" | "unauthorized";
    readonly message: string;
};
/** Pause a project — add the 'paused' label to its anchor issue (board stays open). */
export declare function pause(deps: StateDeps, config: StateConfig, input: StateInput): StateResult;
/** Resume a paused project — remove the 'paused' label. */
export declare function resume(deps: StateDeps, config: StateConfig, input: StateInput): StateResult;
/** Cancel a project — add the 'cancelled' label and close the board. */
export declare function cancel(deps: StateDeps, config: StateConfig, input: StateInput): StateResult;
