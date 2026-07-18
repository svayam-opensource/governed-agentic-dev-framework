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
/**
 * Parse a GitHub Project board URL into {owner, ownerField, number}, or null if
 * it isn't a recognizable board URL. Mirrors seed.sh:
 *   /orgs/<owner>/projects/<n>   → organization
 *   /users/<owner>/projects/<n>  → user
 */
export function parseBoardUrl(url) {
    const num = url.match(/\/projects\/(\d+)/);
    if (!num)
        return null;
    const number = Number(num[1]);
    const org = url.match(/\/orgs\/([^/]+)/);
    if (org)
        return { owner: org[1], ownerField: "organization", number };
    const user = url.match(/\/users\/([^/]+)/);
    if (user)
        return { owner: user[1], ownerField: "user", number };
    return null;
}
/**
 * Slugify a project title: lowercase, non-`[a-z0-9]` → `-`, collapse runs of `-`,
 * trim leading/trailing `-`. Byte-for-byte the behavior of lib.sh `slugify`.
 * A title with no ASCII alphanumerics slugifies to "" (rejected by the caller).
 */
export function slugify(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}
/** Compose the project id from a board number + slug. */
export function projectId(boardNumber, slug) {
    return `PRJ-${boardNumber}-${slug}`;
}
/** Derive a branch from an id: `PRJ-<rest>` → `BRNCH-<rest>`; legacy → lowercase. */
export function deriveBranch(pid) {
    if (pid.startsWith("PRJ-"))
        return `BRNCH-${pid.slice("PRJ-".length)}`;
    return pid.toLowerCase();
}
/** The branch for an id, honoring a frozen legacy override before deriving. */
export function branchForId(pid, legacyBranches) {
    const legacy = legacyBranches?.[pid];
    return legacy && legacy !== "null" ? legacy : deriveBranch(pid);
}
/** A task sub-branch off a project branch: `<branch>.ISSUE-<n>`. */
export function taskBranch(branch, issueNumber) {
    return `${branch}.ISSUE-${issueNumber}`;
}
/**
 * Derive a project's full identity (board ref + id + branch) from its board URL
 * and title. Rejects an unparseable URL and a title that slugifies to empty.
 */
export function deriveProjectIdentity(input) {
    const board = parseBoardUrl(input.url);
    if (!board)
        return { ok: false, reason: "bad-url", url: input.url };
    const slug = slugify(input.title);
    if (!slug)
        return { ok: false, reason: "empty-slug", title: input.title };
    const pid = projectId(board.number, slug);
    return { ok: true, board, projectId: pid, branch: branchForId(pid, input.legacyBranches), slug };
}
