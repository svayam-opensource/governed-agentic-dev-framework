/**
 * `manage` (SDD Part D, cmd_manage) — GitHub-definitive project ownership.
 * `list`/`list-all`: the org's boards with owners (anchor-issue assignees) +
 * derived status. `assign`/`unassign`: add/remove an owner on the current
 * project's anchor issue. Pure over the Projects + AnchorCreator + Vcs ports.
 */
import type { AnchorCreator } from "./anchor.js";
import type { Projects } from "./project-list.js";
import type { Vcs } from "./vcs.js";
import { type ProjectStatus } from "./state.js";
export interface ManageConfig {
    readonly githubOrg: string;
    readonly ownerField?: "organization" | "user";
    readonly workspaceRepo: string;
}
export interface OwnerRow {
    readonly boardNumber: number;
    readonly title: string;
    readonly url: string;
    readonly status: ProjectStatus;
    readonly owners: readonly string[];
}
export interface ManageListDeps {
    readonly projects: Projects;
    readonly anchor: AnchorCreator;
}
/** List boards with owners + derived status. `all` includes closed (completed/cancelled). */
/** A page of owner rows + the full count (so the caller can render "X–Y of TOTAL" + a next-page hint). */
export interface ManageListResult {
    readonly rows: OwnerRow[];
    readonly total: number;
    readonly offset: number;
    readonly limit: number;
}
/** List the org's projects with owners, PAGINATED — the per-project anchor lookup (the expensive part)
 *  runs only for the requested page, not the whole set. `limit <= 0` → all rows. */
export declare function manageList(deps: ManageListDeps, config: ManageConfig, all: boolean, limit?: number, offset?: number): ManageListResult;
export declare function formatOwnerRows(rows: readonly OwnerRow[]): string[];
export interface ManageAssignDeps {
    readonly vcs: Vcs;
    readonly anchor: AnchorCreator;
}
export type ManageAssignResult = {
    readonly ok: true;
    readonly login: string;
    readonly action: "add" | "remove";
    readonly applied: boolean;
    readonly anchorUrl: string;
} | {
    readonly ok: false;
    readonly code: number;
    readonly reason: "not-a-project-branch" | "no-anchor";
    readonly message: string;
};
/** Add/remove an owner (anchor-issue assignee) on the CURRENT project. */
export declare function manageAssign(deps: ManageAssignDeps, config: ManageConfig, govClone: string, login: string, action: "add" | "remove"): ManageAssignResult;
export type AnchorShowResult = {
    readonly ok: true;
    readonly url: string;
    readonly number: number;
    readonly labels: readonly string[];
    readonly owners: readonly string[];
} | {
    readonly ok: false;
    readonly code: number;
    readonly reason: "not-a-project-branch" | "no-anchor";
    readonly message: string;
};
/** `prj anchor` — find + show the CURRENT project's anchor issue (debug op). */
export declare function anchorShow(deps: ManageAssignDeps, config: ManageConfig, govClone: string): AnchorShowResult;
export type ProjectStatusResult = {
    readonly ok: true;
    readonly boardNumber: number;
    readonly title: string;
    readonly url: string;
    readonly status: ProjectStatus;
    readonly owners: readonly string[];
} | {
    readonly ok: false;
    readonly code: number;
    readonly reason: "not-a-project-branch" | "not-found";
    readonly message: string;
};
/** `prj status` — derive the current project's board# from cwd, report live status. */
export declare function projectStatus(deps: {
    vcs: Vcs;
    projects: Projects;
    anchor: AnchorCreator;
}, config: ManageConfig, govClone: string): ProjectStatusResult;
