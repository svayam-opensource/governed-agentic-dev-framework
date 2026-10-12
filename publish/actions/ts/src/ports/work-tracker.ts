// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The WorkTrackerPort — the neutral seam between gov's lifecycle and whatever tracks the work (a GitHub Project
 * board today). M4: new tracker code goes behind this port, never straight to `gh`.
 *
 * THIS IS THE FIRST SLICE (PRJ-121 intent 05, gadf#225, ruling Q4): only the two board writes the lifecycle
 * makes. Intent 03 (L02) completes the interface — issues, items, search, links — and renames `setStatus` to
 * `setState`; the result types here are the shape it extends.
 *
 * EVERY WRITE RETURNS ITS OUTCOME. The stub this replaced returned `void` and did nothing, and gov printed
 * success for two years of tasks whose Status never moved. A board that cannot be updated must not fail a task
 * or a merge — the branches are already made — but the caller is always told which and why.
 */
import type { BoardRef } from "../lifecycle/identity.js";

/** Why a Status could not be set. */
export type BoardStatusWhy =
  | "no-field"       // the board has no single-select field named Status
  | "no-option"      // Status has no option with that name (matched case-insensitively)
  | "not-on-board"   // the issue is not an item of this board (or cannot be resolved at all)
  | "denied"         // the token may not read or write the board
  | "unreachable";   // anything else: network, an unexpected answer, no tracker wired

export type BoardStatusResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: BoardStatusWhy; readonly detail: string };

export type BoardCloseResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: "denied" | "unreachable"; readonly detail: string };

/** The Status names the lifecycle sets. Matched case-insensitively against the board's options. */
export const STATUS_IN_PROGRESS = "In progress";
export const STATUS_DONE = "Done";

export interface WorkTrackerPort {
  /** Set the Status of the board item for `issueUrl`. Never throws. */
  setStatus(ref: BoardRef, issueUrl: string, status: string): BoardStatusResult;
  /** Close the board — the project then reads as completed (or cancelled). Never throws. */
  closeProject(ref: BoardRef): BoardCloseResult;
}

/** What a caller reports when no tracker was wired: a fact, not a silent skip. */
export const NO_TRACKER = { ok: false, why: "unreachable", detail: "no work tracker is wired into this command" } as const;

/** One issue's Status write, as task and merge report it. */
export interface BoardStatusOutcome {
  readonly issueUrl: string;
  readonly status: string;
  readonly result: BoardStatusResult;
}
