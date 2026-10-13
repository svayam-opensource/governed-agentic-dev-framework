// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE UPGRADE PR, IN FOUR ORDERED COMMITS (PRJ-121 intent 01, rulings Q6 and Q3).
 *
 * One `gov upgrade --pr` used to be one commit: the framework's files, the org's moved documents, the migrated values
 * and anything gov proposed, all in one diff. A reviewer could not tell what gov owned from what it had moved of
 * theirs, and could not drop a part they disagreed with. So the plan is applied as up to four commits, always in
 * this order, each reviewable on its own:
 *
 *   1 framework       the framework's files in, the framework's retired files out
 *   2 org moves       the organization's own documents, moved byte for byte
 *   3 migrations      values carried between files, missing org files seeded, rows relocated, CODEOWNERS
 *   4 proposed prose  text gov PROPOSES for the org's documents — the Policy Owner keeps, edits or drops this commit
 *
 * A commit with nothing in it is not made. The PR body lists every move, retirement, migration and substitution,
 * every entry gov did not recognise and left where it is (Q3), and what to run after merging.
 *
 * Pure: which commit an action belongs to, and what the body says. upgrade-run.ts applies and commits.
 */
import { isOrgOwned, type PlanAction, type UpgradePlan } from "./upgrade-sync.js";

export type UpgradeCommit = "framework" | "org-moves" | "migrations" | "proposed-prose";

/** The commits, in the order they are made. */
export const UPGRADE_COMMITS: readonly UpgradeCommit[] = ["framework", "org-moves", "migrations", "proposed-prose"];

/** The subject line of each commit — stable, so a reviewer (and a test) can find each part by name. */
export function commitSubject(commit: UpgradeCommit, version: string): string {
  switch (commit) {
    case "framework": return `gov upgrade 1/4 framework: content ${version} in, retired framework files out`;
    case "org-moves": return "gov upgrade 2/4 org moves: the organization's own files, moved byte for byte";
    case "migrations": return "gov upgrade 3/4 migrations: values carried, org files seeded, rows relocated";
    case "proposed-prose": return "gov upgrade 4/4 PROPOSED prose: keep, edit or drop this commit";
  }
}

/**
 * Which commit a planned action lands in. An action may name its own (`commit`), as the bridge's retirements of the
 * org's old exception templates do; otherwise: a move is the org's file moving; a migration, or anything written into
 * the org's own tree (a starter it lacked), is a migration; everything else is the framework's.
 */
export function commitOf(a: PlanAction, owned: readonly string[] = []): UpgradeCommit {
  if (a.commit) return a.commit;
  if (a.kind === "move") return "org-moves";
  if (a.kind === "migrate") return "migrations";
  return isOrgOwned(a.dst, owned) ? "migrations" : "framework";
}

/** The plan, split by commit (plan order kept within each). */
export function splitPlan(plan: UpgradePlan, owned: readonly string[] = []): Record<UpgradeCommit, PlanAction[]> {
  const out: Record<UpgradeCommit, PlanAction[]> = { "framework": [], "org-moves": [], "migrations": [], "proposed-prose": [] };
  for (const a of plan.actions) out[commitOf(a, owned)].push(a);
  return out;
}

/** What gov runs after the upgrade PR is merged, in order (Q6, spec §4.2 "after merge"). */
export const NEXT_AFTER_MERGE: readonly { readonly command: string; readonly why: string }[] = [
  { command: "gov rules propose --all", why: "a policy PR: rules proposed from your policies' prose, approved by the Policy Owner" },
  { command: "gov rules build", why: "renders the approved rules into agent/harness/rule-map.md" },
  { command: "gov repo protect apply", why: "branch protection and the approver check, from the role list" },
  { command: "gov check install --all", why: "the gov-checks workflow in every repository" },
];

/** Paths gov itself writes at run time — never "unrecognised". */
export const GENERATED_PATHS: readonly string[] = [
  "CODEOWNERS", ".gov-upgrade-moves.json", "framework/upgrade-moves.json",
  ".github/workflows/approver-check.yml", ".github/workflows/gov-checks.yml",
];

/** The org's own trees: whatever it keeps there is its business, not an unrecognised entry. */
export const ORG_TREES: readonly string[] = ["policies/", "knowledge/", "projects/"];

/**
 * WHAT GOV DID NOT RECOGNISE, LEFT EXACTLY WHERE IT IS (Q3). Every file of the repo that no manifest row ships, that
 * the plan does not move, migrate or retire, that gov does not generate, and that is not in the org's own trees. A
 * folder is named once (`docs/`) when every file under it is unrecognised; otherwise its files are named one by one.
 */
export function unrecognisedEntries(files: readonly string[], plan: UpgradePlan, shipped: readonly string[]): string[] {
  const shippedSet = new Set(shipped);
  const touched = (p: string): boolean => plan.actions.some((a) =>
    a.from === p || (a.from?.endsWith("/") && p.startsWith(a.from)) || (a.kind === "retire" && (a.dst === p || (a.dst.endsWith("/") && p.startsWith(a.dst)))));
  const unknown = new Set(files.filter((p) => !shippedSet.has(p) && !GENERATED_PATHS.includes(p) && !ORG_TREES.some((t) => p.startsWith(t)) && !touched(p)));
  const out: string[] = [];
  const visit = (dir: string): void => {
    const under = files.filter((f) => f.startsWith(dir));
    if (dir && under.length && under.every((f) => unknown.has(f))) { out.push(dir); return; }
    const children = new Set(under.map((f) => f.slice(dir.length).split("/")[0]!));
    for (const c of [...children].sort()) {
      if (files.includes(`${dir}${c}`)) { if (unknown.has(`${dir}${c}`)) out.push(`${dir}${c}`); }
      else visit(`${dir}${c}/`);
    }
  };
  visit("");
  return out;
}

/** One exact old-path rewrite gov proposes in an org document (T9), and how many times it made it. */
export interface Substitution { readonly file: string; readonly from: string; readonly to: string; readonly count: number }

/** Something gov left where it is, and why — listed in the PR body, never touched. */
export interface LeftInPlace { readonly path: string; readonly why: string }

export interface UpgradePrReport {
  readonly version: string;
  readonly plan: UpgradePlan;
  /** The commits actually made, in order. */
  readonly commits: readonly { readonly commit: UpgradeCommit; readonly files: number }[];
  /** Files no manifest row, move or retirement accounts for (unrecognisedEntries). */
  readonly unrecognised: readonly string[];
  /** Entries a migration step looked at and deliberately left (with the reason). */
  readonly leftInPlace?: readonly LeftInPlace[];
  /** Commit 4: every exact old-path rewrite. */
  readonly substitutions?: readonly Substitution[];
  /** Commit 4: what else was proposed, one line each. */
  readonly proposed?: readonly string[];
  /** Lines a step wants said under "Migrated" beyond the plan's migrate actions (role list settled, …). */
  readonly migrated?: readonly string[];
}

const code = (p: string): string => `\`${p}\``;

/** The pull request's body: every change by kind, what was left alone, and what to run after merging. */
export function upgradePrBody(r: UpgradePrReport): string {
  const of = (k: PlanAction["kind"]): PlanAction[] => r.plan.actions.filter((a) => a.kind === k);
  const section = (title: string, lines: readonly string[], none: string): string[] => ["", `## ${title}`, "", ...(lines.length ? lines : [none])];
  const conflicts = of("conflict");
  const left = [
    ...r.unrecognised.map((p) => `- ${code(p)} — not recognised; left exactly where it is`),
    ...(r.leftInPlace ?? []).map((l) => `- ${code(l.path)} — ${l.why}`),
  ];
  return [
    `Syncs this gov workspace to framework content **${r.version}** — generated by \`gov upgrade\`.`,
    "",
    "Review it one commit at a time — each is one kind of change:",
    "",
    ...r.commits.map((c, i) => `${i + 1}. ${commitSubject(c.commit, r.version)} (${c.files} file(s))`),
    ...(r.commits.some((c) => c.commit === "proposed-prose")
      ? ["", "The last commit is a **proposal**: keep it, edit it in this branch, or drop it (`git revert` it here) before merging."] : []),
    ...section("Moved — the organization's own files, byte for byte", of("move").map((a) => `- ${code(a.from ?? "")} → ${code(a.dst)}`), "Nothing moved."),
    ...section("Retired", of("retire").map((a) => `- ${code(a.dst)}${a.detail ? ` — ${a.detail}` : ""}`), "Nothing retired."),
    ...section("Migrated", [
      ...of("migrate").map((a) => `- ${code(a.from ?? "")} → ${code(a.dst)}${a.how ? ` (\`${a.how}\`)` : ""}`),
      ...(r.migrated ?? []).map((m) => `- ${m}`),
    ], "Nothing migrated."),
    ...section("Substitutions — proposed (commit 4)", (r.substitutions ?? []).map((s) => `- ${code(s.file)}: ${code(s.from)} → ${code(s.to)}${s.count > 1 ? ` (${s.count}×)` : ""}`), "No substitutions."),
    ...((r.proposed ?? []).length ? section("Proposed (commit 4)", (r.proposed ?? []).map((p) => `- ${p}`), "") : []),
    ...section("Left in place — not touched", left, "Nothing unrecognised: every file is accounted for."),
    ...(conflicts.length ? section("Review carefully", [
      "These differed from the framework baseline and may hold your customizations. This branch applies the framework version; restore your edits per file in the diff where needed:",
      ...conflicts.map((c) => `- ${code(c.dst)}`),
    ], "") : []),
    ...section("Next, after merging", NEXT_AFTER_MERGE.map((n, i) => `${i + 1}. \`${n.command}\` — ${n.why}`), ""),
  ].join("\n");
}

/**
 * A STEP THAT EXTENDS THE UPGRADE beyond the manifest — the bridge (maintain/bridge/) is the one there is. Both parts
 * are optional, and both must be safe to run on any repository: a step that does not apply returns nothing.
 *   plan     before anything is written: extra planned actions (shown by a dry run, applied in their commit), and
 *            the entries the step looked at and deliberately left where they are;
 *   propose  commit 4: write gov's PROPOSALS into the org's documents, and say exactly what was written.
 */
export interface UpgradeExtension {
  readonly plan?: (adopterDir: string, contentDir: string, plan: UpgradePlan) => { readonly actions: readonly PlanAction[]; readonly leftInPlace: readonly LeftInPlace[] };
  readonly propose?: (adopterDir: string, contentDir: string) => { readonly substitutions: readonly Substitution[]; readonly proposed: readonly string[] };
}
