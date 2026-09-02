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
      "- `knowledge/policies/roles.md` — every role currently points at whoever ran",
      "  setup. Name the people who will actually hold them, or leave a role with the",
      "  Policy Owner deliberately. An empty role escalates by design; an *assumed*",
      "  one does not exist.",
      "- `knowledge/policies/agentic-development-policy.md` — the rules of work.",
      "  Read §2 (compliance levels) and §7 (agent operating standards) before",
      "  changing anything; most of the document rests on those two.",
      "- `knowledge/policies/data-classification.md` and `llm-governance.md` — what may",
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
}

export function starterSummary(o: StarterOutcome): readonly string[] {
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
