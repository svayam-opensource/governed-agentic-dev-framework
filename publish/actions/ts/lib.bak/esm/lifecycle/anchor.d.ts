/**
 * The anchor-issue creator (SDD Part B, seed). The anchor issue carries project
 * status (paused/cancelled labels) + ownership (assignees) on GitHub — the
 * registry no longer does. Creation is BEST-EFFORT: seed continues if it fails
 * (designate one later via `prj manage`). Shells to `gh` via an injected runner.
 */
import type { RunGh } from "./gh-board.js";
import type { BoardRef } from "./identity.js";
export declare const DEFAULT_ANCHOR_LABEL = "anchor";
/** Inputs for anchor-issue creation. */
export interface AnchorParams {
    readonly boardNumber: number;
    readonly title: string;
    readonly owner: string;
    readonly workspaceRepo: string;
    /** GitHub login to assign (the seeder), if known. */
    readonly assigneeLogin?: string | null;
    readonly anchorLabel?: string;
}
/** The status-carrying label on the anchor issue. */
export type AnchorStateLabel = "paused" | "cancelled";
/** Creates + updates a project's anchor issue. */
export interface AnchorCreator {
    /** Create the anchor issue; returns `<owner/repo>#<number>` or null on failure. */
    createAnchorIssue(p: AnchorParams): string | null;
    /**
     * Add or remove a status label on the board's anchor issue (best-effort).
     * Returns true if the label change was applied. This is how paused/cancelled
     * status is carried on GitHub (SDD-012).
     */
    setState(ref: BoardRef, workspaceRepo: string, label: AnchorStateLabel, action: "add" | "remove"): boolean;
    /** Find the board's anchor issue (url + number + labels + assignees), or null. */
    find(ref: BoardRef, workspaceRepo: string): AnchorInfo | null;
    /** Add/remove an anchor-issue assignee (an "owner"); best-effort. */
    setAssignee(issueUrl: string, login: string, action: "add" | "remove"): boolean;
}
/** The anchor issue's live state (owners = assignees; status labels). */
export interface AnchorInfo {
    readonly url: string;
    readonly number: number;
    readonly labels: readonly string[];
    readonly assignees: readonly string[];
}
/** The anchor issue body (matches seed.sh wording). */
export declare function anchorIssueBody(boardNumber: number, title: string): string;
/** A {@link AnchorCreator} backed by the `gh` CLI. `runGh` is injectable for tests. */
export declare function createGhAnchor(runGh: RunGh): AnchorCreator;
