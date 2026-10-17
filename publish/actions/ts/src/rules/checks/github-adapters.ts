// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PRODUCTION PORTS OF THE CHECK ENGINE, THIN (W6 slice 3).
 *
 * Each speaks to GitHub through one injected `gh` runner — the caller wires it to the run-process chokepoint, so
 * every call is logged and redacted there. Nothing here decides anything: the decisions are in violation.ts,
 * policy-actions.ts and gh-actions.ts, where they are tested without a network.
 */
import type { EventContext } from "../model/contracts.js";
import { VIOLATION_LABEL, redMergeMarker, type ViolationIssue, type ViolationPorts } from "./violation.js";

/** `gh <args>` with optional stdin → stdout, or null when gh failed. Never throws. */
export type Gh = (args: readonly string[], input?: string) => string | null;

/**
 * The tracker and the undo for one repository. `issueNumber` is the issue the event was about, for `reopen`.
 * The label is created (or refreshed) first, so a fresh repository does not refuse the record for lacking it.
 */
export function githubViolationPorts(gh: Gh, repo: string, issueNumber?: number): ViolationPorts {
  return {
    openIssue(issue: ViolationIssue) {
      gh(["label", "create", VIOLATION_LABEL, "--repo", repo, "--force", "--color", "B60205",
        "--description", "A governance rule was broken after the fact — for the Policy Owner"]);
      const base = ["issue", "create", "--repo", repo, "--title", issue.title, "--body-file", "-", "--label", VIOLATION_LABEL];
      let url = gh([...base, ...issue.assignees.flatMap((a) => ["--assignee", a])], issue.body);
      // An assignee GitHub will not accept (not a collaborator) must not lose the record: open it unassigned.
      if (url === null && issue.assignees.length) url = gh(base, issue.body);
      const n = url ? /\/issues\/(\d+)/.exec(url)?.[1] : undefined;
      return n ? { number: Number(n) } : null;
    },
    undo(kind: string, _ctx: EventContext): boolean {
      if (kind === "reopen" && issueNumber !== undefined) {
        return gh(["issue", "reopen", String(issueNumber), "--repo", repo]) !== null;
      }
      return false; // an undo this adapter does not know is not done — and the record says so
    },
  };
}

/** Ask GitHub to request reviews from `handles` on pull request `n`. True when GitHub accepted it. */
export function requestReviews(gh: Gh, repo: string, n: number, handles: readonly string[]): boolean {
  if (!handles.length) return true;
  return gh(["api", "-X", "POST", `repos/${repo}/pulls/${n}/requested_reviewers`, "--input", "-"], JSON.stringify({ reviewers: [...handles] })) !== null;
}

/**
 * The open red-merge record for a PR: the OPEN `gov-violation` issues, read locally for the PR's marker — GitHub's
 * search is not relied on to index an HTML comment. Null when gh could not list them.
 */
export function githubOpenRedMergeRecord(gh: Gh, repo: string): (pr: number) => { readonly found: number | null } | null {
  return (pr) => {
    const out = gh(["issue", "list", "--repo", repo, "--label", VIOLATION_LABEL, "--state", "open", "--limit", "1000", "--json", "number,body"]);
    if (out === null) return null;
    let doc: unknown;
    try { doc = JSON.parse(out); } catch { return null; /* not the answer asked for */ }
    if (!Array.isArray(doc)) return null;
    const marker = redMergeMarker(pr);
    const hit = doc.find((i: { number?: unknown; body?: unknown }) => typeof i.body === "string" && i.body.includes(marker));
    return { found: hit ? Number((hit as { number: unknown }).number) : null };
  };
}
