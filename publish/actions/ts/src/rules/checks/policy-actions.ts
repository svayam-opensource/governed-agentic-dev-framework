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

/** Who must approve a policy change, and why (GOV-FRM-455). */
export interface RequiredSectionOwners {
  /** Each approver, as `@handle`, with what they must approve — e.g. "`policies/org-policy.md` §4 (Data Owner)". Sorted by handle. */
  readonly owners: readonly { readonly handle: string; readonly why: readonly string[] }[];
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
 * alternate (F143 A), and the posture (Q45 C: solo mode exists only under soft).
 */
export type SectionOwnersRules = Pick<RuleSet, "ownership" | "roles"> & Partial<Pick<RuleSet, "alternates" | "posture">>;

/**
 * THE WORDS A SOLO-MODE FINDING CARRIES (Q45 C). The push that finds a red merge reads them back from the check run's
 * annotations (gh-actions.ts {@link redMerges}): a failure that says this, and nothing else, is a self-merge to record
 * as evidence. Exported so the writer and the reader cannot drift.
 */
export const SELF_MERGED_SOLO = "self-merged: no second person";

/**
 * IS THIS SOLO MODE? (Q45 C) — nobody other than `author` is named in any role or as any alternate. A vacant role
 * names nobody. With no author given, solo means at most one person is named anywhere. Pure.
 */
export function soloMode(rules: SectionOwnersRules, author?: string): boolean {
  const a = author ? handleKey(author) : "";
  const named = new Set([...Object.values(rules.roles ?? {}), ...Object.values(rules.alternates ?? {})].map(handleKey).filter(Boolean));
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
 * (policies/policy-document.yaml, ruling F142 A), the Check Owner for
 * executable actions; never the author. Pure: the one place this is decided, so the check and a service showing the
 * approvers (gov-licence's practice record) cannot disagree. {@link sectionOwnerApproval} compares the result with
 * the approvals.
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
  const policyOwner = roles[POLICY_OWNER];
  if (!policyOwner || !handleKey(policyOwner)) return { owners: [], notes: [`${tag}: the Policy Owner has no handle, so nobody could be asked to approve.`] };

  const docs = options.docs?.length ? [...options.docs] : ["policies/**/*.md"];
  const ignore = [...MACHINE_WRITTEN_POLICY_PATHS, ...(options.ignore ?? [])];

  /** handle key → { shown handle, what it must approve } */
  const need = new Map<string, { handle: string; why: string[] }>();
  const notes: string[] = [];
  const alternates = rules.alternates ?? {};
  const authorKey = author ? handleKey(author) : "";
  const held = (h: string | undefined): h is string => !!h && !!handleKey(h);
  /** A role's alternate who can stand in: named, and not the author (F143 A). */
  const standIn = (role: string): string | undefined => {
    const a = alternates[role];
    return held(a) && handleKey(a) !== authorKey ? a : undefined;
  };
  const add = (handle: string, line: string) => {
    const key = handleKey(handle);
    const entry = need.get(key) ?? { handle: `@${key}`, why: [] };
    entry.why.push(line);
    need.set(key, entry);
  };
  // ROUTING (GOV-FRM-455; alternates, Policy Owner ruling F143 A, 2026-11-23). The role's holder approves — unless
  // the holder is the author, or the role is vacant: then its ALTERNATE, when one is named who is not the author.
  // Otherwise as before: a vacant role reads as the Policy Owner (and so takes the Policy Owner's alternate when the
  // Policy Owner is the author); a holder who is the author is handled after the loop.
  const require = (role: string, why: string) => {
    const holder = roles[role];
    const alt = standIn(role);
    if (!held(holder)) {
      if (alt) return add(alt, `${why} (${role}) — vacant, so its alternate approves`);
      const poAlt = handleKey(policyOwner) === authorKey ? standIn(POLICY_OWNER) : undefined;
      if (poAlt) return add(poAlt, `${why} (${role} — vacant, so the ${POLICY_OWNER}) — its owner is the author, so the ${POLICY_OWNER}'s alternate approves`);
      return add(policyOwner, `${why} (${role} — vacant, so the ${POLICY_OWNER})`);
    }
    if (authorKey && handleKey(holder) === authorKey && alt) return add(alt, `${why} (${role}) — its owner is the author, so its alternate approves`);
    return add(holder, `${why} (${role})`);
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

  // THE AUTHOR IS NEVER AN APPROVER (Policy Owner, 2026-10-06). GitHub refuses an author's review of their own PR, so
  // listing them would make the check unpassable. If leaving them off leaves nobody, someone else must still review —
  // the Policy Owner, or the Check Owner when the author IS the Policy Owner, each through their alternate when they
  // are the author themselves (F143 A) — because nothing merges unreviewed.
  if (authorKey && need.has(authorKey)) {
    const own = need.get(authorKey)!;
    need.delete(authorKey);
    if (!need.size) {
      const fallbacks: [string | undefined, string][] = [
        [policyOwner, `the ${POLICY_OWNER}`], [alternates[POLICY_OWNER], `the ${POLICY_OWNER}'s alternate`],
        [roles[CHECK_OWNER], `the ${CHECK_OWNER}`], [alternates[CHECK_OWNER], `the ${CHECK_OWNER}'s alternate`],
      ];
      const next = fallbacks.find(([h]) => held(h) && handleKey(h) !== authorKey);
      if (!next) {
        const changed = [...own.why].sort(byWhy).join(", ");
        // SOLO MODE (Q45 C): under soft posture, with nobody but the author named anywhere, say so in the words the
        // push reads back. Under hard posture — or with someone else named who simply cannot approve this — as before.
        if (rules.posture !== "hard" && soloMode(rules, author)) {
          return {
            owners: [], notes, solo: true,
            selfApprovedMiss: `${tag}: ${SELF_MERGED_SOLO} — ${own.handle} changed ${changed}, and no one other than the author holds any role or alternate (solo mode). Under soft posture a merge is recorded as a self-merge, not as a violation. Name a second person as a role holder or an alternate to end solo mode.`,
          };
        }
        return {
          owners: [], notes,
          selfApprovedMiss: `${tag}: ${own.handle} changed ${changed} and no one other than the author holds a role that can approve it. Name a second person as Policy Owner or Check Owner, or as an alternate; until then this change is self-approved.`,
        };
      }
      const key = handleKey(next[0]!);
      need.set(key, { handle: `@${key}`, why: own.why.map((w) => `${w} — its owner is the author, so ${next[1]} approves instead`) });
    }
  }

  const owners = [...need.keys()].sort().map((k) => { const e = need.get(k)!; return { handle: e.handle, why: [...e.why].sort(byWhy) }; });
  return { owners, notes };
}

export function sectionOwnerApproval(tag: string, params: Readonly<Record<string, unknown>>, ctx: EventContext, rules: RuleSet | undefined): ActionOutcome {
  if (!rules) return cannot([`${tag}: the rule set (ownership and roles) was not given, so nothing was checked.`]);
  const policyOwner = (rules.roles ?? {})[POLICY_OWNER];
  if (!policyOwner || !handleKey(policyOwner)) return cannot([`${tag}: the Policy Owner has no handle, so nobody could be asked to approve.`]);
  const changed = ctx.payload.changed;
  if (!Array.isArray(changed)) return cannot([`${tag}: the event carried no changeset, so nothing was checked.`]);

  const required = requiredSectionOwners(rules, changed, payloadTextMap(ctx, "baseTexts"), payloadString(ctx, "author"), {
    docs: asList(params.docs), ignore: asList(params.ignore), tag,
  });
  if (required.selfApprovedMiss) return { verdict: "miss", findings: [required.selfApprovedMiss], ...(required.solo ? { solo: true as const } : {}) };

  const need = new Map(required.owners.map((o) => [handleKey(o.handle), o]));
  const requestReview = [...need.keys()];
  if (required.notes.length) return cannot([...required.notes], requestReview);
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
      return `${tag}: ${e.handle} has not approved this change to ${e.why.join(", ")}.`;
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
