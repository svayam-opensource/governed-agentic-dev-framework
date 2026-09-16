// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Board` port + C01 validation gates (SDD Part B, seed). GitHub is the
 * source of truth; seed reads the board to derive identity and to gate on
 * (POL-056…075). The gh-backed adapter lives in gh-board.ts.
 */
import type { BoardRef } from "./identity.js";

/** The board metadata seed needs from a GitHub Project. */
export interface BoardProject {
  readonly id: string;
  readonly title: string;
  readonly shortDescription: string | null;
  /** Count of board items that link an Issue or PR (content != null). */
  readonly linkedItemCount: number;
  /** Distinct repo URLs from the linked items (Phase C; workspace repo filtered by the caller). */
  readonly repoUrls: readonly string[];
}

/** Read-side of a GitHub Project board, plus the one write gov makes to it. */
export interface Board {
  /** Fetch a project's board metadata; throws {@link BoardFetchError} when the
   *  project is missing/inaccessible or the payload is malformed. */
  fetchProject(ref: BoardRef): BoardProject;
  /**
   * Set the board's title — used once, at seed, to prefix it with the project id.
   *
   * Optional so every existing fake and caller keeps working, and so a board gov cannot rename
   * is a missing nicety rather than a failed seed. Returns whether the title changed.
   *
   * WHY GOV TOUCHES THE TITLE AT ALL. A board someone names "Invoice API" becomes
   * `PRJ-26-invoice-api` everywhere in gov — branches, directories, documentation — and nothing
   * on GitHub says so. Prefixing the title to `PRJ-26 · Invoice API` closes that gap from the
   * GitHub side while keeping the words a person chose.
   *
   * AT SEED ONLY, BY RULING (Policy Owner, 2026-09-15). gov does not re-assert it on later
   * commands: a title someone deliberately edited afterwards is theirs, and silently overwriting
   * it on every `gov work` would be gov quietly disagreeing with a person about their own board.
   * Derivation tolerates either spelling, so the two staying different costs nothing.
   */
  renameProject?(ref: BoardRef, title: string): boolean;
}

/** Raised when the board can't be fetched or parsed. */
export class BoardFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardFetchError";
  }
}

/** Result of the C01 seed gates. */
export type BoardValidation =
  | { readonly ok: true; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: 1; readonly reason: "no-title" | "no-linked-items" };

/**
 * C01 gates (SDD seed): a non-empty title and ≥1 linked Issue/PR are **fatal**
 * requirements; a missing description is a warning. Pure — the orchestrator
 * decides how to act on the result.
 */
export function validateBoard(p: BoardProject): BoardValidation {
  if (p.title.trim() === "") return { ok: false, code: 1, reason: "no-title" };
  if (p.linkedItemCount <= 0) return { ok: false, code: 1, reason: "no-linked-items" };
  const warnings: string[] = [];
  if (!p.shortDescription || p.shortDescription.trim() === "") {
    warnings.push("Project has no description.");
  }
  return { ok: true, warnings };
}

/** A human message for a failed gate (matches the bash hard_stop wording). */
export function boardValidationMessage(v: Extract<BoardValidation, { ok: false }>): string {
  return v.reason === "no-title"
    ? "GitHub Project has no name."
    : "GitHub Project has no linked Issues or PRs.";
}
