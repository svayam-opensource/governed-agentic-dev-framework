/**
 * `add-repo` / repo-on-demand (SDD Part B, add-repo.sh) — bring a code repo into
 * an active project by materializing its project-branch worktree. Model A
 * (SDD-012): there is no project.yaml repos[] to update — "membership" is the
 * board's linked items + the local worktree. So add-repo is exactly
 * `setupCodeRepoWorktree` (shared base clone → worktree off base → push), with a
 * Transaction so a failure unwinds.
 */
import { type RollbackFailure } from "./transaction.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { BoardRef } from "./identity.js";
export interface AddRepoConfig {
    readonly githubOrg: string;
    readonly ownerField?: "organization" | "user";
    readonly agentWorkRoot: string;
    readonly defaultCodeBranch: string;
    readonly remote?: string;
}
export interface AddRepoInput {
    readonly govClone: string;
    readonly projectWorkRoot: string;
    readonly repoUrl: string;
    readonly baseBranch?: string;
    readonly identity?: {
        name?: string;
        email?: string;
    };
}
export interface AddRepoDeps {
    readonly vcs: Vcs;
    readonly fs: FsProbe;
    readonly cloneRepo: (url: string, dest: string) => void;
    readonly authorize?: (ref: BoardRef) => boolean;
    readonly log?: (msg: string) => void;
}
export type AddRepoResult = {
    readonly ok: true;
    readonly repoDir: string;
    readonly projectBranch: string;
    readonly boardNumber: number;
} | {
    readonly ok: false;
    readonly code: number;
    readonly reason: "not-a-project-branch" | "unauthorized" | "add-failed";
    readonly message: string;
    readonly rollbackFailures?: readonly RollbackFailure[];
};
export declare function addRepo(deps: AddRepoDeps, config: AddRepoConfig, input: AddRepoInput): AddRepoResult;
