import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { BoardRef } from "./identity.js";
export interface SyncConfig {
    readonly githubOrg: string;
    readonly ownerField?: "organization" | "user";
    readonly workspaceRepo: string;
    readonly defaultBranch: string;
    readonly defaultCodeBranch: string;
    readonly remote?: string;
}
export interface SyncInput {
    readonly govClone: string;
    readonly projectWorkRoot: string;
}
export interface SyncDeps {
    readonly board: Board;
    readonly vcs: Vcs;
    readonly fs: FsProbe;
    readonly authorize?: (ref: BoardRef) => boolean;
    readonly log?: (msg: string) => void;
}
export type SyncResult = {
    readonly ok: true;
    readonly projectBranch: string;
    readonly boardNumber: number;
    readonly synced: readonly string[];
} | {
    readonly ok: false;
    readonly code: number;
    readonly reason: "not-a-project-branch" | "unauthorized" | "dirty" | "merge-conflict";
    readonly message: string;
    readonly repoDir?: string;
};
export declare function sync(deps: SyncDeps, config: SyncConfig, input: SyncInput): SyncResult;
