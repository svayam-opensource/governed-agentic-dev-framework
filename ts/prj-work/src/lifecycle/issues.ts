// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Issues` port (SDD Part B, create-task) — read an issue's open/closed
 * state and reflect the task on GitHub (assign + board status). Under model A
 * (SDD-012) the issue + its sub-branch ARE the task record; there is no
 * project.yaml tasks[]. Board reflection is best-effort. Shells to `gh`.
 */
import type { BoardRef } from "./identity.js";
import type { RunGh } from "./gh-board.js";

export type IssueState = "OPEN" | "CLOSED" | "UNKNOWN";

/** GitHub issue operations task needs. */
export interface Issues {
  /** The issue's state, or UNKNOWN if it can't be read. */
  state(issueUrl: string): IssueState;
  /** Assign the issue (best-effort; no throw). */
  assign(issueUrl: string, assignee: string): void;
  /** Set the issue's Status on the project board (best-effort; no throw). */
  setBoardStatus(ref: BoardRef, issueUrl: string, status: string): void;
}

/** An {@link Issues} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhIssues(runGh: RunGh): Issues {
  return {
    state(issueUrl) {
      let out: string;
      try {
        out = runGh(["issue", "view", issueUrl, "--json", "state", "-q", ".state"]);
      } catch {
        return "UNKNOWN";
      }
      const s = out.trim().toUpperCase();
      return s === "OPEN" || s === "CLOSED" ? s : "UNKNOWN";
    },
    assign(issueUrl, assignee) {
      try {
        runGh(["issue", "edit", issueUrl, "--add-assignee", assignee]);
      } catch {
        /* best-effort — assign manually if this fails */
      }
    },
    setBoardStatus(ref, issueUrl, status) {
      try {
        // Best-effort: reflect Status on the board. Full field/option resolution
        // is a follow-up; a failure here never blocks the task.
        runGh(["project", "item-edit", "--url", issueUrl, "--owner", ref.owner, "--field", "Status", "--value", status]);
      } catch {
        /* non-fatal */
      }
    },
  };
}
