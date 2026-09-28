// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * POL NUMBERS ARE ALLOCATED ONCE AND LOCKED (rules-and-cues-design.md §3, step 3 of §10).
 *
 * A POL number MUST NOT be derived from position. Insert §4.1.3 and every number after it would move — and
 * POL-427 is cited in gov's own SOURCE CODE today, as well as in decisions, exception files, commit messages and
 * PR bodies. Renumbering does not break a build; it silently re-points a citation at a different rule, which is
 * worse, because the citation still resolves and now says something else.
 *
 * So: an append-only map of clause identity → number. A number is assigned once, **never reused and never
 * renumbered**. Retiring a clause keeps its entry and marks it `retired`, so a five-year-old citation still
 * resolves to the rule that was meant.
 *
 * AND IT NEVER GUESSES. When a clause cannot be matched exactly the compiler STOPS AND ASKS — *"§4.2 looks like
 * POL-210 reworded — confirm, or allocate a new number"*. The two silent alternatives are both wrong in a way
 * nobody would notice for months: reuse the number and a reworded clause inherits an approval it never had;
 * allocate a new one and every existing citation of POL-210 now points at a retired rule while the live clause
 * has a number nothing cites.
 *
 * This module is PURE over a PARSED lock object. Reading and writing `policies/.pol-lock.yaml` is the caller's;
 * nothing here touches disk, so the matching rules can be tested exhaustively without a fixture tree.
 */
import type { Level } from "./notation.js";

/** What identifies a clause for locking purposes: where it is, and what it says. */
export interface ClauseIdentity {
  /** Workspace-relative document path, e.g. `policies/approved-technologies.md`. */
  readonly doc: string;
  /** The numbered section, e.g. `4.2`. */
  readonly section: string;
  /**
   * Which clause within that section, 1-based — and the field that makes the lock CONVERGE.
   *
   * Without it, identity was (doc, section, sha), and "same section, different sha" meant *reworded*. A section
   * with four clauses then had four entries sharing one (doc, section), so clause 2 matched clause 1's entry and
   * asked "is §2.1 a rewording of POL-011?" — forever. Confirming it only moved the collision to the next
   * clause: a build that succeeded was followed by a `check` that asked again, with a different set each time.
   * Found by running it rather than by reading it, which is the argument for running it.
   *
   * OPTIONAL, because entries written before this field existed do not carry one; a missing ordinal matches any,
   * which keeps an older lock readable instead of re-asking every question in it.
   */
  readonly ordinal?: number;
  /** Short hash of the clause's normalised text — see `clauseSha` in `cue-block.ts`. */
  readonly clauseSha: string;
}

export interface PolEntry extends ClauseIdentity {
  /** The citation form, exactly as it appears in prose and in source code: `POL-210`. */
  readonly pol: string;
  /** The level at the time of allocation, when the caller knows it. Advisory: the clause is the authority. */
  readonly level?: Level;
  /** Retired clauses KEEP their entry and their number, so old citations still resolve (§3). */
  readonly retired?: boolean;
  /**
   * The identities this number has had before, oldest first. A confirmed rewording changes what the entry
   * points at; without this, the sha that was approved in PR #214 would be gone, and an incident a year later
   * could not establish which text the number was allocated for.
   */
  readonly history?: readonly ClauseIdentity[];
}

/**
 * A parsed `.pol-lock.yaml`. `start` is the first number this lock may allocate — THE RANGE IS DATA, not a
 * branch in here: the framework's lock and an org's lock differ only by that number, and a compiler that knew
 * about "the framework range" and "the org range" would need a third case the first time anyone ships a second
 * framework-level document set.
 */
export interface PolLock {
  readonly start: number;
  readonly entries: readonly PolEntry[];
}

/** The framework's own clauses start at 1 (POL-001…). A default for the CALLER to pass, not a rule in here. */
export const FRAMEWORK_POL_START = 1;
/** An adopting organization's clauses start at 200, leaving the low numbers to the framework. */
export const ORG_POL_START = 200;

export const emptyLock = (start: number): PolLock => ({ start, entries: [] });

/**
 * `POL-210`. Padded to three digits because every citation that exists today is (`POL-086b`, `POL-402`), and a
 * lock that started emitting `POL-1` would make the framework's own numbers un-greppable against its history.
 */
export const formatPol = (n: number): string => `POL-${String(n).padStart(3, "0")}`;

/**
 * The number inside a citation. Tolerates a letter suffix (`POL-086b` → 86): those exist in the hand-assigned
 * era this lockfile replaces, and the allocator must count them when it looks for the maximum even though it
 * will never mint one.
 */
export const polNumber = (pol: string): number => {
  const m = /(\d+)/.exec(pol);
  return m ? Number(m[1]) : 0;
};

export type AllocateAction = "reused" | "allocated" | "ask";

/** Why the compiler is asking instead of deciding. Each one is a different question to a person. */
export type AskReason =
  /** Same document and section, different text: probably a rewording of this number. */
  | "reworded"
  /** The same text, somewhere else: probably this number, moved. */
  | "moved"
  /** Exactly the identity of a RETIRED number: a resurrection needs a person, never a compiler. */
  | "retired";

export interface Allocation {
  /** The lock as it should now be written. Unchanged for `reused` and for `ask`. */
  readonly lock: PolLock;
  /** The number to use, or null when the answer is a question (`ask`). */
  readonly pol: string | null;
  readonly action: AllocateAction;
  /** On `ask`: the entry that looks like a match, so the caller can name it in the question. */
  readonly candidate?: PolEntry;
  readonly reason?: AskReason;
}

const same = (a: ClauseIdentity, b: ClauseIdentity): boolean =>
  a.doc === b.doc && a.section === b.section && a.clauseSha === b.clauseSha;

/** Next = max allocated + 1, counting RETIRED entries, so a retired number is never handed out again. */
export function nextNumber(lock: PolLock): number {
  const max = lock.entries.reduce((n, e) => Math.max(n, polNumber(e.pol)), 0);
  return Math.max(lock.start, max + 1);
}

const append = (lock: PolLock, id: ClauseIdentity, level?: Level): Allocation => {
  const pol = formatPol(nextNumber(lock));
  const entry: PolEntry = { pol, ...id, ...(level ? { level } : {}) };
  return { lock: { ...lock, entries: [...lock.entries, entry] }, pol, action: "allocated" };
};

/**
 * Give this clause its number: the one it already has, a new one, or a question.
 *
 * - **exact identity match** (doc + section + sha), not retired → `reused`, lock untouched.
 * - **same doc and section, different sha** → `ask` (`reworded`). The clause was edited; whether that is the
 *   same rule is a governance judgement, and a hash cannot make it.
 * - **same sha, different doc or section** → `ask` (`moved`). §3 names this case explicitly.
 * - **exactly a retired entry's identity** → `ask` (`retired`). A clause coming back verbatim is plausible and
 *   is still a decision: silently un-retiring a number would resurrect a rule nobody ratified.
 * - **nothing resembling it** → `allocated`, appended at max + 1.
 *
 * The lock is returned rather than mutated: the caller writes it once, after every clause has been placed, so a
 * compile that stops at an `ask` leaves `.pol-lock.yaml` exactly as it found it.
 */
export function allocate(lock: PolLock, id: ClauseIdentity, level?: Level, declared?: string): Allocation {
  const exact = lock.entries.find((e) => same(e, id));
  if (exact) {
    return exact.retired
      ? { lock, pol: null, action: "ask", candidate: exact, reason: "retired" }
      : { lock, pol: exact.pol, action: "reused" };
  }
  // Reworded is checked before moved: an author editing §4.2 in place is the common case by a wide margin, and
  // when both readings are available it is the one whose question a person can answer from what is on screen.
  // Position within the section is part of identity now, so a second clause in §2.1 is not mistaken for a
  // rewording of the first. An entry with no ordinal (written before the field existed) still matches, so an
  // older lock is read rather than re-interrogated.
  const reworded = lock.entries.find((e) =>
    !e.retired && e.doc === id.doc && e.section === id.section
    && (e.ordinal === undefined || id.ordinal === undefined || e.ordinal === id.ordinal));
  if (reworded) return { lock, pol: null, action: "ask", candidate: reworded, reason: "reworded" };

  const moved = lock.entries.find((e) => !e.retired && e.clauseSha === id.clauseSha);
  if (moved) return { lock, pol: null, action: "ask", candidate: moved, reason: "moved" };

  // A NUMBER THE CLAUSE ALREADY DECLARES IS THE NUMBER, not a suggestion.
  //
  // Without this, `build` invented a fresh number for every clause the framework ships: the document said
  // POL-009c and the lock recorded POL-185 for the same sentence. In the publisher's repo that is a confusing
  // diff; in an ADOPTER's workspace it would renumber all 180-odd shipped clauses on their first build, and
  // every citation anyone had ever written — including the ones in gov's own source — would point somewhere else.
  //
  // A declared number already held by a DIFFERENT clause is not adoptable: either the author reused a number, or
  // this is a rewording the lock could not match. Both are decisions, so both ask.
  if (declared) {
    const held = lock.entries.find((e) => e.pol === declared);
    if (held) return { lock, pol: null, action: "ask", candidate: held, reason: "reworded" };
    const entry: PolEntry = { ...id, pol: declared, ...(level ? { level } : {}) };
    return { lock: { ...lock, entries: [...lock.entries, entry] }, pol: declared, action: "allocated" };
  }

  return append(lock, id, level);
}

/**
 * The person said "yes, that is POL-210 reworded". The number stays; what it points at is updated and the old
 * identity is kept in `history`. A retired entry confirmed this way comes back un-retired — that is what the
 * person just decided.
 */
export function confirmMatch(lock: PolLock, pol: string, id: ClauseIdentity, level?: Level): PolLock {
  return {
    ...lock,
    entries: lock.entries.map((e) => {
      if (e.pol !== pol) return e;
      const prior: ClauseIdentity = { doc: e.doc, section: e.section, clauseSha: e.clauseSha };
      const entry: PolEntry = {
        ...e, ...id, ...(level ? { level } : {}),
        history: [...(e.history ?? []), prior],
      };
      // `retired: false` rather than deleting the key, so a lock file shows that a retirement was reversed.
      return e.retired ? { ...entry, retired: false } : entry;
    }),
  };
}

/** The person said "no, that is a new rule". Appends, exactly as a first sighting would have. */
export const allocateNew = (lock: PolLock, id: ClauseIdentity, level?: Level): Allocation => append(lock, id, level);

/**
 * Retire a number. The entry STAYS — that is the whole mechanism: `gov knowledge` can still answer what POL-210
 * was when a two-year-old decision cites it, and `nextNumber` still counts it, so nothing is ever handed the
 * same number twice.
 */
export const retire = (lock: PolLock, pol: string): PolLock => ({
  ...lock,
  entries: lock.entries.map((e) => (e.pol === pol ? { ...e, retired: true } : e)),
});

/** The question §3 specifies, verbatim in shape: what it looks like, and the two answers there are. */
export function formatAsk(id: ClauseIdentity, a: Allocation): string {
  const c = a.candidate;
  if (a.action !== "ask" || !c) return "";
  const what = {
    reworded: `§${id.section} looks like ${c.pol} reworded`,
    moved: `§${id.section} looks like ${c.pol} moved from §${c.section}${c.doc === id.doc ? "" : ` in ${c.doc}`}`,
    retired: `§${id.section} is ${c.pol}, which is retired`,
  }[a.reason ?? "reworded"];
  return `${id.doc}: ${what} — confirm, or allocate a new number.`;
}
