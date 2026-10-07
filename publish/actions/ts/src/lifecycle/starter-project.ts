// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The first project, made for you, so the first governed thing you do is read your
 * own policies (#186).
 *
 * Adoption ended with "review the seeded policies" and no way to do it that was not
 * either read-only (GitHub) or ungoverned (open the folder and edit). Both work.
 * Neither is the framework. The one route that demonstrates what was just installed
 * — a board, an issue, a project branch, a pull request — required the adopter to
 * assemble it by hand, on their first day, out of concepts they had not met yet.
 *
 * So it is assembled for them, and the work in it is the review they already need
 * to do. The starter project is not a toy: its issue is real, its branch is real,
 * and merging it is how the org's policies become the org's.
 *
 * Pure planning. The caller performs it, and may decline.
 */
import type { BoardSummary } from "./project-list.js";

export interface StarterProject {
  readonly boardTitle: string;
  readonly issueRepo: string;
  readonly issueTitle: string;
  readonly issueBody: string;
}

export function starterProject(githubOrg: string, workspaceRepo: string): StarterProject {
  return {
    boardTitle: "Review our governance",
    issueRepo: `${githubOrg}/${workspaceRepo}`,
    issueTitle: "Make the seeded policies ours",
    issueBody: [
      "The framework seeded a starting position. This issue is for turning it into",
      "**our** position — and for doing that through the process it describes, so the",
      "first governed change in this organization is the one that decides how the rest",
      "will be governed.",
      "",
      "## What to look at, in this order",
      "",
      "  setup. Name the people who will actually hold them, or leave a role with the",
      "  Policy Owner deliberately. An empty role escalates by design; an *assumed*",
      "  one does not exist.",
      "- `framework/docs/specs/framework-specification.md` — how the framework works.",
      "  Read chapter 3 (how strict a rule is) and chapter 6 (what an agent does at",
      "  session start) before changing anything; most of the document rests on those two.",
      "- `policies/governance.yaml` (authorized_agents) — which agents are authorized, and what may",
      "  be sent to a model and which models are allowed. These carry your strictest",
      "  rules and are the likeliest to need your own wording rather than ours.",
      "- `CODEOWNERS` — maps each knowledge area to whoever approves changes to it.",
      "  If you changed roles above, reconcile it here or reviews route to the wrong",
      "  person and nobody notices until someone is waiting.",
      "",
      "## How",
      "",
      "```",
      "gov          →  1. Work  →  this project",
      "```",
      "",
      "That puts you on a project branch with your agent already reading the rules.",
      "Changes land as a pull request, reviewed by the owners named in `roles.md` —",
      "which is the whole mechanism, exercised once, on the smallest possible change.",
      "",
      "Close this when the policies say what your organization means.",
    ].join("\n"),
  };
}

/** What was actually built, for the caller to report honestly. */
export interface StarterOutcome {
  readonly boardUrl: string | null;
  readonly issueUrl: string | null;
  readonly seeded: boolean;
  /** An open review project already existed and is the one to use — nothing was created. */
  readonly reused?: boolean;
  /** GitHub could not list the org's boards, so gov did not risk creating a second one. */
  readonly unchecked?: boolean;
}

/** The GitHub calls the starter project needs — injected, so the reuse rule is testable without GitHub. */
export interface StarterDeps {
  /** The org's boards, open and closed; null when GitHub could not be asked. */
  readonly listBoards: (owner: string) => readonly BoardSummary[] | null;
  readonly createBoard: (owner: string, title: string) => string | null;
  readonly createIssue: (repo: string, title: string, body: string) => string | null;
  readonly addToBoard: (owner: string, boardNumber: number, issueUrl: string) => void;
}

/**
 * REUSE THE OPEN REVIEW PROJECT; CREATE ONE ONLY WHEN NONE IS OPEN (adoption walk #5, 2026-10-07). Every setup run
 * used to create a new board — the walk found 17 of them (PRJ-13…29), each with its own copy of the same issue.
 * Matched by title (case-insensitive) and open (not started, or in progress — a closed board is finished or
 * cancelled); the oldest open one wins, being the one any work already went into. A board list GitHub did not
 * answer creates nothing: a possible duplicate is the defect, and a skipped convenience is not.
 */
export function ensureStarterProject(deps: StarterDeps, githubOrg: string, workspaceRepo: string): StarterOutcome {
  const spec = starterProject(githubOrg, workspaceRepo);
  const boards = deps.listBoards(githubOrg);
  if (boards === null) return { boardUrl: null, issueUrl: null, seeded: false, unchecked: true };
  const title = spec.boardTitle.toLowerCase();
  const open = boards.filter((b) => !b.closed && b.title.trim().toLowerCase() === title).sort((a, b) => a.number - b.number)[0];
  if (open) return { boardUrl: open.url, issueUrl: null, seeded: false, reused: true };
  const boardUrl = deps.createBoard(githubOrg, spec.boardTitle);
  const issueUrl = boardUrl ? deps.createIssue(spec.issueRepo, spec.issueTitle, spec.issueBody) : null;
  if (boardUrl && issueUrl) {
    const n = Number(boardUrl.match(/\/projects\/(\d+)/)?.[1] ?? 0);
    if (n) deps.addToBoard(githubOrg, n, issueUrl);
  }
  return { boardUrl, issueUrl, seeded: false, reused: false };
}

export function starterSummary(o: StarterOutcome): readonly string[] {
  if (o.unchecked) {
    return [
      "  Could not check whether your organization already has a review project — GitHub did not list its boards —",
      "  so gov did not create another. Run `gov` → Work to find it, or re-run setup when GitHub answers.",
    ];
  }
  if (o.reused && o.boardUrl) {
    return [
      `  You already have one, still open — reusing it rather than creating another:`,
      `  Board:   ${o.boardUrl}`,
      "  Run `gov` → Work → pick it, and you are on the project branch",
    ];
  }
  if (!o.boardUrl) {
    return [
      "  Could not create the starter project board — your token may lack the `project` scope.",
      "  Nothing else is affected; review the policies through GitHub or your editor instead.",
    ];
  }
  return [
    `  Board:   ${o.boardUrl}`,
    ...(o.issueUrl ? [`  Issue:   ${o.issueUrl}`] : ["  ⚠ the issue could not be created — the board is empty"]),
    o.seeded
      ? "  Seeded:  run `gov` → Work → pick it, and you are on the project branch"
      : "  Not seeded yet — run `gov` → Work → pick it, and gov will seed it for you",
  ];
}
