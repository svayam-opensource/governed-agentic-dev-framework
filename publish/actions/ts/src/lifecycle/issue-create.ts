// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov issue` — the verb for the step where governed work begins (#182, #194).
 *
 * Every stage of a project's life had a verb — seed, join, task, merge, pause,
 * resume, close — except the first. Writing down a unit of work happened in the
 * GitHub web UI, which is where two rules went to be forgotten:
 *
 *   · POL-413 — every board issue is assigned to the actor who created it. Enforced
 *     by memory, and by an auto-assign workflow each adopter has to remember to
 *     install.
 *   · An issue that is not ON a board is invisible to gov. Adding it is a second
 *     action, in a second place, after the browser has already moved on.
 *
 * Both become structural here: one command, assigned by construction, on the board
 * by construction.
 *
 * `--from <upstream-url>` is the same verb for the case where the reason for the
 * work is someone else's issue in a repository your organization cannot write
 * (#194). It creates YOUR issue, quoting theirs, and puts that on the board — so
 * the board item is something you can own, assign and close, which is what a board
 * item is for.
 *
 * Pure planning; the caller performs it. What is decided here is decidable in a test.
 */
import { mirrorTitle, mirrorBody, mirrorPrecheck, parseIssueUrl, type UpstreamIssue } from "./issue-mirror.js";

export interface IssuePlan {
  readonly repo: string;              // owner/repo the issue is created in
  readonly title: string;
  readonly body: string;
  readonly assignee: string;
  /** Board number to add it to, or null when the caller named none and none is active. */
  readonly board: number | null;
  /** The upstream issue this mirrors, when it is one. */
  readonly mirrorOf: string | null;
}

export interface IssueRequest {
  readonly repo?: string;
  readonly title?: string;
  readonly body?: string;
  readonly from?: string;
  readonly board?: number | null;
  readonly assignee: string;
  readonly githubOrg: string;
  /** The default repo when none is named — normally the org's workspace repo. */
  readonly defaultRepo?: string;
}

export type IssuePlanResult =
  | { readonly ok: true; readonly plan: IssuePlan }
  | { readonly ok: false; readonly message: string };

/**
 * Decide what to create. `fetchUpstream` is only consulted for `--from`, so the
 * ordinary path needs no network at all.
 */
export function planIssue(
  req: IssueRequest,
  fetchUpstream?: (repo: string, number: number) => UpstreamIssue | null,
): IssuePlanResult {
  if (!req.assignee) {
    // POL-413 is the reason this verb exists. Creating an unassigned issue here
    // would reproduce by hand the thing the command was written to prevent.
    return { ok: false, message: "Cannot create an issue without an assignee — every board item needs an accountable person (POL-413)." };
  }

  if (req.from) {
    const parsed = parseIssueUrl(req.from);
    if (!parsed) return { ok: false, message: `'${req.from}' is not a GitHub issue URL (…/owner/repo/issues/123).` };
    const already = mirrorPrecheck(parsed, req.githubOrg);
    if (already) return { ok: false, message: already };

    const repo = req.repo ?? `${req.githubOrg}/${parsed.repo.split("/")[1]}`;
    if (!fetchUpstream) return { ok: false, message: "Cannot read the upstream issue — no GitHub client available." };
    const up = fetchUpstream(parsed.repo, parsed.number);
    if (!up) return { ok: false, message: `Could not read ${req.from}. Check the URL, and that you can see that repository.` };

    return {
      ok: true,
      plan: {
        repo,
        title: mirrorTitle(up),
        body: mirrorBody(up),
        assignee: req.assignee,
        board: req.board ?? null,
        mirrorOf: up.url,
      },
    };
  }

  const repo = req.repo ?? req.defaultRepo;
  if (!repo) return { ok: false, message: "Which repository? Give it as <organization>/<name>." };
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    return { ok: false, message: `'${repo}' is not <organization>/<name> — for example ${req.githubOrg}/some-repo.` };
  }
  if (!req.title?.trim()) return { ok: false, message: "An issue needs a title. Give it with --title." };

  return {
    ok: true,
    plan: { repo, title: req.title.trim(), body: req.body ?? "", assignee: req.assignee, board: req.board ?? null, mirrorOf: null },
  };
}

/** One line per thing that happened, in the order it happened. */
export function issueSummary(plan: IssuePlan, url: string, addedToBoard: boolean): readonly string[] {
  return [
    plan.mirrorOf ? `Mirrored ${plan.mirrorOf}` : "Created an issue",
    `  ${url}`,
    `  assigned to ${plan.assignee}`,
    plan.board === null
      ? "  not on a board — add it with `gov issue … --board <n>`, or gov cannot see it"
      : addedToBoard
        ? `  added to board #${plan.board}`
        : `  ⚠ could NOT be added to board #${plan.board} — gov will not see it until it is`,
  ];
}
