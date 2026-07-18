import type { Vcs } from "./vcs.js";
import type { Fs } from "./fs-io.js";
import type { Pulls } from "./pulls.js";
export interface OnboardConfig {
    readonly agentWorkRoot: string;
    readonly workspaceRepo: string;
    readonly orgName: string;
    readonly remote?: string;
}
export interface OnboardDeps {
    readonly vcs: Vcs;
    readonly fs: Fs;
    readonly pulls: Pulls;
    readonly cloneRepo: (url: string, dest: string) => void;
    readonly log?: (msg: string) => void;
}
export interface OnboardInput {
    readonly repoUrl: string;
    readonly description: string;
    readonly owner: string;
}
export type OnboardResult = {
    readonly ok: true;
    readonly branch: string;
    readonly lines: readonly string[];
} | {
    readonly ok: false;
    readonly code: number;
    readonly reason: "knowledge-exists" | "branch-exists";
    readonly message: string;
};
export declare function onboard(deps: OnboardDeps, config: OnboardConfig, input: OnboardInput): OnboardResult;
