// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * TWO GOV-BUILTIN ACTIONS THAT ARE NOT OLD PREDICATES (W2-Q8, W2-Q10; W6 slice 2).
 *
 *   forbid-forced-push       GOV-FRM-466: no one force-pushes a branch others work on (default `BRNCH-*`).
 *   section-owner-approval   GOV-FRM-086c: a policy change merges only when the owner of every changed section
 *                            approves; unowned sections, ownership changes, policies/governance.yaml and the
 *                            policy's title page (policies/policy-document.yaml, F142 A) need the Policy Owner;
 *                            executable
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
import { POLICY_DOCUMENT_PATHS } from "../model/policy-document.js";

export interface ActionOutcome {
  readonly verdict: "pass" | "miss" | "cannot-tell";
  readonly findings: readonly string[];
  /** Handles (no `@`) a pull request should request a review from. */
  readonly requestReview?: readonly string[];
  /** A miss that is solo mode (Q45 C): its finding carries {@link SELF_MERGED_SOLO}. */
  readonly solo?: true;
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
  "policies/CHANGELOG.md", "policies/VERSION", "policies/rules/rules.yaml", `${POLICY_HISTORY_DIR}/**`, `${LEGACY_POLICY_HISTORY_DIR}/**`,
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
function ownerRole(rules: SectionOwnersRules, doc: string, section: string): string | undefined {
  const rows = (rules.ownership ?? []).filter((o) => o.doc === doc);
  for (let s = section; s !== ""; s = s.includes(".") ? s.slice(0, s.lastIndexOf(".")) : "") {
    const hit = rows.find((o) => o.section === s);
    if (hit) return hit.role;
  }
  return undefined;
}

/** One changed file, as {@link requiredSectionOwners} reads it: the path, how it changed, and its text at the head. */
export interface SectionOwnersFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  /** The whole file at the head, or null (deleted, or unreadable). */
  readonly text: string | null;
}

/**
 * One approval a policy change needs (GOV-FRM-455; F163 B): ONE approving review from anyone in {@link pool}.
 */
export interface RequiredApproval {
  /** The first of the pool, as `@handle` — the role's holder when they are in it. Kept for callers that show one name. */
  readonly handle: string;
  /**
   * EVERYONE WHO MAY GIVE THIS APPROVAL (Policy Owner ruling F163 B, 2026-11-25), as `@handle`s, never the author:
   * the approving role's holder and its alternates. One approval from any of them satisfies it.
   */
  readonly pool: readonly string[];
  /** What it approves — e.g. "`policies/org-policy.md` §4 (Data Owner)". */
  readonly why: readonly string[];
}

/** Who must approve a policy change, and why (GOV-FRM-455). */
export interface RequiredSectionOwners {
  /** Each approval needed, with who may give it and what it covers. Sorted by pool. */
  readonly owners: readonly RequiredApproval[];
  /** What could not be worked out (a base text not given, a head unreadable). Non-empty → the list may be short. */
  readonly notes: readonly string[];
  /** Set when the author is the only one who could approve: the change cannot be approved by anyone else. */
  readonly selfApprovedMiss?: string;
  /**
   * SOLO MODE (Policy Owner ruling Q45 C, 2026-11-23): set with {@link selfApprovedMiss} when, under soft posture,
   * nobody other than the author holds ANY role or alternate. Still a miss — nobody approves their own work — but
   * its finding carries {@link SELF_MERGED_SOLO}, so a merge past it is recorded as evidence, not as a violation.
   */
  readonly solo?: true;
}

/**
 * What {@link requiredSectionOwners} needs of the rule set: who owns which section, who holds each role, each role's
 * alternates (F143 A, F163 B), and the posture (Q45 C: solo mode exists only under soft).
 */
export type SectionOwnersRules = Pick<RuleSet, "ownership" | "roles"> & Partial<Pick<RuleSet, "alternates" | "posture">>;

/**
 * THE WORDS A SOLO-MODE FINDING CARRIES (Q45 C). The push that finds a red merge reads them back from the check run's
 * annotations (gh-actions.ts {@link redMerges}): a failure that says this, and nothing else, is a self-merge to record
 * as evidence. Exported so the writer and the reader cannot drift.
 */
export const SELF_MERGED_SOLO = "self-merged: no second person";

/**
 * A ROLE'S ALTERNATES, as written (F143 A, F163 B). A single string — a rule set built before F163 — reads as one
 * handle, or several when it names them comma- or space-separated. Never the empty string. Pure.
 */
export function alternatesOf(rules: Partial<Pick<RuleSet, "alternates">>, role: string): string[] {
  const v = rules.alternates?.[role];
  if (!v) return [];
  const list = typeof v === "string" ? v.split(/[\s,]+/) : [...v];
  return list.filter((h) => !!handleKey(h));
}

/**
 * THE ROLE'S APPROVER POOL (Policy Owner ruling F163 B, 2026-11-25): its holder plus its alternates, as `@handle`s,
 * once each, the holder first. A vacant holder leaves the alternates. The author is NOT removed here — the caller
 * does that, so it can tell "nobody named" from "only the author named". Pure.
 */
export function approverPool(rules: Pick<RuleSet, "roles"> & Partial<Pick<RuleSet, "alternates">>, role: string): string[] {
  const out: string[] = [];
  for (const h of [rules.roles?.[role] ?? "", ...alternatesOf(rules, role)]) {
    const key = handleKey(h);
    if (key && !out.includes(`@${key}`)) out.push(`@${key}`);
  }
  return out;
}

/** "@a" or "any of @a, @b" — how a finding and a review request name a pool. */
export const describePool = (pool: readonly string[]): string => (pool.length === 1 ? pool[0]! : `any of ${pool.join(", ")}`);

/**
 * IS THIS SOLO MODE? (Q45 C) — nobody other than `author` is named in any role or as any alternate. A vacant role
 * names nobody. With no author given, solo means at most one person is named anywhere. Pure.
 */
export function soloMode(rules: SectionOwnersRules, author?: string): boolean {
  const a = author ? handleKey(author) : "";
  const named = new Set([...Object.values(rules.roles ?? {}), ...Object.keys(rules.alternates ?? {}).flatMap((r) => alternatesOf(rules, r))].map(handleKey).filter(Boolean));
  if (a) named.delete(a);
  return a ? named.size === 0 : named.size <= 1;
}

export interface RequiredSectionOwnersOptions {
  /** Globs of the policy documents whose sections are owned. Default `policies/**\/*.md`. */
  readonly docs?: readonly string[];
  /** Paths no one need approve, added to {@link MACHINE_WRITTEN_POLICY_PATHS}. */
  readonly ignore?: readonly string[];
  /** What starts each note — the rule id, usually. Default `GOV-FRM-455`. */
  readonly tag?: string;
}

/**
 * WHO MUST APPROVE A POLICY CHANGE (GOV-FRM-455; Policy Owner ruling D3 A+, 2026-11-23) — the owner of every changed
 * section, the Policy Owner for unowned sections, ownership changes, governance.yaml and the policy's title page
 * (policies/policy-document.yaml, ruling F142 A), the Check Owner for executable actions; never the author.
 *
 * TWO PEOPLE (Policy Owner ruling F163 B, 2026-11-25): anyone may propose; each approval is ONE review from anyone in
 * the approving role's pool — its holder and its alternates — other than the author. A role whose pool is empty once
 * the author is taken out (vacant with no alternates, or only the author named) falls to the Policy Owner's pool,
 * then the Check Owner's, always without the author.
 *
 * Pure: the one place this is decided, so the check and a service showing the approvers (gov-licence's practice
 * record) cannot disagree. {@link sectionOwnerApproval} compares the result with the approvals.
 */
export function requiredSectionOwners(
  rules: SectionOwnersRules,
  changed: readonly SectionOwnersFile[],
  baseTexts: Readonly<Record<string, string | null>> | undefined,
  author: string | undefined,
  options: RequiredSectionOwnersOptions = {},
): RequiredSectionOwners {
  const tag = options.tag ?? "GOV-FRM-455";
  const roles = rules.roles ?? {};
  // A VACANT POLICY OWNER (Policy Owner ruling Q46 A, 2026-11-23): its alternates act as the Policy Owner for
  // routing — the fallback for every role with no one else to approve. With neither holder nor alternate, nobody.
  if (!actingPolicyOwner(rules)) return { owners: [], notes: [`${tag}: the Policy Owner has no handle (and no alternate), so nobody could be asked to approve.`] };

  const docs = options.docs?.length ? [...options.docs] : ["policies/**/*.md"];
  const ignore = [...MACHINE_WRITTEN_POLICY_PATHS, ...(options.ignore ?? [])];

  /** pool key → { pool, what it must approve } */
  const need = new Map<string, { pool: string[]; why: string[] }>();
  /** What only the author could approve: nobody else is in its role's pool or either fallback. */
  const authorOnly: { why: string; role: string }[] = [];
  const notes: string[] = [];
  const authorKey = author ? handleKey(author) : "";
  const eligible = (role: string): string[] => approverPool(rules, role).filter((h) => handleKey(h) !== authorKey);
  const add = (pool: string[], line: string) => {
    const key = pool.map(handleKey).sort().join(" ");
    const entry = need.get(key) ?? { pool, why: [] };
    entry.why.push(line);
    need.set(key, entry);
  };
  // ROUTING (GOV-FRM-455; F163 B). The role's pool approves, without the author. Empty → the Policy Owner's pool,
  // then the Check Owner's. Each line says which, so the review request explains itself.
  const require = (role: string, why: string) => {
    const named = approverPool(rules, role);
    const pool = eligible(role);
    const vacant = !handleKey(roles[role] ?? "");
    if (pool.length) {
      const note = vacant ? " — vacant, so its alternates approve"
        : authorKey && handleKey(roles[role]!) === authorKey ? " — its holder is the author, so its alternates approve" : "";
      return add(pool, `${why} (${role})${note}`);
    }
    const reason = named.length ? "its only approver is the author" : "vacant";
    for (const fallback of [POLICY_OWNER, CHECK_OWNER]) {
      if (fallback === role) continue;
      const p = eligible(fallback);
      if (p.length) return add(p, `${why} (${role} — ${reason}, so the ${fallback})`);
    }
    authorOnly.push({ why, role });
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
    // THE POLICY'S TITLE PAGE (Policy Owner ruling F142 A, 2026-11-23): its title, approved_by, the chapter
    // introductions and the glossary are the organization's word on the whole policy, owned by no one section.
    if (f.path === POLICY_DOCUMENT_PATHS.org) { require(POLICY_OWNER, `\`${f.path}\` (the policy's title page)`); continue; }
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

  // NOBODY BUT THE AUTHOR (Policy Owner, 2026-10-06; F163 B). What only the author could approve rides on the other
  // approvals when there are any — a second person still reviews the change. With none, nobody else can approve it:
  // say so, and say who to add.
  if (authorOnly.length && !need.size) {
    const changed = authorOnly.map((x) => x.why).sort(byWhy).join(", ");
    const who = `@${authorKey}`;
    // SOLO MODE (Q45 C): under soft posture, with nobody but the author named anywhere, say so in the words the
    // push reads back. Under hard posture — or with someone else named who simply cannot approve this — as before.
    if (rules.posture !== "hard" && soloMode(rules, author)) {
      return {
        owners: [], notes, solo: true,
        selfApprovedMiss: `${tag}: ${SELF_MERGED_SOLO} — ${who} changed ${changed}, and no one other than the author holds any role or alternate (solo mode). Under soft posture a merge is recorded as a self-merge, not as a violation. Name a second person as a role holder or an alternate to end solo mode.`,
      };
    }
    const lists = [...new Set(authorOnly.map((x) => x.role))].sort();
    return {
      owners: [], notes,
      selfApprovedMiss: `${tag}: ${who} changed ${changed}, and nobody but the author is on the approver list of ${lists.join(", ")}, the ${POLICY_OWNER} or the ${CHECK_OWNER}. Add a second person to one of them — for example \`policy_owner.alternate\` in ${GOVERNANCE_PATH}, or the Alternate column of the role list; until then this change is self-approved.`,
    };
  }

  const owners = [...need.keys()].sort().map((k) => {
    const e = need.get(k)!;
    return { handle: e.pool[0]!, pool: [...e.pool], why: [...e.why].sort(byWhy) };
  });
  return { owners, notes };
}

/**
 * WHO ACTS AS THE POLICY OWNER (Q46 A): its holder, or — while the role is vacant — its first alternate. Undefined
 * when neither is named: then nobody can be asked to approve anything. The one person a record is assigned to; for
 * who may APPROVE as the Policy Owner, see {@link approverPool}. Pure.
 */
export function actingPolicyOwner(rules: Pick<RuleSet, "roles"> & Partial<Pick<RuleSet, "alternates">>): string | undefined {
  const holder = rules.roles?.[POLICY_OWNER];
  if (holder && handleKey(holder)) return holder;
  return alternatesOf(rules, POLICY_OWNER)[0];
}

export function sectionOwnerApproval(tag: string, params: Readonly<Record<string, unknown>>, ctx: EventContext, rules: RuleSet | undefined): ActionOutcome {
  if (!rules) return cannot([`${tag}: the rule set (ownership and roles) was not given, so nothing was checked.`]);
  if (!actingPolicyOwner(rules)) return cannot([`${tag}: the Policy Owner has no handle (and no alternate), so nobody could be asked to approve.`]);
  const changed = ctx.payload.changed;
  if (!Array.isArray(changed)) return cannot([`${tag}: the event carried no changeset, so nothing was checked.`]);

  const required = requiredSectionOwners(rules, changed, payloadTextMap(ctx, "baseTexts"), payloadString(ctx, "author"), {
    docs: asList(params.docs), ignore: asList(params.ignore), tag,
  });
  if (required.selfApprovedMiss) return { verdict: "miss", findings: [required.selfApprovedMiss], ...(required.solo ? { solo: true as const } : {}) };

  const all = [...new Set(required.owners.flatMap((o) => o.pool.map(handleKey)))].sort();
  if (required.notes.length) return cannot([...required.notes], all);
  if (!required.owners.length) return { verdict: "pass", findings: [] };
  const approvals = payloadStrings(ctx, "approvals");
  if (approvals === undefined) {
    return cannot([`${tag}: the pull request's approvals were not given, so nothing was checked. Required: ${required.owners.map((o) => describePool(o.pool)).join("; ")}.`], all);
  }
  // ONE APPROVAL FROM ANYONE IN THE POOL (F163 B).
  const approved = new Set(approvals.map(handleKey));
  const missing = required.owners.filter((o) => !o.pool.some((h) => approved.has(handleKey(h))));
  if (!missing.length) return { verdict: "pass", findings: [] };
  return {
    verdict: "miss",
    requestReview: [...new Set(missing.flatMap((o) => o.pool.map(handleKey)))].sort(),
    findings: missing.map((o) => o.pool.length === 1
      ? `${tag}: ${o.handle} has not approved this change to ${o.why.join(", ")}.`
      : `${tag}: nobody from ${describePool(o.pool)} has approved this change to ${o.why.join(", ")} — one approval from any of them is enough.`),
  };
}

/** Findings read in document order: by path, then section. */
const byWhy = (a: string, b: string): number => {
  const m = (s: string) => /^`([^`]*)`(?: §([\d.]+))?/.exec(s);
  const x = m(a), y = m(b);
  if (x && y && x[1] === y[1]) return compareSections(x[2] ?? "", y[2] ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
};
