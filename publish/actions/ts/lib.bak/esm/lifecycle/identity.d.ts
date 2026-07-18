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
export declare function parseBoardUrl(url: string): BoardRef | null;
/**
 * Slugify a project title: lowercase, non-`[a-z0-9]` → `-`, collapse runs of `-`,
 * trim leading/trailing `-`. Byte-for-byte the behavior of lib.sh `slugify`.
 * A title with no ASCII alphanumerics slugifies to "" (rejected by the caller).
 */
export declare function slugify(title: string): string;
/** Compose the project id from a board number + slug. */
export declare function projectId(boardNumber: number, slug: string): string;
/** Derive a branch from an id: `PRJ-<rest>` → `BRNCH-<rest>`; legacy → lowercase. */
export declare function deriveBranch(pid: string): string;
/** The branch for an id, honoring a frozen legacy override before deriving. */
export declare function branchForId(pid: string, legacyBranches?: Readonly<Record<string, string>>): string;
/** A task sub-branch off a project branch: `<branch>.ISSUE-<n>`. */
export declare function taskBranch(branch: string, issueNumber: number): string;
/** The result of deriving a project's identity from its board URL + title. */
export type IdentityResult = {
    readonly ok: true;
    readonly board: BoardRef;
    readonly projectId: string;
    readonly branch: string;
    readonly slug: string;
} | {
    readonly ok: false;
    readonly reason: "bad-url";
    readonly url: string;
} | {
    readonly ok: false;
    readonly reason: "empty-slug";
    readonly title: string;
};
/**
 * Derive a project's full identity (board ref + id + branch) from its board URL
 * and title. Rejects an unparseable URL and a title that slugifies to empty.
 */
export declare function deriveProjectIdentity(input: {
    url: string;
    title: string;
    legacyBranches?: Readonly<Record<string, string>>;
}): IdentityResult;
