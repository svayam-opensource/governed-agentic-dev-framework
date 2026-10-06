// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * TWO GOV-BUILTIN ACTIONS THAT ARE NOT OLD PREDICATES (W2-Q8, W2-Q10; W6 slice 2).
 *
 *   forbid-forced-push       GOV-FRM-466: no one force-pushes a branch others work on (default `BRNCH-*`).
 *   section-owner-approval   GOV-FRM-086c: a policy change merges only when the owner of every changed section
 *                            approves; unowned sections and ownership changes need the Policy Owner; executable
 *                            actions (`policies/actions/**`) need the Check Owner.
 *
 * Pure over the event payload (read defensively, see payload.ts) and the injected RuleSet. Anything they needed
 * and did not get is `cannot-tell`.
 */
import { matchesAny } from "../glob.js";
import type { EventContext, RuleSet } from "../model/contracts.js";
import { asList, branchInScope, handleKey, payloadBoolean, payloadString, payloadStrings, payloadTextMap } from "./payload.js";
import { changedSections, compareSections } from "./sections.js";

export interface ActionOutcome {
  readonly verdict: "pass" | "miss" | "cannot-tell";
  readonly findings: readonly string[];
  /** Handles (no `@`) a pull request should request a review from. */
  readonly requestReview?: readonly string[];
}

const cannot = (findings: string[], requestReview?: string[]): ActionOutcome =>
  ({ verdict: "cannot-tell", findings, ...(requestReview ? { requestReview } : {}) });

export const POLICY_OWNER = "Policy Owner";
export const CHECK_OWNER = "Check Owner";

export function forbidForcedPush(tag: string, params: Readonly<Record<string, unknown>>, ctx: EventContext): ActionOutcome {
  const forced = payloadBoolean(ctx, "forced");
  const branch = payloadString(ctx, "branch");
  if (forced === undefined) return cannot([`${tag}: the push did not say whether it was forced, so nothing was checked.`]);
  if (branch === undefined) return cannot([`${tag}: the pushed branch is not known, so nothing was checked.`]);
  if (!forced) return { verdict: "pass", findings: [] };
  const patterns = asList(params.branches);
  const inScope = branchInScope(branch, patterns.length ? patterns : ["BRNCH-*"], payloadString(ctx, "defaultBranch"));
  if (inScope === null) return cannot([`${tag}: the default branch is not known, so \`$default\` could not be judged.`]);
  if (!inScope) return { verdict: "pass", findings: [] };
  return { verdict: "miss", findings: [`${tag}: \`${branch}\` was force-pushed. Others work on this branch — a force-push can destroy their commits. Restore the overwritten commits and push normally.`] };
}

/** The most specific ownership row for doc §section: §4.2.1 → 4.2.1, else 4.2, else 4. */
function ownerRole(rules: RuleSet, doc: string, section: string): string | undefined {
  const rows = (rules.ownership ?? []).filter((o) => o.doc === doc);
  for (let s = section; s !== ""; s = s.includes(".") ? s.slice(0, s.lastIndexOf(".")) : "") {
    const hit = rows.find((o) => o.section === s);
    if (hit) return hit.role;
  }
  return undefined;
}

export function sectionOwnerApproval(tag: string, params: Readonly<Record<string, unknown>>, ctx: EventContext, rules: RuleSet | undefined): ActionOutcome {
  if (!rules) return cannot([`${tag}: the rule set (ownership and roles) was not given, so nothing was checked.`]);
  const roles = rules.roles ?? {};
  const policyOwner = roles[POLICY_OWNER];
  if (!policyOwner || !handleKey(policyOwner)) return cannot([`${tag}: the Policy Owner has no handle, so nobody could be asked to approve.`]);
  const changed = ctx.payload.changed;
  if (!Array.isArray(changed)) return cannot([`${tag}: the event carried no changeset, so nothing was checked.`]);

  const docs = asList(params.docs).length ? asList(params.docs) : ["policies/**/*.md"];
  const ignore = asList(params.ignore).length ? asList(params.ignore) : ["policies/version/**"];
  const baseTexts = payloadTextMap(ctx, "baseTexts");

  /** handle key → { shown handle, what it must approve } */
  const need = new Map<string, { handle: string; why: string[] }>();
  const notes: string[] = [];
  const require = (role: string, why: string) => {
    let handle = roles[role];
    let label = role;
    if (!handle || !handleKey(handle)) { handle = policyOwner; label = `${role} — vacant, so the ${POLICY_OWNER}`; }
    const key = handleKey(handle);
    const entry = need.get(key) ?? { handle: `@${key}`, why: [] };
    entry.why.push(`${why} (${label})`);
    need.set(key, entry);
  };

  for (const f of changed) {
    if (matchesAny(f.path, ignore)) continue;
    if (f.path === "policies/ownership.yaml") { require(POLICY_OWNER, "`policies/ownership.yaml` (who owns what)"); continue; }
    if (matchesAny(f.path, ["policies/actions/**"])) { require(CHECK_OWNER, `\`${f.path}\` (executable action)`); continue; }
    if (!matchesAny(f.path, docs)) continue;
    if (!baseTexts || !(f.path in baseTexts)) { notes.push(`${tag}: \`${f.path}\` at the base was not given, so its changed sections are unknown.`); continue; }
    const base = baseTexts[f.path] ?? null;
    if (f.status !== "deleted" && f.text === null) { notes.push(`${tag}: \`${f.path}\` could not be read at the head, so its changed sections are unknown.`); continue; }
    const head = f.status === "deleted" ? null : f.text;
    for (const s of changedSections(base, head)) {
      require(ownerRole(rules, f.path, s) ?? POLICY_OWNER, s === "" ? `\`${f.path}\` preamble` : `\`${f.path}\` §${s}`);
    }
  }

  const requestReview = [...need.keys()].sort();
  if (notes.length) return cannot(notes, requestReview);
  if (!need.size) return { verdict: "pass", findings: [] };
  const approvals = payloadStrings(ctx, "approvals");
  if (approvals === undefined) {
    return cannot([`${tag}: the pull request's approvals were not given, so nothing was checked. Required: ${requestReview.map((h) => `@${h}`).join(", ")}.`], requestReview);
  }
  const approved = new Set(approvals.map(handleKey));
  const missing = requestReview.filter((h) => !approved.has(h));
  if (!missing.length) return { verdict: "pass", findings: [] };
  return {
    verdict: "miss",
    requestReview: missing,
    findings: missing.map((h) => {
      const e = need.get(h)!;
      return `${tag}: ${e.handle} has not approved this change to ${e.why.sort(byWhy).join(", ")}.`;
    }),
  };
}

/** Findings read in document order: by path, then section. */
const byWhy = (a: string, b: string): number => {
  const m = (s: string) => /^`([^`]*)`(?: §([\d.]+))?/.exec(s);
  const x = m(a), y = m(b);
  if (x && y && x[1] === y[1]) return compareSections(x[2] ?? "", y[2] ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
};
