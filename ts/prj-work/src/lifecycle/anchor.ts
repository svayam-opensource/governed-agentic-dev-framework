// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The anchor-issue creator (SDD Part B, seed). The anchor issue carries project
 * status (paused/cancelled labels) + ownership (assignees) on GitHub — the
 * registry no longer does. Creation is BEST-EFFORT: seed continues if it fails
 * (designate one later via `prj manage`). Shells to `gh` via an injected runner.
 */
import type { RunGh } from "./gh-board.js";
import type { BoardRef } from "./identity.js";

export const DEFAULT_ANCHOR_LABEL = "anchor";

/** Inputs for anchor-issue creation. */
export interface AnchorParams {
  readonly boardNumber: number;
  readonly title: string;
  readonly owner: string;
  readonly workspaceRepo: string;
  /** GitHub login to assign (the seeder), if known. */
  readonly assigneeLogin?: string | null;
  readonly anchorLabel?: string;
}

/** The status-carrying label on the anchor issue. */
export type AnchorStateLabel = "paused" | "cancelled";

/** Creates + updates a project's anchor issue. */
export interface AnchorCreator {
  /** Create the anchor issue; returns `<owner/repo>#<number>` or null on failure. */
  createAnchorIssue(p: AnchorParams): string | null;
  /**
   * Add or remove a status label on the board's anchor issue (best-effort).
   * Returns true if the label change was applied. This is how paused/cancelled
   * status is carried on GitHub (SDD-012).
   */
  setState(ref: BoardRef, workspaceRepo: string, label: AnchorStateLabel, action: "add" | "remove"): boolean;
  /** Find the board's anchor issue (url + number + labels + assignees), or null. */
  find(ref: BoardRef, workspaceRepo: string): AnchorInfo | null;
  /** Add/remove an anchor-issue assignee (an "owner"); best-effort. */
  setAssignee(issueUrl: string, login: string, action: "add" | "remove"): boolean;
}

/** The anchor issue's live state (owners = assignees; status labels). */
export interface AnchorInfo {
  readonly url: string;
  readonly number: number;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
}

/** The anchor issue body (matches seed.sh wording). */
export function anchorIssueBody(boardNumber: number, title: string): string {
  return `Anchor issue for the project on GitHub Project #${boardNumber} — *${title}*.

Owners = this issue's assignees (managed via \`prj manage\`). Status carrier:
a \`paused\` or \`cancelled\` label here drives the project's derived lifecycle
status (with the board's open/closed state). Long-lived scope marker; closed at
project close.`;
}

/** A {@link AnchorCreator} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhAnchor(runGh: RunGh): AnchorCreator {
  return {
    createAnchorIssue(p) {
      const label = p.anchorLabel ?? DEFAULT_ANCHOR_LABEL;
      const repo = `${p.owner}/${p.workspaceRepo}`;

      // Ensure the anchor label exists (best-effort).
      try {
        runGh(["label", "create", label, "--repo", repo, "--color", "5319e7", "--force"]);
      } catch {
        /* label may already exist / no perms — non-fatal */
      }

      let out: string;
      try {
        out = runGh([
          "issue",
          "create",
          "--repo",
          repo,
          "--title",
          `${p.title}: project scope & anchor`,
          "--label",
          label,
          ...(p.assigneeLogin ? ["--assignee", p.assigneeLogin] : []),
          "--body",
          anchorIssueBody(p.boardNumber, p.title),
        ]);
      } catch {
        return null; // seed continues without an anchor
      }

      const url = out.trim().split("\n").pop() ?? "";
      if (!url) return null;

      // Add the issue to the board (best-effort).
      try {
        runGh(["project", "item-add", String(p.boardNumber), "--owner", p.owner, "--url", url]);
      } catch {
        /* non-fatal */
      }

      return `${repo}#${url.split("/").pop()}`;
    },
    find(ref, workspaceRepo) {
      const repo = `${ref.owner}/${workspaceRepo}`;
      try {
        const out = runGh(["issue", "list", "--repo", repo, "--label", DEFAULT_ANCHOR_LABEL, "--state", "all", "--json", "url,number,body,labels,assignees", "--limit", "100"]);
        const items = JSON.parse(out) as Array<{ url?: string; number?: number; body?: string; labels?: Array<{ name?: string }>; assignees?: Array<{ login?: string }> }>;
        const it = items.find((i) => i.body?.includes(`Project #${ref.number}`));
        if (!it?.url || it.number === undefined) return null;
        return {
          url: it.url,
          number: it.number,
          labels: (it.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
          assignees: (it.assignees ?? []).map((a) => a.login ?? "").filter(Boolean),
        };
      } catch {
        return null;
      }
    },
    setState(ref, workspaceRepo, label, action) {
      const anchor = this.find(ref, workspaceRepo);
      if (!anchor) return false;
      try {
        runGh(["issue", "edit", anchor.url, `--${action}-label`, label]);
        return true;
      } catch {
        return false;
      }
    },
    setAssignee(issueUrl, login, action) {
      try {
        runGh(["issue", "edit", issueUrl, `--${action}-assignee`, login]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
