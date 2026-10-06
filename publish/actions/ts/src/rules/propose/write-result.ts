// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A SETTLED PROPOSAL, WRITTEN — and the policy pull request finished around it (P1 "Propose trigger"; P3 wave 2).
 *
 *   rows      → policies/rules.yaml       (the whole org store; its header comment kept)
 *   ownership → policies/ownership.yaml   (deterministic: sorted, one flow mapping per row, header kept)
 *   then      planPolicyPr → bumpVersion → writeSnapshot → stampRows → writeChangelogEntry
 *
 * ONE IMPLEMENTATION, TWO TRIGGERS: `gov rules propose` at a terminal and the `gov-builtin/rules-propose` action on
 * a policy pull request both call this. Every step skips when its work is already done, so a second run writes
 * nothing. The changelog entry is built from the TREES (what the change adds, revises and retires against the
 * base, and the Q&A those rows carry) — never from one run's memory, so a run that found nothing new to ask
 * still writes the entry an earlier run could not (it had no pull request number yet).
 *
 * Pure over the injected trees.
 */
import yaml from "js-yaml";
import { inForce, parseRuleStore, type RuleRow } from "../model/rule-row.js";
import type { SectionOwnership } from "../model/contracts.js";
import { OWNERSHIP_PATH, parseOwnership } from "../checks/ownership.js";
import { compareSections, sectionShas } from "../checks/sections.js";
import { changedPolicySections, changelogEntry, planPolicyPr, policyDocPaths, POLICY_PR_PATHS, type PolicyPrPlan, type RuleChanges } from "../policy-pr/gate.js";
import { parseReviewedLines, reviewKey, sortReviews, type ReviewedChange, type SectionReview } from "../policy-pr/reviewed.js";
import { dumpStore, policyPrWriter, type ChangelogEntry } from "../policy-pr/write.js";
import type { TreeReader, TreeWriter } from "../policy-pr/tree.js";

/** The header a file starts with: its leading comment and blank lines. */
function headerOf(text: string | null): string {
  const out: string[] = [];
  for (const line of (text ?? "").split("\n")) {
    if (line.startsWith("#") || line.trim() === "") out.push(line);
    else break;
  }
  while (out.length && out[out.length - 1]!.trim() === "") out.pop();
  return out.join("\n");
}

const q = (s: string): string => JSON.stringify(s);

/** Ownership rows as YAML, the same bytes for the same rows whatever order they came in. */
export function dumpOwnership(previous: string | null, rows: readonly SectionOwnership[]): string {
  const sorted = [...rows].sort((a, b) => a.doc.localeCompare(b.doc) || compareSections(a.section, b.section) || a.role.localeCompare(b.role));
  const body = sorted.length
    ? sorted.map((o) => `- { doc: ${q(o.doc)}, section: ${q(o.section)}, role: ${q(o.role)}, sha: ${q(o.sha)} }`).join("\n") + "\n"
    : "[]\n";
  const header = headerOf(previous);
  return header ? `${header}\n${body}` : body;
}

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, x[k]])) : x));

/** Write the rows and the ownership table; each file only when its CONTENT differs. Returns what was written. */
export function writeProposal(head: TreeWriter, r: { readonly rows: readonly RuleRow[]; readonly ownership: readonly SectionOwnership[] }): string[] {
  const wrote: string[] = [];
  const rulesText = head.read(POLICY_PR_PATHS.rules);
  let currentRows: unknown = null;
  try { currentRows = rulesText === null ? null : parseRuleStore(rulesText); } catch { /* unparseable: rewritten below */ }
  if (canon(currentRows) !== canon(r.rows)) {
    head.write(POLICY_PR_PATHS.rules, rulesText === null ? yaml.dump(JSON.parse(JSON.stringify(r.rows)), { lineWidth: -1, noRefs: true }) : dumpStore(rulesText, r.rows));
    wrote.push(POLICY_PR_PATHS.rules);
  }
  const ownText = head.read(OWNERSHIP_PATH);
  const current = parseOwnership(ownText ?? "[]");
  const key = (o: readonly SectionOwnership[]) => canon([...o].map((x) => ({ doc: x.doc, section: x.section, role: x.role, sha: x.sha })).sort((a, b) => canon(a).localeCompare(canon(b))));
  if ("error" in current || key(current) !== key(r.ownership)) {
    head.write(OWNERSHIP_PATH, dumpOwnership(ownText, r.ownership));
    wrote.push(OWNERSHIP_PATH);
  }
  return wrote;
}

export interface FinishInput {
  readonly base: TreeReader;
  readonly head: TreeWriter;
  /** The pull request. Absent → version and snapshot only; stamps and the changelog wait for it. */
  readonly pr?: number;
  /** YYYY-MM-DD the rows are stamped with — the date of the commit that will carry them. */
  readonly today: string;
  /** The pull request's author (GitHub handle). */
  readonly author: string;
  /** What THIS run of propose settled, section by section (runPropose's `reviewed`). Absent: a run that read nothing. */
  readonly reviewed?: readonly SectionReview[];
}

export interface FinishResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
  /** What was written, by path (repo-relative). */
  readonly wrote: readonly string[];
  readonly plan?: PolicyPrPlan;
  readonly version?: string;
}

/** planPolicyPr → bumpVersion → writeSnapshot → stampRows → writeChangelogEntry, each skipping when done. */
export function finishPolicyChange(i: FinishInput): FinishResult {
  const plan = planPolicyPr(i.base, i.head);
  if ("unreadable" in plan) return { ok: false, lines: [`  ${plan.unreadable} — nothing was bumped.`], wrote: [] };
  if (plan.required === "none") return { ok: true, lines: ["  policies/ is unchanged against the default branch — no version bump."], wrote: [], plan, version: plan.baseVersion };

  const touched = new Set<string>();
  const tracking: TreeWriter = {
    ...i.head,
    write: (f, t) => { touched.add(f); i.head.write(f, t); },
    remove: (f) => { touched.add(f); i.head.remove(f); },
  };
  const w = policyPrWriter({ base: i.base, head: tracking });
  const lines: string[] = [];
  const say = (r: { wrote: boolean; detail: string }) => lines.push(`  ${r.wrote ? "wrote" : "kept "} ${r.detail}`);

  const bump = w.bumpVersion(plan.required);
  say(bump);
  say(w.writeSnapshot(plan.baseVersion));
  if (i.pr === undefined) {
    lines.push("  no pull request yet: the rows' stamps and the CHANGELOG entry need its number. Open it, then run",
      "  `gov rules propose --pr <n>` (no model is asked again — the rows are settled), or let the policy PR check do it.");
    return { ok: true, lines, wrote: [...touched], plan, version: bump.version };
  }
  say(w.stampRows(bump.version, i.today, i.pr));

  // What the change does, read back from the trees after stamping.
  const after = planPolicyPr(i.base, tracking);
  const changes = "unreadable" in after ? plan.changes : after.changes;
  const text = tracking.read(POLICY_PR_PATHS.rules);
  const rows: RuleRow[] = text === null ? [] : parseRuleStore(text);
  const open = new Map(inForce(rows).map((r) => [r.id, r]));
  const latest = (id: string): RuleRow | undefined => open.get(id) ?? [...rows].reverse().find((r) => r.id === id);
  const rules: ChangelogEntry["rules"][number][] = [];
  for (const [ids, change] of [[changes.added, "added"], [changes.revised, "revised"], [changes.retired, "retired"]] as const) {
    for (const id of ids) rules.push({ id, change, expectation: latest(id)?.expectation ?? "" });
  }
  const qa: { q: string; a: string }[] = [];
  for (const r of rules) for (const x of open.get(r.id)?.qa ?? []) if (!qa.some((y) => y.q === x.q && y.a === x.a)) qa.push({ q: x.q, a: x.a });
  const governance = "unreadable" in after ? plan.governance : after.governance;
  const reviewed = sectionsReviewed(i.base, tracking, bump.version, rows, changes, i.reviewed ?? []);
  say(w.writeChangelogEntry({ version: bump.version, date: i.today, pr: i.pr, author: i.author, approver: null, rules, qa, ...(governance.length ? { governance } : {}), ...(reviewed.length ? { reviewed } : {}) }));
  return { ok: true, lines, wrote: [...touched], plan, version: bump.version };
}

/**
 * THE ENTRY'S "Sections reviewed" — built from the TREES plus what this run settled, never from one run's memory alone:
 *
 *   this run's outcomes ......................... as settled (a section with no rule says so: only a run can know)
 *   an earlier run of this PR, same section sha .. kept from the entry it wrote (a later run must not drop it)
 *   a changed section whose head rows cite its new sha
 *                                                 derived: each row added, revised or kept (propose wrote them)
 *   a section the change removed ................ derived: removed, with the rules that retired
 *
 * A line for a section whose sha has moved since is dropped, so the gate demands that section again.
 */
function sectionsReviewed(
  base: TreeReader, head: TreeReader, version: string, rows: readonly RuleRow[], changes: RuleChanges, run: readonly SectionReview[],
): SectionReview[] {
  const shaNow = new Map<string, Map<string, string>>();
  const shaOf = (doc: string, section: string): string | undefined => {
    if (!shaNow.has(doc)) { const t = head.read(doc); shaNow.set(doc, t === null ? new Map() : sectionShas(t)); }
    return shaNow.get(doc)!.get(section);
  };
  const out = new Map<string, SectionReview>();
  const current = (r: SectionReview): boolean => r.sha !== null && shaOf(r.doc, r.section) === r.sha;

  const log = head.read(POLICY_PR_PATHS.changelog);
  const earlier = log === null ? null : changelogEntry(log, version);
  for (const r of earlier === null ? [] : parseReviewedLines(earlier)) if (current(r)) out.set(reviewKey(r), r);
  for (const r of run) if (current(r)) out.set(reviewKey(r), r);

  const change = (id: string): ReviewedChange =>
    changes.added.includes(id) ? "added" : changes.revised.includes(id) ? "revised" : "kept";
  const open = inForce(rows);
  for (const c of changedPolicySections(base, head) ?? []) {
    if (out.has(reviewKey(c))) continue;
    const cite = [...new Set(open.filter((r) => r.source.doc === c.doc && r.source.section === c.section && r.source.sha === c.sha).map((r) => r.id))];
    if (cite.length) out.set(reviewKey(c), { ...c, outcome: { kind: "rules", rules: cite.map((id) => ({ id, change: change(id) })) } });
  }

  const baseText = base.read(POLICY_PR_PATHS.rules);
  let baseOpen: RuleRow[] = [];
  try { baseOpen = baseText === null ? [] : inForce(parseRuleStore(baseText)); } catch { /* the gate reports an unparseable base store */ }
  for (const doc of policyDocPaths(base) ?? []) {
    const was = base.read(doc);
    if (was === null) continue;
    const now = head.read(doc);
    const present = now === null ? new Set<string>() : new Set(sectionShas(now).keys());
    for (const section of sectionShas(was).keys()) {
      if (section === "" || present.has(section)) continue;
      const retired = [...new Set(baseOpen.filter((r) => r.source.doc === doc && r.source.section === section && changes.retired.includes(r.id)).map((r) => r.id))];
      out.set(reviewKey({ doc, section }), { doc, section, sha: null, outcome: { kind: "removed", retired } });
    }
  }
  return sortReviews(out.values());
}
