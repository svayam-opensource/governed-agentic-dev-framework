// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * TWO GOV-BUILTIN ACTIONS THAT ARE NOT OLD PREDICATES (W2-Q8, W2-Q10; W6 slice 2).
 *
 *   forbid-forced-push       GOV-FRM-466: no one force-pushes a branch others work on (default `BRNCH-*`).
 *   section-owner-approval   GOV-FRM-086c: a policy change merges only when the owner of every changed section
 *                            approves; unowned sections, ownership changes and policies/governance.yaml need the
 *                            Policy Owner; executable
 *                            actions (`policies/actions/**`) need the Check Owner. An ownership change is a row
 *                            added, removed, or re-pointed (doc, section, role) — a row's sha refreshed alone is
 *                            not one: the granting section's owner already approves that prose (ownership.ts).
 *
 * Pure over the event payload (read defensively, see payload.ts) and the injected RuleSet. Anything they needed
 * and did not get is `cannot-tell`.
 */
import { matchesAny } from "../glob.js";
import type { EventContext, RuleSet } from "../model/contracts.js";
import { asList, branchInScope, handleKey, payloadBoolean, payloadString, payloadStrings, payloadTextMap } from "./payload.js";
import { changedSections, compareSections } from "./sections.js";
import { OWNERSHIP_PATH, ownershipDiffers, parseOwnership } from "./ownership.js";
import { GOVERNANCE_PATH } from "../../config/governance.js";

export interface ActionOutcome {
  readonly verdict: "pass" | "miss" | "cannot-tell";
  readonly findings: readonly string[];
  /** Handles (no `@`) a pull request should request a review from. */
  readonly requestReview?: readonly string[];
}

const cannot = (findings: string[], requestReview?: string[]): ActionOutcome =>
  ({ verdict: "cannot-tell", findings, ...(requestReview ? { requestReview } : {}) });

/**
 * WHERE THE FROZEN SNAPSHOTS OF EARLIER POLICY VERSIONS LIVE: `policies/history/<x.y.z>/` — one per version.
 * The one name every writer and reader of the snapshots uses.
 *
 * It was `policies/version/` until the Policy Owner's ruling of 2026-10-07: beside the file `policies/VERSION`, that
 * folder is the SAME name on a case-insensitive disk (macOS APFS, Windows NTFS). A checkout can make only one of the
 * two, the other silently vanishes, and `git commit -a` then records it deleted.
 */
export const POLICY_HISTORY_DIR = "policies/history";

/**
 * Where the snapshots lived before 2026-10-07. Never written; read only so that the move to
 * {@link POLICY_HISTORY_DIR} (a MANIFEST `moves:` entry, or a pull request) is a rename, not an edit — and so that
 * a workspace not yet moved still keeps its snapshots out of the policy it judges.
 */
export const LEGACY_POLICY_HISTORY_DIR = "policies/version";

/**
 * THE FILES gov WRITES ON A POLICY PR — never a policy section, never an owner's approval (sandbox finding, PRJ-121,
 * 2026-10-07: `policies/CHANGELOG.md §1.0.1` was asked for an owner's approval as if a version heading were a
 * clause). `gov rules propose` writes all four; the policy-pr gate (GOV-FRM-467) judges them — rules.yaml's rows,
 * VERSION's bump, the changelog entry and the frozen snapshot. The snapshots' old folder is here too, so the pull
 * request that moves them to the new one asks nobody. An organization's own `ignore` list adds to these; it never
 * replaces them.
 */
export const MACHINE_WRITTEN_POLICY_PATHS = [
  "policies/CHANGELOG.md", "policies/VERSION", "policies/rules.yaml", `${POLICY_HISTORY_DIR}/**`, `${LEGACY_POLICY_HISTORY_DIR}/**`,
] as const;

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
  const ignore = [...MACHINE_WRITTEN_POLICY_PATHS, ...asList(params.ignore)];
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
    if (f.path === OWNERSHIP_PATH) {
      if (!baseTexts || !(f.path in baseTexts)) { notes.push(`${tag}: \`${f.path}\` at the base was not given, so whether who-owns-what changed is unknown.`); continue; }
      if (f.status !== "deleted" && f.text === null) { notes.push(`${tag}: \`${f.path}\` could not be read at the head, so whether who-owns-what changed is unknown.`); continue; }
      const was = parseOwnership(baseTexts[f.path] ?? "[]"), now = parseOwnership(f.status === "deleted" ? "[]" : f.text ?? "[]");
      // Unreadable on either side: nobody can tell what it hands to whom, so the Policy Owner looks.
      if ("error" in was || "error" in now || ownershipDiffers(was, now)) require(POLICY_OWNER, `\`${f.path}\` (who owns what)`);
      continue;
    }
    // THE GOVERNANCE CHOICES (org-config split): posture, the two owners, agents, publication, models. Any change
    // needs the Policy Owner — it is how anyone would otherwise make themselves an approver.
    if (f.path === GOVERNANCE_PATH) { require(POLICY_OWNER, `\`${f.path}\` (governance choices)`); continue; }
    if (matchesAny(f.path, ["policies/actions/**"])) { require(CHECK_OWNER, `\`${f.path}\` (executable action)`); continue; }
    if (!matchesAny(f.path, docs)) continue;
    if (!baseTexts || !(f.path in baseTexts)) { notes.push(`${tag}: \`${f.path}\` at the base was not given, so its changed sections are unknown.`); continue; }
    const base = baseTexts[f.path] ?? null;
    if (f.status !== "deleted" && f.text === null) { notes.push(`${tag}: \`${f.path}\` could not be read at the head, so its changed sections are unknown.`); continue; }
    const head = f.status === "deleted" ? null : f.text;
    for (const s of changedSections(base, head)) {
      require(ownerRole(rules, f.path, s) ?? POLICY_OWNER, s === "" ? `\`${f.path}\` text outside the numbered sections` : `\`${f.path}\` §${s}`);
    }
  }

  // THE AUTHOR IS NEVER AN APPROVER (Policy Owner, 2026-10-06). GitHub refuses an author's review of their own PR, so
  // listing them would make the check unpassable. If leaving them off leaves nobody, someone else must still review —
  // the Policy Owner, or the Check Owner when the author IS the Policy Owner — because nothing merges unreviewed.
  const author = payloadString(ctx, "author");
  if (author !== undefined && need.has(handleKey(author))) {
    const own = need.get(handleKey(author))!;
    need.delete(handleKey(author));
    if (!need.size) {
      const fallbacks = [policyOwner, roles[CHECK_OWNER]].filter((h): h is string => !!h && !!handleKey(h) && handleKey(h) !== handleKey(author));
      if (!fallbacks.length) {
        return { verdict: "miss", findings: [`${tag}: ${own.handle} changed ${own.why.sort(byWhy).join(", ")} and no one other than the author holds a role that can approve it. Name a second person as Policy Owner or Check Owner; until then this change is self-approved.`] };
      }
      const key = handleKey(fallbacks[0]);
      need.set(key, { handle: `@${key}`, why: own.why.map((w) => `${w} — its owner is the author, so the ${key === handleKey(policyOwner) ? POLICY_OWNER : CHECK_OWNER} approves instead`) });
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
