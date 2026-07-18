/**
 * `task` — start a work-item sub-branch (SDD Part B, create-task). Pure parsing +
 * the per-repo create-or-resume sub-branch logic over the `Vcs` port. The full
 * orchestrator (issue validation via gh, repo-on-demand, looping the project's
 * repos, board updates) lands in a follow-up slice once project.yaml reading is
 * wired.
 *
 * Scheme B (POL-070): the sub-branch is keyed on the issue NUMBER(s):
 *   <project-branch>.ISSUE-<n>            (single)
 *   <project-branch>.ISSUE-<n1>-<n2>-...  (combined, sorted + de-duped)
 * The `.` separator (not `/`) is deliberate: git can't hold both `refs/heads/<x>`
 * and `refs/heads/<x>/<y>`, so `<branch>.ISSUE-…` avoids colliding with the
 * project branch while still globbing as `<branch>.*` at close.
 */
import type { Vcs } from "./vcs.js";
import type { Transaction } from "./transaction.js";
/** Extract the issue number + its repo URL from an issue URL, or null. */
export declare function parseIssueUrl(url: string): {
    number: number;
    repoUrl: string;
} | null;
/** The task sub-branch id: `<branch>.ISSUE-<sorted,deduped,'-'-joined numbers>`. */
export declare function taskIdFor(branch: string, issueNumbers: readonly number[]): string;
/** Strip any `.ISSUE-…` task suffix, yielding the project branch. */
export declare function projectBranchOf(branch: string): string;
/** The board number from a project branch (`BRNCH-<n>-…`), or null. */
export declare function boardNumberFromBranch(branch: string): number | null;
/**
 * Normalize a git remote URL to a comparable `owner/repo` tail (lowercased, no
 * scheme/host/`.git`/trailing slash) so `https://…/o/r` and `git@…:o/r.git`
 * compare equal (mirrors lib.sh normalize_repo_url).
 */
export declare function normalizeRepoUrl(url: string): string;
/** Parameters for creating one repo's sub-branch. */
export interface SubBranchParams {
    readonly repoDir: string;
    readonly projectBranch: string;
    readonly taskId: string;
    readonly label: string;
    readonly remote?: string;
}
export type SubBranchOutcome = "created" | "resumed";
/**
 * Create (or resume) the task sub-branch in one repo. If it already exists AND
 * points at the project branch base, it's a resumable no-op; if it exists but
 * diverges, throw (investigate). Otherwise check out the base, branch off, and
 * push — registering rollback (delete local + remote branch) on the Transaction.
 */
export declare function createSubBranch(deps: {
    vcs: Vcs;
    tx: Transaction;
}, p: SubBranchParams): SubBranchOutcome;
