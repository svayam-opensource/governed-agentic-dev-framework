import type { Board } from "./board.js";
import type { Vcs } from "./vcs.js";
import type { Fs } from "./fs-io.js";
import type { Issues } from "./issues.js";
import type { Pulls } from "./pulls.js";
import type { BoardRef } from "./identity.js";
import { type GateResult } from "./close-gate.js";
export interface CloseConfig {
    readonly githubOrg: string;
    readonly ownerField?: "organization" | "user";
    readonly workspaceRepo: string;
    readonly defaultBranch: string;
    /** The base branch code repos merge back into (model A: no stored base). */
    readonly defaultCodeBranch: string;
    readonly remote?: string;
}
export interface CloseInput {
    readonly govClone: string;
    readonly projectWorkRoot: string;
    readonly today: string;
}
export interface CloseDeps {
    readonly board: Board;
    readonly vcs: Vcs;
    readonly fs: Fs;
    readonly issues: Issues;
    readonly pulls: Pulls;
    readonly authorize?: (ref: BoardRef) => boolean;
    /** The test-merge validators (Phase 3). If absent, the gate is skipped. */
    readonly gate?: () => GateResult;
    /** Best-effort workspace teardown (worktree detach + rm); deferred if absent. */
    readonly cleanup?: () => void;
    readonly log?: (msg: string) => void;
}
export interface CloseSuccess {
    readonly ok: true;
    readonly projectId: string;
    readonly projectBranch: string;
    readonly boardNumber: number;
    readonly prUrl: string | null;
    readonly reposMerged: readonly string[];
}
export type CloseFailReason = "not-a-project-branch" | "knowledge-gate" | "test-merge-gate" | "unauthorized" | "open-tasks" | "sync-conflict" | "code-merge-conflict" | "pr-merge-failed";
export type CloseResult = CloseSuccess | {
    readonly ok: false;
    readonly code: number;
    readonly reason: CloseFailReason;
    readonly message: string;
    readonly failures?: readonly string[];
    readonly repoDir?: string;
};
export declare function close(deps: CloseDeps, config: CloseConfig, input: CloseInput): CloseResult;
