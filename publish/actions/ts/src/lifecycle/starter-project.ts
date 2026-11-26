// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PRACTICE PROJECT — "Make the policy ours" (F136, PRJ-121; rulings Q27 B, Q29 A, Q30 A, Q38 B+, Q39 A).
 *
 * The first governed change in a new organization is made for the adopter to walk through, without a question:
 *
 *   first run (adopter only) ─► board "Make the policy ours"
 *                            ─► anchor issue, labelled `anchor` + `practice`  (gov-licence finds the board by it)
 *                            ─► one task issue: the title-page change to policies/policy-document.yaml
 *                            ─► `gov seed` — the project branch BRNCH-<board#>-make-the-policy-ours
 *
 * The board and anchor are made the way `gov project <name> --seed` makes any project (project/create.ts), so the
 * practice project is an ordinary project and every verb treats it as one. The task issue tells the agent to make
 * the change with `gov rules propose`, and says ahead of time that the pull request will stop and wait for someone
 * else's approval — that stop is what the exercise shows. There is no way round it for a solo organization; the
 * issue says to invite a teammate (Q38 B+). The title page is the Policy Owner's (ruling F142 A), and the adopter is
 * the Policy Owner and the author, so the check asks the Check Owner: the teammate is named Check Owner in
 * policies/governance.yaml.
 *
 * It replaced the "Create it? [y/N]" starter project (#186), which made a board and a plain issue — no anchor, no
 * project branch — and only when asked. Joiners never get it: their first project is one they are assigned to.
 */
import type { BoardSummary } from "./project-list.js";
import { createGovProject, type ProjectEnv } from "../project/create.js";
import { boardListsAnchor } from "../project/board-wait.js";
import { DEFAULT_ANCHOR_LABEL } from "./anchor.js";
import { log } from "../log.js";
import { frameworkOwners, GOVERNANCE_PATH, parseGovernance, type GovernancePosture } from "../config/governance.js";
import type { ProtectionFacts } from "./branch-protection.js";

/** The board's title — and so the project id's slug, `make-the-policy-ours`. */
export const PRACTICE_BOARD_TITLE = "Make the policy ours";
/** The label beside `anchor` on the practice project's anchor issue (Q39 A). */
export const PRACTICE_LABEL = "practice";
/** The policy file the practice change edits (Q29 A). */
export const PRACTICE_FILE = "policies/policy-document.yaml";

/** The slug `deriveProjectIdentity` makes of the board title — how `gov work` is pointed at the practice project. */
export const practiceSlug = (): string => PRACTICE_BOARD_TITLE.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The policy title the practice change writes: "<org> Development and Operations Policy" (Q30 A). */
export function practicePolicyTitle(orgName: string): string {
  const org = orgName.trim();
  return org ? `${org} Development and Operations Policy` : "Development and Operations Policy";
}

export interface PracticeTask {
  readonly title: string;
  readonly body: string;
}

/**
 * WHAT ACTUALLY STOPS THE MERGE, said honestly (Q42 C). Every new organization has the approval check from its first
 * commit; whether GitHub also BLOCKS a merge past it depends on the posture and the plan:
 *
 *   enforced        hard posture, and the default branch is protected — GitHub will not merge it
 *   soft            soft posture — nothing technically stops a merge; the check is visible, the merge recorded
 *   unprotectable   hard posture, but the plan offers no protection (a private repository on GitHub Free)
 */
export type PracticeEnforcement = "enforced" | "soft" | "unprotectable";

/**
 * Which of the three the organization is in: its posture, and — under hard — what GitHub says protects the default
 * branch (`parseProtection` of `branches/<b>/protection`; null when it would not say). Pure.
 */
export function practiceEnforcement(posture: GovernancePosture | null, protection: ProtectionFacts | null): PracticeEnforcement {
  if (posture !== "hard") return "soft";
  return protection && protection.pullRequestRequired && protection.approvingReviews >= 1 && protection.enforceAdmins
    ? "enforced" : "unprotectable";
}

const STOP_TEXT: Readonly<Record<PracticeEnforcement, readonly string[]>> = {
  enforced: [
    "Your default branch is protected, so GitHub will not let the pull request merge until that approval",
    "arrives.",
  ],
  soft: [
    "Your organization uses soft governance, so GitHub does not block the merge: nothing technically stops",
    "someone merging past the check. But the check stays red where everyone can see it, and a merge past a",
    "failing check is recorded for the Policy Owner. Do not merge it yourself.",
  ],
  unprotectable: [
    "Your organization chose hard governance, but GitHub's plan for this repository offers no branch",
    "protection, so GitHub cannot block the merge: nothing technically stops someone merging past the check.",
    "The check stays red on the pull request where everyone can see it. Do not merge it yourself.",
    "`gov repo protect plan` explains the ways to make the protection possible.",
  ],
};

/**
 * WHO THE PULL REQUEST WAITS FOR (rulings F142 A and Q44 A, 2026-11-23). The title page is the Policy Owner's; the
 * adopter is the Policy Owner and the author, so the check asks the Check Owner. Setup asks for that second person:
 *
 *   named   the pull request waits for them, by handle, and nothing else is needed
 *   none    the adopter invites a teammate and names them Check Owner — itself a policy pull request, which stops
 *           the same way while nobody else holds either role (said per posture: only soft records the merge)
 */
const SOLO_MERGE: Readonly<Record<PracticeEnforcement, readonly string[]>> = {
  enforced: [
    "Your default branch is protected, so GitHub will not merge that pull request either until someone other",
    "than you approves it.",
  ],
  soft: [
    "Until someone else holds one of those roles, that pull request, like this one, can merge only past its red",
    "check. While nobody else holds a role, such a merge is recorded as \"self-merged: no second person\" on one",
    "solo-mode issue, not as a violation.",
  ],
  unprotectable: [
    "Until someone else holds one of those roles, that pull request, like this one, can merge only past its red",
    "check: GitHub cannot block it here, and the check stays red where everyone can see it.",
  ],
};

const at = (h: string): string => `@${h.trim().replace(/^@+/, "")}`;

function namedText(checkOwner: string, enforcement: PracticeEnforcement): string[] {
  return [
    "The policy's title page is the Policy Owner's to approve. Setup made you the Policy Owner, and you made",
    `this change, so the check asks your **Check Owner**, ${at(checkOwner)}, to approve it instead. Nothing else is`,
    `needed: ask ${at(checkOwner)} to review and approve it.`,
    "",
    ...STOP_TEXT[enforcement],
    "",
    "There is no way to approve it yourself, and no exception for it: a policy its author could approve alone",
    "would not be governed.",
    "",
    "Once the pull request is waiting for that approval, the practice is done. The change merges when",
    `${at(checkOwner)} approves it.`,
  ];
}

function soloText(enforcement: PracticeEnforcement): string[] {
  return [
    "The policy's title page is the Policy Owner's to approve. Setup made you the Policy Owner, and you made",
    "this change, so the check asks the **Check Owner** to approve it instead. You named nobody else at setup,",
    "so you are the Check Owner as well, and the check says: "
      // SOLO MODE (Q45 C): under soft posture the check's words are the self-merge's; under hard, as before.
      + (enforcement === "soft" ? "\"self-merged: no second person\" (solo mode)." : "\"Add a second person to one of them\"."),
    "",
    ...STOP_TEXT[enforcement],
    "",
    "Invite a teammate to your GitHub organization and name them Check Owner: put their GitHub handle in",
    `\`check_owner.github\` in \`${GOVERNANCE_PATH}\`. That file is policy too, so naming them is a pull request of its`,
    "own, and it needs the same approval.",
    ...SOLO_MERGE[enforcement],
    "Then ask them to review and approve this one. There is no way to approve it yourself, and no exception for",
    "it: a policy its author could approve alone would not be governed.",
    "",
    "Once the pull request is waiting for that approval, the practice is done. The change merges when your",
    "Check Owner approves it.",
  ];
}

/** The one task issue on the practice board: what to change, how, and why the pull request will stop. */
export function practiceTask(orgName: string, enforcement: PracticeEnforcement = "soft", checkOwner: string | null = null): PracticeTask {
  const title = practicePolicyTitle(orgName);
  return {
    title: "Put our name on the policy",
    body: [
      "This is your organization's first governed change. It is small on purpose, so that what you notice is",
      "the process around it: a project branch, a task, a policy change with its paperwork, and a pull request",
      "that waits for someone else to approve it.",
      "",
      "## The change",
      "",
      `In \`${PRACTICE_FILE}\`, on the title page (\`title_page:\`):`,
      "",
      `- \`title:\` becomes \`"${title}"\``,
      "- `approved_by:` becomes `\"Policy Owner\"`",
      "",
      "Leave `approved_on` and `effective_from` empty. The real date is the day this change merges.",
      "",
      "## How — you and your agent",
      "",
      "1. Run `gov work` and pick this project. You are on its project branch, with your agent reading the rules.",
      "2. Start a task for this issue: `gov task <this issue's link>`.",
      "3. Make the two edits above.",
      "4. Run `gov rules propose`. Anything under `policies/` is policy, and a policy change carries its",
      "   paperwork with it: the rule rows brought up to date, a new number in `policies/VERSION`, a frozen copy",
      "   of the previous policy under `policies/history/`, and an entry in `policies/CHANGELOG.md` that lists",
      "   the sections reviewed. `gov rules propose` writes all of it. Do not write it by hand — the policy",
      "   check on the pull request compares it with the change and fails when it does not match.",
      "5. Commit, then land the task on the project branch: `gov merge <this issue's link>`.",
      "6. Run `gov close`. It opens the pull request into the default branch and leaves it open for review. If",
      "   the policy check on that pull request says the changelog entry is waiting for it, run",
      "   `gov rules propose` once more on the project branch and push.",
      "",
      "## Then it stops — and that is the point",
      "",
      "The pull request shows a check waiting for approval by someone other than the person who made the",
      "change. Nobody approves their own work here — not the author, not the Policy Owner, not an administrator.",
      "Seeing gov stop your own change is what this exercise is for.",
      "",
      ...(checkOwner ? namedText(checkOwner, enforcement) : soloText(enforcement)),
    ].join("\n"),
  };
}

/** What was actually built, for the caller to report honestly. */
export interface PracticeOutcome {
  readonly boardUrl: string | null;
  readonly anchorUrl: string | null;
  readonly taskUrl: string | null;
  /** `gov seed` finished: the project branch exists. */
  readonly seeded: boolean;
  /** An open practice project already existed and is the one to use — nothing was created. */
  readonly reused?: boolean;
  /** GitHub could not list the org's boards, so gov did not risk creating a second one. */
  readonly unchecked?: boolean;
  /** What `gov project` said when it could not finish — the whole of what exists, in its words. */
  readonly stopped?: readonly string[];
}

/** The calls the practice project needs — injected, so it is testable against the memory ports. */
export interface PracticeDeps extends ProjectEnv {
  /** The org's boards, open and closed; null when GitHub could not be asked. */
  readonly listBoards: (owner: string) => readonly BoardSummary[] | null;
  /** `gov seed <board-url>` — its exit code. */
  readonly seed: (boardUrl: string) => Promise<number> | number;
  readonly boardWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * REUSE THE OPEN PRACTICE PROJECT; CREATE ONE ONLY WHEN NONE IS OPEN (adoption walk #5, 2026-10-07: every run used to
 * make another — the walk found 17). Matched by title, case-insensitive, open only; the oldest open one wins. A board
 * list GitHub did not answer creates nothing: a possible duplicate is the defect, a skipped convenience is not.
 */
export async function ensurePracticeProject(
  deps: PracticeDeps, orgName: string, enforcement: PracticeEnforcement = "soft", checkOwner: string | null = null,
): Promise<PracticeOutcome> {
  const none = { boardUrl: null, anchorUrl: null, taskUrl: null, seeded: false } as const;
  const boards = deps.listBoards(deps.owner);
  if (boards === null) return { ...none, unchecked: true };
  const wanted = PRACTICE_BOARD_TITLE.toLowerCase();
  const open = boards.filter((b) => !b.closed && b.title.trim().toLowerCase() === wanted).sort((a, b) => a.number - b.number)[0];
  if (open) return { ...none, boardUrl: open.url, reused: true };

  // THE SAME PATH AS `gov project "Make the policy ours" --seed` — board, anchor (with `practice`), on the board.
  const made = await createGovProject(deps, { name: PRACTICE_BOARD_TITLE, repos: [], anchorLabels: [PRACTICE_LABEL] });
  if (!made.ok) {
    return { ...none, boardUrl: made.created.board?.url ?? null, anchorUrl: made.created.anchor?.url ?? null, stopped: made.lines };
  }
  const board = made.created.board!.ref;
  const anchorUrl = made.created.anchor?.url ?? null;

  // THE TASK ISSUE, in the governance repo, assigned to the person who adopted, on the board.
  const who = await deps.vcs.identity();
  const task = practiceTask(orgName, enforcement, checkOwner);
  const issue = who.ok
    ? await deps.tracker.create(deps.govRepo, { title: task.title, body: task.body, assignee: who.value.login })
    : null;
  const taskUrl = issue?.ok ? issue.value.url : null;
  if (issue?.ok) await deps.tracker.addToProject(board, issue.value);

  // THE PROJECT BRANCH — `gov seed`, once the board lists its anchor (GitHub's project index lags).
  if (!(await boardListsAnchor(deps, made.created))) {
    return { boardUrl: made.boardUrl, anchorUrl, taskUrl, seeded: false };
  }
  // A seed that THROWS is a seed that did not finish — the board, anchor and task stand, and the summary says how to
  // finish it. It must never end an adoption that has otherwise succeeded.
  let code: number;
  try {
    code = await deps.seed(made.boardUrl);
  } catch (e) {
    // Logged, not rethrown: rethrowing would end the adoption, and the summary already says "not seeded yet" with the
    // command that finishes it.
    log("warn", `gov seed did not finish for the practice project: ${(e as Error)?.message ?? String(e)}`,
      "gov-work:lifecycle:starter-project", "ensurePracticeProject", { boardUrl: made.boardUrl });
    code = 1;
  }
  return { boardUrl: made.boardUrl, anchorUrl, taskUrl, seeded: code === 0 };
}

export function practiceSummary(o: PracticeOutcome): readonly string[] {
  if (o.unchecked) {
    return [
      "  Could not check whether your organization already has a practice project — GitHub did not list its boards —",
      "  so gov did not create another. Run `gov` → Work to find it, or re-run setup when GitHub answers.",
    ];
  }
  if (o.reused && o.boardUrl) {
    return [
      "  You already have one, still open — reusing it rather than creating another:",
      `  Board:   ${o.boardUrl}`,
      "  Run `gov work` and pick it.",
    ];
  }
  if (o.stopped) {
    return [
      ...o.stopped.map((l) => `  ${l}`),
      "  Nothing else is affected. You can create it later with:",
      `    gov project "${PRACTICE_BOARD_TITLE}" --seed`,
      `  and add the \`${PRACTICE_LABEL}\` label to its anchor issue.`,
    ];
  }
  return [
    `  Board:   ${o.boardUrl}`,
    ...(o.anchorUrl ? [`  Anchor:  ${o.anchorUrl} — labelled ${DEFAULT_ANCHOR_LABEL}, ${PRACTICE_LABEL}`] : []),
    o.taskUrl ? `  Task:    ${o.taskUrl}` : "  ⚠ the task issue could not be created — the board has only its anchor",
    o.seeded
      ? "  Seeded:  the project branch exists — run `gov work` and pick it"
      : `  Not seeded yet — run \`gov work\` and pick it, and gov will seed it (or: gov seed ${o.boardUrl})`,
  ];
}

/**
 * Q44 A: the second person setup recorded — the Check Owner in policies/governance.yaml when it is not the Policy
 * Owner; null when one person holds both (or the Check Owner is vacant). Pure over the file's text.
 */
export function practiceCheckOwner(governanceText: string | null): string | null {
  const o = frameworkOwners(parseGovernance(governanceText));
  const key = (h: string) => h.trim().replace(/^@+/, "").toLowerCase();
  return o.checkOwner && key(o.checkOwner) && key(o.checkOwner) !== key(o.policyOwner) ? o.checkOwner.trim().replace(/^@+/, "") : null;
}
