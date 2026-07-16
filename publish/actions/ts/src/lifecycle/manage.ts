// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `manage` (SDD Part D, cmd_manage) — GitHub-definitive project ownership.
 * `list`/`list-all`: the org's boards with owners (anchor-issue assignees) +
 * derived status. `assign`/`unassign`: add/remove an owner on the current
 * project's anchor issue. Pure over the Projects + AnchorCreator + Vcs ports.
 */
import type { AnchorCreator } from "./anchor.js";
import type { Projects, BoardSummary } from "./project-list.js";
import type { Vcs } from "./vcs.js";
import type { BoardRef } from "./identity.js";
import { deriveStatus, type ProjectStatus } from "./state.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";

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
export interface ManageListResult { readonly rows: OwnerRow[]; readonly total: number; readonly offset: number; readonly limit: number; }

/** List the org's projects with owners, PAGINATED — the per-project anchor lookup (the expensive part)
 *  runs only for the requested page, not the whole set. `limit <= 0` → all rows. */
export function manageList(deps: ManageListDeps, config: ManageConfig, all: boolean, limit = 20, offset = 0): ManageListResult {
  const ownerField = config.ownerField ?? "organization";
  const boards: BoardSummary[] = deps.projects.listBoards(config.githubOrg).filter((b) => all || !b.closed);
  const total = boards.length;
  const cap = limit > 0 ? limit : total;
  const start = Math.min(Math.max(0, offset), total);
  const rows: OwnerRow[] = [];
  for (const b of boards.slice(start, start + cap)) {   // resolve owners ONLY for this page
    const ref: BoardRef = { owner: config.githubOrg, ownerField, number: b.number };
    const anchor = deps.anchor.find(ref, config.workspaceRepo);
    rows.push({
      boardNumber: b.number,
      title: b.title,
      url: b.url,
      status: deriveStatus(!b.closed, anchor?.labels ?? []),
      owners: anchor ? [...anchor.assignees] : [],
    });
  }
  return { rows, total, offset: start, limit: cap };
}

export function formatOwnerRows(rows: readonly OwnerRow[]): string[] {
  if (rows.length === 0) return ["(no projects)"];
  return rows.map((r) => `  #${r.boardNumber} [${r.status}] ${r.title} — owners: ${r.owners.length ? r.owners.join(", ") : "(none)"}`);
}

export interface ManageAssignDeps {
  readonly vcs: Vcs;
  readonly anchor: AnchorCreator;
}

export type ManageAssignResult =
  | { readonly ok: true; readonly login: string; readonly action: "add" | "remove"; readonly applied: boolean; readonly anchorUrl: string }
  | { readonly ok: false; readonly code: number; readonly reason: "not-a-project-branch" | "no-anchor"; readonly message: string };

/** Add/remove an owner (anchor-issue assignee) on the CURRENT project. */
export function manageAssign(deps: ManageAssignDeps, config: ManageConfig, govClone: string, login: string, action: "add" | "remove"): ManageAssignResult {
  const projectBranch = projectBranchOf(deps.vcs.currentBranch(govClone));
  const boardNumber = boardNumberFromBranch(projectBranch);
  if (boardNumber === null) return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
  const ref: BoardRef = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
  const anchor = deps.anchor.find(ref, config.workspaceRepo);
  if (!anchor) return { ok: false, code: 1, reason: "no-anchor", message: `No anchor issue for project #${boardNumber} — designate one first.` };
  return { ok: true, login, action, applied: deps.anchor.setAssignee(anchor.url, login, action), anchorUrl: anchor.url };
}

// ── anchor (direct anchor op — show the current project's anchor issue) ────────
export type AnchorShowResult =
  | { readonly ok: true; readonly url: string; readonly number: number; readonly labels: readonly string[]; readonly owners: readonly string[] }
  | { readonly ok: false; readonly code: number; readonly reason: "not-a-project-branch" | "no-anchor"; readonly message: string };

/** `prj anchor` — find + show the CURRENT project's anchor issue (debug op). */
export function anchorShow(deps: ManageAssignDeps, config: ManageConfig, govClone: string): AnchorShowResult {
  const projectBranch = projectBranchOf(deps.vcs.currentBranch(govClone));
  const boardNumber = boardNumberFromBranch(projectBranch);
  if (boardNumber === null) return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
  const anchor = deps.anchor.find({ owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber }, config.workspaceRepo);
  if (!anchor) return { ok: false, code: 1, reason: "no-anchor", message: `No anchor issue for project #${boardNumber}.` };
  return { ok: true, url: anchor.url, number: anchor.number, labels: [...anchor.labels], owners: [...anchor.assignees] };
}

// ── status (the CURRENT project's derived status) ─────────────────────────────
export type ProjectStatusResult =
  | { readonly ok: true; readonly boardNumber: number; readonly title: string; readonly url: string; readonly status: ProjectStatus; readonly owners: readonly string[] }
  | { readonly ok: false; readonly code: number; readonly reason: "not-a-project-branch" | "not-found"; readonly message: string };

/** `prj status [<project>]` — report a project's live status. With an explicit board (from a project id),
 *  target that project directly; otherwise derive it from the gov clone's current branch. */
export function projectStatus(deps: { vcs: Vcs; projects: Projects; anchor: AnchorCreator }, config: ManageConfig, govClone: string, explicitBoard?: number): ProjectStatusResult {
  let boardNumber: number;
  if (explicitBoard !== undefined) boardNumber = explicitBoard;
  else {
    const projectBranch = projectBranchOf(deps.vcs.currentBranch(govClone));
    const n = boardNumberFromBranch(projectBranch);
    if (n === null) return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch — pass a project (e.g. \`gov status PRJ-<n>-…\`) or run from a project branch.` };
    boardNumber = n;
  }
  const board = deps.projects.listBoards(config.githubOrg).find((b) => b.number === boardNumber);
  if (!board) return { ok: false, code: 1, reason: "not-found", message: `Project #${boardNumber} not found on GitHub.` };
  const anchor = deps.anchor.find({ owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber }, config.workspaceRepo);
  return { ok: true, boardNumber, title: board.title, url: board.url, status: deriveStatus(!board.closed, anchor?.labels ?? []), owners: anchor ? [...anchor.assignees] : [] };
}
