import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { Issues } from "./issues.js";
import type { BoardRef } from "./identity.js";
export interface MergeConfig {
    readonly githubOrg: string;
    readonly ownerField?: "organization" | "user";
    readonly workspaceRepo: string;
    readonly remote?: string;
}
export interface MergeInput {
    readonly govClone: string;
    readonly projectWorkRoot: string;
    /** Either an issue URL (single-issue task) or the task sub-branch itself. */
    readonly taskArg: string;
}
export interface MergeDeps {
    readonly board: Board;
    readonly vcs: Vcs;
    readonly fs: FsProbe;
    readonly issues: Issues;
    readonly authorize?: (ref: BoardRef) => boolean;
    readonly log?: (msg: string) => void;
}
export interface MergeSuccess {
    readonly ok: true;
    readonly taskId: string;
    readonly projectBranch: string;
    readonly boardNumber: number;
    readonly issueUrls: readonly string[];
    readonly reposMerged: readonly string[];
    readonly reposSkipped: readonly string[];
}
export type MergeFailReason = "not-a-project-branch" | "not-a-task" | "no-subbranch" | "dirty" | "unauthorized" | "merge-conflict";
export type MergeResult = MergeSuccess | {
    readonly ok: false;
    readonly code: number;
    readonly reason: MergeFailReason;
    readonly message: string;
    readonly repoDir?: string;
};
/** Archive a merged sub-branch: tag `archive/<branch>` + push it, then delete the
 *  branch locally + remotely (delete is best-effort). Shared with close. */
export declare function archiveBranch(vcs: Vcs, repoDir: string, branch: string, remote: string): void;
export declare function merge(deps: MergeDeps, config: MergeConfig, input: MergeInput): MergeResult;
