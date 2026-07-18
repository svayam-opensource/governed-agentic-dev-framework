import { deriveStatus } from "./state.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";
/** List the org's projects with owners, PAGINATED — the per-project anchor lookup (the expensive part)
 *  runs only for the requested page, not the whole set. `limit <= 0` → all rows. */
export function manageList(deps, config, all, limit = 20, offset = 0) {
    const ownerField = config.ownerField ?? "organization";
    const boards = deps.projects.listBoards(config.githubOrg).filter((b) => all || !b.closed);
    const total = boards.length;
    const cap = limit > 0 ? limit : total;
    const start = Math.min(Math.max(0, offset), total);
    const rows = [];
    for (const b of boards.slice(start, start + cap)) { // resolve owners ONLY for this page
        const ref = { owner: config.githubOrg, ownerField, number: b.number };
        const anchor = deps.anchor.find(ref, config.workspaceRepo);
        rows.push({
            boardNumber: b.number,
            title: b.title,
            url: b.url,
            status: deriveStatus(!b.closed, anchor?.labels ?? []),
            owners: anchor ? [...anchor.assignees] : [],
        });
    }
    return { rows, total, offset: start, limit: cap };
}
export function formatOwnerRows(rows) {
    if (rows.length === 0)
        return ["(no projects)"];
    return rows.map((r) => `  #${r.boardNumber} [${r.status}] ${r.title} — owners: ${r.owners.length ? r.owners.join(", ") : "(none)"}`);
}
/** Add/remove an owner (anchor-issue assignee) on the CURRENT project. */
export function manageAssign(deps, config, govClone, login, action) {
    const projectBranch = projectBranchOf(deps.vcs.currentBranch(govClone));
    const boardNumber = boardNumberFromBranch(projectBranch);
    if (boardNumber === null)
        return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
    const ref = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
    const anchor = deps.anchor.find(ref, config.workspaceRepo);
    if (!anchor)
        return { ok: false, code: 1, reason: "no-anchor", message: `No anchor issue for project #${boardNumber} — designate one first.` };
    return { ok: true, login, action, applied: deps.anchor.setAssignee(anchor.url, login, action), anchorUrl: anchor.url };
}
/** `prj anchor` — find + show the CURRENT project's anchor issue (debug op). */
export function anchorShow(deps, config, govClone) {
    const projectBranch = projectBranchOf(deps.vcs.currentBranch(govClone));
    const boardNumber = boardNumberFromBranch(projectBranch);
    if (boardNumber === null)
        return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
    const anchor = deps.anchor.find({ owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber }, config.workspaceRepo);
    if (!anchor)
        return { ok: false, code: 1, reason: "no-anchor", message: `No anchor issue for project #${boardNumber}.` };
    return { ok: true, url: anchor.url, number: anchor.number, labels: [...anchor.labels], owners: [...anchor.assignees] };
}
/** `prj status` — derive the current project's board# from cwd, report live status. */
export function projectStatus(deps, config, govClone) {
    const projectBranch = projectBranchOf(deps.vcs.currentBranch(govClone));
    const boardNumber = boardNumberFromBranch(projectBranch);
    if (boardNumber === null)
        return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
    const board = deps.projects.listBoards(config.githubOrg).find((b) => b.number === boardNumber);
    if (!board)
        return { ok: false, code: 1, reason: "not-found", message: `Project #${boardNumber} not found on GitHub.` };
    const anchor = deps.anchor.find({ owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber }, config.workspaceRepo);
    return { ok: true, boardNumber, title: board.title, url: board.url, status: deriveStatus(!board.closed, anchor?.labels ?? []), owners: anchor ? [...anchor.assignees] : [] };
}
