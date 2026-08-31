// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * What to do now — for the two people who reach the end of setup (#186).
 *
 * It used to end with *"gov is ready in this shell. Try: gov"*, which tells you the
 * tool works and nothing about what you came to do. An adopter has an organization
 * to settle before anyone else can be invited into it; a joiner has none of that
 * and needs the opposite reassurance — that the rules are already decided, and
 * where to read them.
 *
 * Three routes are given for the review, deliberately. The governed one is the
 * point of the framework, and saying so while pretending the other two do not exist
 * would be a lie an admin sees through immediately: they have write access to that
 * repository and will use GitHub or their editor if that is faster. Naming which is
 * governed and which is not respects that, and makes the choice a decision rather
 * than a workaround.
 */

export interface NextStepsFacts {
  readonly orgSlug: string;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  readonly workspacePath: string;
}

const p = (f: NextStepsFacts): { home: string; slug: string } => ({
  home: f.workspacePath || `~/.gov/${f.orgSlug.toLowerCase()}/gov_repo`,
  slug: f.orgSlug.toLowerCase(),
});

export function adopterNextSteps(f: NextStepsFacts): readonly string[] {
  const { home, slug } = p(f);
  return [
    "",
    "Governance is installed and ready.",
    "",
    "Before you invite anyone else in — the policy owner, the architecture owners,",
    "your developers — there is one thing only you can do first: the policies that",
    "arrived are the framework's starting position, not your organization's.",
    "",
    "  Review the seeded policies, and change what does not fit.",
    "",
    "Three ways, and they differ in more than convenience:",
    "",
    "  A. On GitHub — read-only, quickest to skim",
    "     1. Go to https://github.com/" + f.githubOrg,
    `     2. Open ${f.workspaceRepo}`,
    "     3. Read knowledge/policies/ — start with agentic-development-policy.md",
    "",
    "  B. In your editor (VS Code, Cursor, Eclipse…) — direct, and UNGOVERNED",
    `     1. Open ${home}`,
    "     2. Make sure you are on the main branch",
    "     3. Edit what you like, then commit and push",
    "     This bypasses the review the framework exists to provide. It is your right",
    "     as the admin, and worth using deliberately rather than by habit.",
    "",
    "  C. Through gov — the governed way, and the one to learn",
    "     1. Run:  gov",
    "     2. Choose  1. Work",
    "     3. Pick the review project",
    "     Your changes land on a project branch and arrive as a pull request, which",
    "     is how every change will work once other people are involved.",
    "",
    `Your workspace: ${home}`,
    `Projects will be cloned under: ~/.gov/${slug}/projects/`,
    "",
    "Then read, in this order:",
    "  knowledge/policies/roles.md                      who is accountable for what",
    "  knowledge/policies/agentic-development-policy.md the rules of work",
    "  knowledge/policies/data-classification.md        what may never leave",
    "",
  ];
}

export function joinerNextSteps(f: NextStepsFacts): readonly string[] {
  const { home, slug } = p(f);
  return [
    "",
    "You are set up, and there is nothing for you to configure.",
    "",
    "Your organization has already decided how work is governed here. Those decisions",
    "are in your workspace, and they apply to you from now on — which means the useful",
    "next step is reading them, not changing them.",
    "",
    "  Read first:",
    `    ${home}/knowledge/policies/agentic-development-policy.md`,
    "      how work is organized, what must be reviewed, and what your AI assistant",
    "      must do before it touches anything",
    `    ${home}/agent/session-protocol.md`,
    "      what your agent reads at the start of every session",
    `    ${home}/knowledge/policies/roles.md`,
    "      who to ask when something here does not fit",
    "",
    "  Then start working:",
    "    1. Run:  gov",
    "    2. Choose  1. Work",
    "    3. Pick a project you are assigned to",
    "       gov clones it, puts you on the project branch, and opens your agent with",
    "       the rules already loaded.",
    "",
    `Your workspace: ${home}`,
    `Projects will be cloned under: ~/.gov/${slug}/projects/`,
    "",
    "If a rule gets in your way, propose a change rather than working around it:",
    "  gov knowledge propose <short-name>",
    "It goes to whoever owns that area, as a pull request. That is the whole point.",
    "",
  ];
}
