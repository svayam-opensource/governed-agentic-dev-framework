// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Project identity derivation (SDD Part B, `seed`) — pure string logic, no I/O.
 *
 * Board-number scheme (POL-069): both the project id and its branch are keyed on
 * the GitHub Project BOARD NUMBER (no leading zero); they differ only by a
 * constant prefix. The board number IS the allocator — no `last_issued` counter,
 * no registry write (registry-elimination). id/branch are fully derived from the
 * board number + title:
 *   id      PRJ-<board#>-<slug>
 *   branch  BRNCH-<board#>-<slug>        (task branches: <branch>.ISSUE-<n>)
 *
 * A frozen legacy registry may still override the branch for ids that predate the
 * scheme; that lookup is injected (a `legacyBranches` map), keeping this module
 * free of YAML/registry I/O.
 */

export type OwnerField = "organization" | "user";

/** A parsed GitHub Project board URL. */
export interface BoardRef {
  readonly owner: string;
  readonly ownerField: OwnerField;
  readonly number: number;
}

/**
 * Parse a GitHub Project board URL into {owner, ownerField, number}, or null if
 * it isn't a recognizable board URL. Mirrors seed.sh:
 *   /orgs/<owner>/projects/<n>   → organization
 *   /users/<owner>/projects/<n>  → user
 */
export function parseBoardUrl(url: string): BoardRef | null {
  const num = url.match(/\/projects\/(\d+)/);
  if (!num) return null;
  const number = Number(num[1]);
  const org = url.match(/\/orgs\/([^/]+)/);
  if (org) return { owner: org[1], ownerField: "organization", number };
  const user = url.match(/\/users\/([^/]+)/);
  if (user) return { owner: user[1], ownerField: "user", number };
  return null;
}

/**
 * A `PRJ-<n>` prefix gov itself put on the board title — stripped before slugifying.
 *
 * WHY THIS HAS TO EXIST BEFORE gov RENAMES ANYTHING. `deriveProjectIdentity` reads the LIVE
 * board title on every `gov work` (work-flow.ts, three call sites), not only at seed. So a board
 * renamed to `PRJ-26 · Invoice API` derived `PRJ-26-prj-26-invoice-api` on the next run, and the
 * project stopped matching its own directory and branch — invisible to the picker, though
 * `close` and `merge` kept working because those read the id from the branch.
 *
 * That made the rename unsafe and, worse, made a rename BY HAND unsafe too: anyone tidying a
 * board title to match the docs broke their own project.
 *
 * Matches both separators because gov writes ` · ` and a person tidying up writes `-`.
 */
const SELF_PREFIX = /^\s*PRJ-\d+\s*(?:·|-)\s*/i;

/**
 * The human part of a board title — what it said before gov prefixed it.
 *
 * Strips REPEATEDLY. One pass left `PRJ-7 · PRJ-26 · Odd` deriving
 * `PRJ-26-prj-26-odd`, which is the same defect the strip exists to prevent, just needing two
 * prefixes instead of one. It costs a loop, and it means no amount of hand-prefixing can break
 * a board.
 */
export function titleWithoutProjectPrefix(title: string): string {
  let t = title;
  for (let prev = ""; t !== prev;) { prev = t; t = t.replace(SELF_PREFIX, ""); }
  return t;
}

/**
 * The board title gov writes at seed: `PRJ-26 · Invoice API`.
 *
 * THE SEPARATOR IS DELIBERATE, and so is keeping the human half. The bare id would match the
 * docs exactly, and make a GitHub board list unreadable — a column of `PRJ-26-invoice-api`
 * entries is harder to scan than the words someone chose. The id answers "which project is this
 * in gov"; the title answers "what is it". Both fit.
 *
 * Idempotent: passing an already-prefixed title back returns the same string, because the human
 * part is recovered first.
 */
export function boardTitleFor(projectIdValue: string, currentTitle: string): string {
  const n = /^PRJ-(\d+)-/.exec(projectIdValue)?.[1];
  const human = titleWithoutProjectPrefix(currentTitle).trim();
  return n === undefined || human === "" ? currentTitle : `PRJ-${n} \u00b7 ${human}`;
}

/**
 * Slugify a project title: lowercase, non-`[a-z0-9]` → `-`, collapse runs of `-`,
 * trim leading/trailing `-`. Byte-for-byte the behavior of lib.sh `slugify`, except that a
 * `PRJ-<n>` prefix gov wrote is stripped first so the operation is idempotent.
 * A title with no ASCII alphanumerics slugifies to "" (rejected by the caller).
 */
export function slugify(title: string): string {
  return titleWithoutProjectPrefix(title)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Compose the project id from a board number + slug. */
export function projectId(boardNumber: number, slug: string): string {
  return `PRJ-${boardNumber}-${slug}`;
}

/** Derive a branch from an id: `PRJ-<rest>` → `BRNCH-<rest>`; legacy → lowercase. */
export function deriveBranch(pid: string): string {
  if (pid.startsWith("PRJ-")) return `BRNCH-${pid.slice("PRJ-".length)}`;
  return pid.toLowerCase();
}

/** The branch for an id, honoring a frozen legacy override before deriving. */
export function branchForId(
  pid: string,
  legacyBranches?: Readonly<Record<string, string>>,
): string {
  const legacy = legacyBranches?.[pid];
  return legacy && legacy !== "null" ? legacy : deriveBranch(pid);
}

/** A task sub-branch off a project branch: `<branch>.ISSUE-<n>`. */
export function taskBranch(branch: string, issueNumber: number): string {
  return `${branch}.ISSUE-${issueNumber}`;
}

/** The result of deriving a project's identity from its board URL + title. */
export type IdentityResult =
  | {
      readonly ok: true;
      readonly board: BoardRef;
      readonly projectId: string;
      readonly branch: string;
      readonly slug: string;
    }
  | { readonly ok: false; readonly reason: "bad-url"; readonly url: string }
  | { readonly ok: false; readonly reason: "empty-slug"; readonly title: string };

/**
 * Derive a project's full identity (board ref + id + branch) from its board URL
 * and title. Rejects an unparseable URL and a title that slugifies to empty.
 */
export function deriveProjectIdentity(input: {
  url: string;
  title: string;
  legacyBranches?: Readonly<Record<string, string>>;
}): IdentityResult {
  const board = parseBoardUrl(input.url);
  if (!board) return { ok: false, reason: "bad-url", url: input.url };
  const slug = slugify(input.title);
  if (!slug) return { ok: false, reason: "empty-slug", title: input.title };
  const pid = projectId(board.number, slug);
  return { ok: true, board, projectId: pid, branch: branchForId(pid, input.legacyBranches), slug };
}
