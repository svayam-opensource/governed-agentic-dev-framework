// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * IS THIS GOVERNANCE REPOSITORY ON THE FRAMEWORK THIS gov SPEAKS? (F15 + F16, svm-geneva re-walk, 2026-10-07)
 *
 * A joiner cloned an organization's governance repository that was on an OLDER framework layout than the gov they had
 * just installed (`governance/`, no `policies/governance.yaml`). gov printed "Read first" paths that did not exist in
 * it, offered to start work, and the work failed at seed: "framework/templates/todo-template.md is missing… Run
 * `gov upgrade`" — an instruction the joiner has no right to carry out on their organization's policy repository.
 *
 * So gov compares before it offers. Two kinds of difference, kept apart because they lead to different screens:
 *
 *   gaps     what this gov NEEDS and the repository does not have — the layout, the governance choices, the todo
 *            template a project is seeded from. Any gap: gov cannot start or seed a project here; it says so, and
 *            names who brings the repository forward (its Policy Owner, by `gov upgrade --pr`).
 *   version  the content VERSION against gov's own. Behind is ordinary between upgrades and blocks nothing — the
 *            layout is what seeding depends on — so it is reported, never a refusal.
 *
 * Derived from what is on disk, like `contentLayoutOf`: a marker would be a second copy of a fact the tree states.
 * Pure: the caller supplies `exists` and the two texts.
 */
import { contentLayoutOf } from "./upgrade-sync.js";
import { checkVersionCompat, type CompatStatus } from "./version-compat.js";
import { GOVERNANCE_PATH, parseGovernance } from "../config/governance.js";
import { readTopLevelScalar } from "../resolve/node-env.js";

/** The file a project's todo list is rendered from — `seed` refuses without it (lifecycle/seed.ts). */
export const TODO_TEMPLATE_PATH = "framework/templates/todo-template.md";

export interface FrameworkCurrency {
  /** What this gov needs and the repository lacks, in plain words. Empty = gov can start and seed work here. */
  readonly gaps: readonly string[];
  /** The repository's content VERSION (repo root), or null when it has none. */
  readonly contentVersion: string | null;
  readonly cliVersion: string;
  readonly versionStatus: CompatStatus;
  /** Is the repository older than this gov — by layout or by version? */
  readonly older: boolean;
  /** Can gov start (seed) a project here as it stands? */
  readonly canStartWork: boolean;
}

export function assessFrameworkCurrency(exists: (rel: string) => boolean, contentVersion: string | null, cliVersion: string): FrameworkCurrency {
  const gaps: string[] = [];
  const layout = contentLayoutOf(exists);
  if (layout === "governance") gaps.push("it is on the older `governance/` layout; this gov works on `framework/` + `policies/`");
  else if (layout === "none") gaps.push("it has no `framework/` tree");
  if (!exists(GOVERNANCE_PATH)) gaps.push(`it has no \`${GOVERNANCE_PATH}\` (the organization's governance choices)`);
  if (!exists(TODO_TEMPLATE_PATH)) gaps.push(`it has no \`${TODO_TEMPLATE_PATH}\`, so a project cannot be started in it`);
  const v = (contentVersion ?? "").trim() || null;
  const compat = checkVersionCompat(cliVersion, v);
  const behind = compat.status === "content-behind" || compat.status === "no-marker";
  return {
    gaps, contentVersion: v, cliVersion, versionStatus: compat.status,
    older: gaps.length > 0 || behind,
    canStartWork: gaps.length === 0,
  };
}

/** Who the Policy Owner is, and whether that is the person at the keyboard. */
export interface PolicyOwnerFacts {
  /** `@handle`, or null when the repository names nobody gov can read. */
  readonly handle: string | null;
  readonly isYou: boolean;
}

/**
 * The Policy Owner of a governance repository, from `policy_owner.github` in policies/governance.yaml or — in a
 * repository from before the org-config split — the legacy `policy_owner_github` key in org-config.yaml. Compared to
 * the signed-in GitHub login, case-insensitively (GitHub logins are).
 */
export function policyOwnerFacts(governanceText: string | null, orgConfigText: string | null, me: string | null): PolicyOwnerFacts {
  const nested = governanceText ? parseGovernance(governanceText).policyOwner.github : "";
  const legacy = orgConfigText ? readTopLevelScalar(orgConfigText, "policy_owner_github") ?? "" : "";
  const login = (nested || legacy).trim().replace(/^@+/, "");
  const handle = login ? `@${login}` : null;
  const who = (me ?? "").trim().replace(/^@+/, "").toLowerCase();
  return { handle, isYou: Boolean(login && who && login.toLowerCase() === who) };
}

/**
 * The plain statement a joiner reads when the repository is older than their gov (F15). What is different, who acts,
 * and what changes for them meanwhile — never an instruction to change the organization's repository themselves.
 */
export function olderFrameworkLines(c: FrameworkCurrency, owner: PolicyOwnerFacts, repoLabel: string): string[] {
  if (!c.older) return [];
  const version = c.contentVersion
    ? `framework content ${c.contentVersion}; this gov is ${c.cliVersion}`
    : `no framework VERSION recorded; this gov is ${c.cliVersion}`;
  const who = owner.isYou ? "you, as its Policy Owner, bring" : `its Policy Owner${owner.handle ? ` (${owner.handle})` : ""} brings`;
  if (c.canStartWork) {
    return [
      "",
      `  Your organization's governance (${repoLabel}) is on an older framework release than this gov (${version}).`,
      `  Everything here works as it is; ${who} it forward with \`gov upgrade --pr\` when ready.`,
    ];
  }
  return [
    "",
    `  Your organization's governance is on an older framework than this gov — ${repoLabel} (${version}):`,
    ...c.gaps.map((g) => `    · ${g}`),
    "",
    owner.isYou ? "  As its Policy Owner, you bring it forward:  gov upgrade --pr" : `  Its Policy Owner${owner.handle ? ` (${owner.handle})` : ""} brings it forward:  gov upgrade --pr`,
    "  — a pull request that moves it to the current layout, carrying every file the organization wrote.",
    "",
    "  What that means for you until it merges:",
    "    · you can read the organization's policies in your workspace;",
    "    · gov cannot start a project in it yet — starting one would fail at the first step;",
    `    · once the upgrade has merged, run  gov  → 1. Work.${owner.isYou ? "" : " Nothing for you to change in the repository."}`,
  ];
}

/** What the Work flow says instead of offering a project it cannot start (F16). */
export function cannotStartWorkLines(gaps: readonly string[], owner: PolicyOwnerFacts | null): string[] {
  const who = owner?.isYou ? "as its Policy Owner, you run" : `its Policy Owner${owner?.handle ? ` (${owner.handle})` : ""} runs`;
  return [
    "  This governance repository is on an older framework than this gov, so no project can be started in it yet:",
    ...gaps.map((g) => `    · ${g}`),
    `  Bring it forward first — ${who}:  gov upgrade --pr`,
    "  Projects already started still open; a new one waits for that pull request to merge.",
  ];
}
