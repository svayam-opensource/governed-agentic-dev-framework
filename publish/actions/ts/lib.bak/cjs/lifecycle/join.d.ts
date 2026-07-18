import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { BoardRef } from "./identity.js";
export interface JoinConfig {
    readonly githubOrg: string;
    readonly ownerField?: "organization" | "user";
    readonly workspaceRepo: string;
    readonly orgRepoUrl: string;
    readonly agentWorkRoot: string;
    readonly remote?: string;
}
export interface JoinInput {
    readonly boardUrl: string;
    readonly identity?: {
        name?: string;
        email?: string;
    };
}
export interface JoinDeps {
    readonly board: Board;
    readonly vcs: Vcs;
    readonly fs: FsProbe;
    readonly cloneRepo: (url: string, dest: string) => void;
    readonly authorize?: (ref: BoardRef) => boolean;
    readonly log?: (msg: string) => void;
}
export type JoinResult = {
    readonly ok: true;
    readonly projectId: string;
    readonly branch: string;
    readonly orgGovClone: string;
    readonly repos: readonly string[];
} | {
    readonly ok: false;
    readonly code: number;
    readonly reason: "bad-url" | "empty-slug" | "unauthorized";
    readonly message: string;
};
export declare function join(deps: JoinDeps, config: JoinConfig, input: JoinInput): JoinResult;
