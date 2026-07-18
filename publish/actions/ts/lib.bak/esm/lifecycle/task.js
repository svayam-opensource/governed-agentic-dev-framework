/** Extract the issue number + its repo URL from an issue URL, or null. */
export function parseIssueUrl(url) {
    const m = url.match(/\/issues\/(\d+)/);
    if (!m)
        return null;
    return { number: Number(m[1]), repoUrl: url.replace(/\/issues\/\d+.*$/, "") };
}
/** The task sub-branch id: `<branch>.ISSUE-<sorted,deduped,'-'-joined numbers>`. */
export function taskIdFor(branch, issueNumbers) {
    const suffix = [...new Set(issueNumbers)].sort((a, b) => a - b).join("-");
    return `${branch}.ISSUE-${suffix}`;
}
/** Strip any `.ISSUE-…` task suffix, yielding the project branch. */
export function projectBranchOf(branch) {
    return branch.split(".ISSUE-")[0];
}
/** The board number from a project branch (`BRNCH-<n>-…`), or null. */
export function boardNumberFromBranch(branch) {
    const m = projectBranchOf(branch).match(/^brnch-(\d+)-/i);
    return m ? Number(m[1]) : null;
}
/**
 * Normalize a git remote URL to a comparable `owner/repo` tail (lowercased, no
 * scheme/host/`.git`/trailing slash) so `https://…/o/r` and `git@…:o/r.git`
 * compare equal (mirrors lib.sh normalize_repo_url).
 */
export function normalizeRepoUrl(url) {
    const u = url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
    const m = u.match(/[:/]([^/:]+)\/([^/]+)$/);
    return m ? `${m[1]}/${m[2]}` : u;
}
/**
 * Create (or resume) the task sub-branch in one repo. If it already exists AND
 * points at the project branch base, it's a resumable no-op; if it exists but
 * diverges, throw (investigate). Otherwise check out the base, branch off, and
 * push — registering rollback (delete local + remote branch) on the Transaction.
 */
export function createSubBranch(deps, p) {
    const remote = p.remote ?? "origin";
    deps.vcs.fetch(p.repoDir, remote, p.projectBranch); // best-effort
    if (deps.vcs.localBranchExists(p.repoDir, p.taskId)) {
        const taskSha = deps.vcs.revParse(p.repoDir, p.taskId);
        const baseSha = deps.vcs.revParse(p.repoDir, `${remote}/${p.projectBranch}`) ??
            deps.vcs.revParse(p.repoDir, p.projectBranch);
        if (taskSha !== null && taskSha === baseSha)
            return "resumed";
        throw new Error(`Sub-branch '${p.taskId}' already exists in ${p.label} and diverges from '${p.projectBranch}' — investigate.`);
    }
    deps.vcs.checkout(p.repoDir, p.projectBranch);
    deps.tx.step(`local branch ${p.repoDir}`, () => deps.vcs.checkoutNew(p.repoDir, p.taskId), () => {
        deps.vcs.checkout(p.repoDir, p.projectBranch); // switch off before delete
        deps.vcs.branchDelete(p.repoDir, p.taskId);
    });
    deps.tx.step(`push ${p.repoDir}`, () => deps.vcs.push(p.repoDir, remote, p.taskId, { setUpstream: true }), () => deps.vcs.pushDelete(p.repoDir, remote, p.taskId));
    return "created";
}
