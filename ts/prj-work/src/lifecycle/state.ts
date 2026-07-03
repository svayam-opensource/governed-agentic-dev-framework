// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Lifecycle state transitions (SDD Part B, SDD-020) — pause / resume / cancel.
 * Model A (SDD-012): status is DERIVED from GitHub, never stored. The state map:
 *   active    = board open,   anchor NOT 'paused'
 *   paused    = board open,   anchor 'paused'
 *   completed = board closed,  anchor NOT 'cancelled'
 *   cancelled = board closed,  anchor 'cancelled'
 * So pause/resume toggle the anchor 'paused' label; cancel adds 'cancelled' and
 * closes the board.
 */
import type { Vcs } from "./vcs.js";
import type { AnchorCreator } from "./anchor.js";
import type { Issues } from "./issues.js";
import type { BoardRef } from "./identity.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";

export type ProjectStatus = "active" | "paused" | "completed" | "cancelled";

/** Derive a project's status from the board state + anchor labels (SDD-020). */
export function deriveStatus(boardOpen: boolean, anchorLabels: readonly string[]): ProjectStatus {
  const has = (l: string) => anchorLabels.includes(l);
  if (!boardOpen) return has("cancelled") ? "cancelled" : "completed";
  return has("paused") ? "paused" : "active";
}

export interface StateConfig {
  readonly githubOrg: string;
  readonly ownerField?: "organization" | "user";
  readonly workspaceRepo: string;
}

export interface StateInput {
  readonly govClone: string;
}

export interface StateDeps {
  readonly vcs: Vcs;
  readonly anchor: AnchorCreator;
  readonly issues: Issues;
  readonly authorize?: (ref: BoardRef) => boolean;
  readonly log?: (msg: string) => void;
}

export type StateResult =
  | { readonly ok: true; readonly status: ProjectStatus; readonly boardNumber: number; readonly applied: boolean }
  | { readonly ok: false; readonly code: number; readonly reason: "not-a-project-branch" | "unauthorized"; readonly message: string };

/** Resolve the board ref from the workspace's current branch. */
function refFromCwd(deps: StateDeps, config: StateConfig, input: StateInput): BoardRef | { error: StateResult } {
  const projectBranch = projectBranchOf(deps.vcs.currentBranch(input.govClone));
  const boardNumber = boardNumberFromBranch(projectBranch);
  if (boardNumber === null) {
    return { error: { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` } };
  }
  if (deps.authorize && !deps.authorize({ owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber })) {
    return { error: { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` } };
  }
  return { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
}

/** Pause a project — add the 'paused' label to its anchor issue (board stays open). */
export function pause(deps: StateDeps, config: StateConfig, input: StateInput): StateResult {
  const r = refFromCwd(deps, config, input);
  if ("error" in r) return r.error;
  const applied = deps.anchor.setState(r, config.workspaceRepo, "paused", "add");
  return { ok: true, status: "paused", boardNumber: r.number, applied };
}

/** Resume a paused project — remove the 'paused' label. */
export function resume(deps: StateDeps, config: StateConfig, input: StateInput): StateResult {
  const r = refFromCwd(deps, config, input);
  if ("error" in r) return r.error;
  const applied = deps.anchor.setState(r, config.workspaceRepo, "paused", "remove");
  return { ok: true, status: "active", boardNumber: r.number, applied };
}

/** Cancel a project — add the 'cancelled' label and close the board. */
export function cancel(deps: StateDeps, config: StateConfig, input: StateInput): StateResult {
  const r = refFromCwd(deps, config, input);
  if ("error" in r) return r.error;
  const applied = deps.anchor.setState(r, config.workspaceRepo, "cancelled", "add");
  deps.issues.closeBoard(r);
  return { ok: true, status: "cancelled", boardNumber: r.number, applied };
}
