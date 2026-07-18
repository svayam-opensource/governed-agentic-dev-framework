import type { Projects } from "../lifecycle/project-list.js";
import type { AnchorCreator } from "../lifecycle/anchor.js";
import type { Fs } from "../lifecycle/fs-io.js";
export interface WorkProject {
    readonly boardNumber: number;
    readonly title: string;
    readonly url: string;
    readonly status: string;
    readonly projectId: string;
}
export interface WorkFlowDeps {
    readonly projects: Projects;
    readonly anchor: AnchorCreator;
    readonly fs: Fs;
    readonly config: {
        readonly githubOrg: string;
        readonly workspaceRepo: string;
        readonly agentWorkRoot: string;
        readonly ownerField?: "organization" | "user";
    };
    readonly me: string | null;
    readonly canWriteBoard: (boardNumber: number) => boolean;
    readonly run: (argv: readonly string[]) => Promise<number> | number;
    readonly prompt: (q: string) => Promise<string>;
    readonly print: (l: string) => void;
}
/** My projects = open boards whose anchor issue lists me as an assignee (owner). */
export declare function myProjects(deps: WorkFlowDeps): WorkProject[];
export type WorkspaceState = "not-seeded" | "not-cloned" | "ready";
export declare function workspaceState(deps: WorkFlowDeps, p: WorkProject): WorkspaceState;
export declare function runWorkFlow(deps: WorkFlowDeps): Promise<number>;
