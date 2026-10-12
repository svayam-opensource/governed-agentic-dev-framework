// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov issue` — the verb for the step where governed work begins (#182, #194).
 *
 * Every stage of a project's life had a verb — seed, join, task, merge, pause,
 * resume, close — except the first. Writing down a unit of work happened in the
 * GitHub web UI, which is where two rules went to be forgotten:
 *
 *   · every board issue is assigned to the actor who created it. Enforced
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
 * {@link planIssue} is pure: what is decided there is decidable in a test. {@link createPlannedIssue} performs a
 * plan through the {@link WorkTrackerPort} (spec 03 §6–§7, plan L05): every write's outcome is read, and a
 * failure is reported and exits non-zero — never a silent best-effort.
 */
import { mirrorTitle, mirrorBody, mirrorPrecheck, parseIssueUrl, type UpstreamIssue } from "./issue-mirror.js";
import type { ItemRef, WorkTrackerPort } from "../ports/work-tracker.js";

export interface IssuePlan {
  readonly repo: string;              // owner/repo the issue is created in
  readonly title: string;
  readonly body: string;
  readonly assignee: string;
  /** Board number to add it to, or null when the caller named none and none is active. */
  readonly board: number | null;
  /** The upstream issue this mirrors, when it is one. */
  readonly mirrorOf: string | null;
  /** Labels to set at creation — `gov-intent:<NN>` from `--intent` (spec 03 D8). */
  readonly labels: readonly string[];
}

/** The label that tags an issue into intent `<NN>` of its project (spec 03 D8). */
export const intentLabel = (nn: string): string => `gov-intent:${nn}`;

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
  /** `--intent <NN>`: the intent this issue belongs to. */
  readonly intent?: string;
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
    // An accountable assignee is the reason this verb exists. Creating an unassigned issue here
    // would reproduce by hand the thing the command was written to prevent.
    return { ok: false, message: "Cannot create an issue without an assignee — every board item needs an accountable person." };
  }

  let labels: string[] = [];
  if (req.intent !== undefined) {
    if (!/^\d{1,2}$/.test(req.intent.trim())) return { ok: false, message: `--intent takes the intent's number, as in intents/<NN>-<slug>/ (for example --intent 03), not '${req.intent}'.` };
    labels = [intentLabel(req.intent.trim().padStart(2, "0"))];
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
        labels,
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
    plan: { repo, title: req.title.trim(), body: req.body ?? "", assignee: req.assignee, board: req.board ?? null, mirrorOf: null, labels },
  };
}

/** Why a step after creation failed, as the port said it — printed under the line it explains. */
export interface IssueSummaryWhy { readonly board?: string; readonly label?: string }

/** One line per thing that happened, in the order it happened. */
export function issueSummary(plan: IssuePlan, url: string, addedToBoard: boolean, labelled = true, why: IssueSummaryWhy = {}): readonly string[] {
  return [
    plan.mirrorOf ? `Mirrored ${plan.mirrorOf}` : "Created an issue",
    `  ${url}`,
    `  assigned to ${plan.assignee}`,
    ...(plan.board === null
      ? ["  not on a board — add it with `gov issue … --board <n>`, or gov cannot see it"]
      : addedToBoard
        ? [`  added to board #${plan.board}`]
        : [`  ⚠ could NOT be added to board #${plan.board} — gov will not see it until it is`, ...(why.board ? [`    ${why.board}`] : [])]),
    ...plan.labels.map((l) => (labelled ? `  labelled ${l}` : `  ⚠ could NOT be labelled ${l} — add the label by hand`)),
    ...(!labelled && plan.labels.length > 0 && why.label ? [`    ${why.label}`] : []),
  ];
}

/** What `gov issue` exits with and prints. */
export interface IssueOutcome { readonly code: number; readonly lines: readonly string[] }

/**
 * Perform a plan through the work tracker: create the item (assignee at creation — the port refuses an empty
 * one), put it on the board, then set the intent label.
 *
 * Board and label are separate calls after the create, not folded into it, so that a failure of either still
 * leaves the item's address in hand and the summary can say exactly what exists: an issue that was created but
 * is not on its board, or is unlabelled, is reported as created, with the port's reason, and exits non-zero. A
 * label is not set at creation because a tracker that refuses the label (GitHub: a label the repository does not
 * have) would then refuse the issue too.
 *
 * Never throws: a tracker that throws is reported like one that fails.
 */
export async function createPlannedIssue(plan: IssuePlan, tracker: WorkTrackerPort, boardOwner: string): Promise<IssueOutcome> {
  const [owner = "", name = ""] = plan.repo.split("/");
  const attempt = async <T>(f: () => Promise<{ ok: true; value: T } | { ok: false; reason: string; retryable: boolean }>) => {
    try { return await f(); } catch (e) { return { ok: false as const, reason: (e as Error)?.message ?? String(e), retryable: false }; }
  };

  const made = await attempt(() => tracker.create({ owner, name }, { title: plan.title, body: plan.body, assignee: plan.assignee }));
  if (!made.ok) {
    return {
      code: 1,
      lines: [
        `Could not create the issue in ${plan.repo} — ${made.reason}`,
        made.retryable ? "  This looks temporary; try again." : "  Check that you can write there, and that the assignee can be assigned.",
      ],
    };
  }
  const ref: ItemRef = made.value;

  let added = false;
  const why: { board?: string; label?: string } = {};
  if (plan.board !== null) {
    const a = await attempt(() => tracker.addToProject({ owner: boardOwner, number: plan.board! }, ref));
    added = a.ok;
    if (!a.ok) why.board = a.reason;
  }
  let labelled = true;
  if (plan.labels.length > 0) {
    const l = await attempt(() => tracker.label(ref, plan.labels));
    labelled = l.ok;
    if (!l.ok) why.label = l.reason;
  }
  // A board issue that never reached the board is invisible to gov, and an intent issue without its label is
  // invisible to the intent — so each is a non-zero exit even though the issue itself exists.
  const failed = (plan.board !== null && !added) || !labelled;
  return { code: failed ? 1 : 0, lines: issueSummary(plan, ref.url, added, labelled, why) };
}
