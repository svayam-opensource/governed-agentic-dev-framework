/**
 * The `Issues` port (SDD Part B, create-task) — read an issue's open/closed
 * state and reflect the task on GitHub (assign + board status). Under model A
 * (SDD-012) the issue + its sub-branch ARE the task record; there is no
 * project.yaml tasks[]. Board reflection is best-effort. Shells to `gh`.
 */
import type { BoardRef } from "./identity.js";
import type { RunGh } from "./gh-board.js";
export type IssueState = "OPEN" | "CLOSED" | "UNKNOWN";
/** GitHub issue operations task needs. */
export interface Issues {
    /** The issue's state, or UNKNOWN if it can't be read. */
    state(issueUrl: string): IssueState;
    /** Assign the issue (best-effort; no throw). */
    assign(issueUrl: string, assignee: string): void;
    /** Set the issue's Status on the project board (best-effort; no throw). */
    setBoardStatus(ref: BoardRef, issueUrl: string, status: string): void;
    /** Close an issue with a comment (best-effort; no throw). */
    close(issueUrl: string, comment: string): void;
    /** Resolve an issue number to its URL on the board, or null. */
    resolveIssueUrl(ref: BoardRef, issueNumber: number): string | null;
    /** Close the project board (best-effort) — makes the project read as completed. */
    closeBoard(ref: BoardRef): void;
}
/** An {@link Issues} backed by the `gh` CLI. `runGh` is injectable for tests. */
export declare function createGhIssues(runGh: RunGh): Issues;
