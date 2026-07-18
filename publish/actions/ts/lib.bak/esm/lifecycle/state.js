import { projectBranchOf, boardNumberFromBranch } from "./task.js";
/** Derive a project's status from the board state + anchor labels (SDD-020). */
export function deriveStatus(boardOpen, anchorLabels) {
    const has = (l) => anchorLabels.includes(l);
    if (!boardOpen)
        return has("cancelled") ? "cancelled" : "completed";
    return has("paused") ? "paused" : "active";
}
/** Resolve the board ref from the workspace's current branch. */
function refFromCwd(deps, config, input) {
    const projectBranch = projectBranchOf(deps.vcs.currentBranch(input.govClone));
    const boardNumber = boardNumberFromBranch(projectBranch);
    if (boardNumber === null) {
        return { error: { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` } };
    }
    if (deps.authorize && !deps.authorize({ owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber })) {
        return { error: { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` } };
    }
    return { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
}
/** Pause a project — add the 'paused' label to its anchor issue (board stays open). */
export function pause(deps, config, input) {
    const r = refFromCwd(deps, config, input);
    if ("error" in r)
        return r.error;
    const applied = deps.anchor.setState(r, config.workspaceRepo, "paused", "add");
    return { ok: true, status: "paused", boardNumber: r.number, applied };
}
/** Resume a paused project — remove the 'paused' label. */
export function resume(deps, config, input) {
    const r = refFromCwd(deps, config, input);
    if ("error" in r)
        return r.error;
    const applied = deps.anchor.setState(r, config.workspaceRepo, "paused", "remove");
    return { ok: true, status: "active", boardNumber: r.number, applied };
}
/** Cancel a project — add the 'cancelled' label and close the board. */
export function cancel(deps, config, input) {
    const r = refFromCwd(deps, config, input);
    if ("error" in r)
        return r.error;
    const applied = deps.anchor.setState(r, config.workspaceRepo, "cancelled", "add");
    deps.issues.closeBoard(r);
    return { ok: true, status: "cancelled", boardNumber: r.number, applied };
}
