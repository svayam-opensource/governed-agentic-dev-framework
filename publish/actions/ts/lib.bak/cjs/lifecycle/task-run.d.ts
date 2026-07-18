import { type RollbackFailure } from "./transaction.js";
import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { Issues } from "./issues.js";
import type { BoardRef } from "./identity.js";
export interface TaskConfig {
    readonly githubOrg: string;
    readonly ownerField?: "organization" | "user";
    readonly workspaceRepo: string;
    readonly remote?: string;
}
export interface TaskInput {
    /** The workspace (gov) clone the developer is in, on the project branch. */
    readonly govClone: string;
    /** The per-project workspace root holding the code-repo worktrees. */
    readonly projectWorkRoot: string;
    readonly issueUrls: readonly string[];
    readonly assignee: string;
}
export interface TaskDeps {
    readonly board: Board;
    readonly vcs: Vcs;
    readonly fs: FsProbe;
    readonly issues: Issues;
    /** Optional authorization gate (viewerCanUpdate); deny → abort. */
    readonly authorize?: (ref: BoardRef) => boolean;
    readonly log?: (msg: string) => void;
}
export interface TaskSuccess {
    readonly ok: true;
    readonly taskId: string;
    readonly projectBranch: string;
    readonly boardNumber: number;
    readonly issueNumbers: readonly number[];
    /** Repo dirs where the sub-branch was created or resumed. */
    readonly reposBranched: readonly string[];
    /** Linked repos with no local worktree (need repo-on-demand — deferred). */
    readonly reposSkipped: readonly string[];
}
export type TaskResult = TaskSuccess | {
    readonly ok: false;
    readonly code: number;
    readonly reason: string;
    readonly message: string;
    readonly rollbackFailures?: readonly RollbackFailure[];
};
export declare function task(deps: TaskDeps, config: TaskConfig, input: TaskInput): TaskResult;
