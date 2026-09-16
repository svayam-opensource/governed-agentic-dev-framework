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
  /** The branch the project's code repos were cut from. Recorded so `close` can read it back — see
   *  `baseBranchFromAnchor` in merge-chain.ts. Absent → nothing is recorded and close assumes. */
  readonly baseBranch?: string | null;
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
  /**
   * Batch variant: ALL anchor issues in the workspace repo, keyed by board number — one `gh` round-trip
   * for the whole org (vs one `find` per board). Optional so lightweight test doubles need not implement it;
   * callers fall back to per-board `find` when absent.
   */
  findAll?(owner: string, workspaceRepo: string): Map<number, AnchorInfo>;
  /** Add/remove an anchor-issue assignee (an "owner"); best-effort. */
  setAssignee(issueUrl: string, login: string, action: "add" | "remove"): boolean;
}

/** The anchor issue's live state (owners = assignees; status labels). */
export interface AnchorInfo {
  readonly url: string;
  readonly number: number;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  /** The base branch recorded in the body at seed, or null when the body carries none (every
   *  project seeded before this was recorded). Optional so a test double need not supply it. */
  readonly baseBranch?: string | null;
}

/** The anchor issue body (matches seed.sh wording). */
export function anchorIssueBody(boardNumber: number, title: string, baseBranch?: string | null): string {
  return `Anchor issue for the project on GitHub Project #${boardNumber} — *${title}*.

Owners = this issue's assignees (managed via \`prj manage\`). Status carrier:
a \`paused\` or \`cancelled\` label here drives the project's derived lifecycle
status (with the board's open/closed state). Long-lived scope marker; closed at
project close.${baseBranch ? `\n\n${BASE_BRANCH_LINE}\`${baseBranch}\` — where \`gov close\` must land this project. Recorded at seed because it cannot be recovered afterwards: git knows the commit a branch descends from, not the branch name someone typed, and two env branches pointing at the same commit are indistinguishable by ancestry alone.` : ""}`;
}

/** The literal prefix of the anchor body's base-branch line. One definition, written and parsed. */
export const BASE_BRANCH_LINE = "Base branch: ";

/**
 * The base branch recorded in an anchor body, or null when it carries none.
 *
 * Kept as a literal pattern rather than one built from BASE_BRANCH_LINE: the line is written in one
 * place and read in one place, and a regex assembled from a caption is the kind of cleverness that
 * breaks silently the day the caption gains punctuation.
 */
export function baseBranchFromAnchorBody(body: string | null | undefined): string | null {
  return /^Base branch: `([^`\s]+)`/m.exec(body ?? "")?.[1] ?? null;
}


/** One anchor issue as returned by `gh issue list --json`. */
type RawAnchorIssue = { url?: string; number?: number; body?: string; labels?: Array<{ name?: string }>; assignees?: Array<{ login?: string }> };

/** Fetch every anchor-labelled issue in `repo` (one `gh` call). Shared by `find` (one board) + `findAll` (all). */
function listAnchors(runGh: RunGh, repo: string): RawAnchorIssue[] {
  const out = runGh(["issue", "list", "--repo", repo, "--label", DEFAULT_ANCHOR_LABEL, "--state", "all", "--json", "url,number,body,labels,assignees", "--limit", "100"]);
  return JSON.parse(out) as RawAnchorIssue[];
}
function toAnchorInfo(it: RawAnchorIssue): AnchorInfo {
  return {
    url: it.url!, number: it.number!,
    labels: (it.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
    assignees: (it.assignees ?? []).map((a) => a.login ?? "").filter(Boolean),
    baseBranch: baseBranchFromAnchorBody(it.body),
  };
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
          anchorIssueBody(p.boardNumber, p.title, p.baseBranch),
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
        const it = listAnchors(runGh, repo).find((i) => i.body?.includes(`Project #${ref.number}`));
        return it?.url && it.number !== undefined ? toAnchorInfo(it) : null;
      } catch {
        return null;
      }
    },
    findAll(owner, workspaceRepo) {
      const repo = `${owner}/${workspaceRepo}`;
      const map = new Map<number, AnchorInfo>();
      try {
        for (const it of listAnchors(runGh, repo)) {
          const board = Number(it.body?.match(/Project #(\d+)/)?.[1]);   // the anchor body carries its board number
          if (Number.isInteger(board) && it.url && it.number !== undefined) map.set(board, toAnchorInfo(it));
        }
      } catch { /* surfaced by callers as "no projects"; a warning is emitted upstream */ }
      return map;
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
