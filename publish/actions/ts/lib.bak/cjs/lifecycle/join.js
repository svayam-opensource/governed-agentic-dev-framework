// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `join` (SDD Part B, join.sh, POL-047) — set up an authorized teammate's OWN
 * per-project workspace on an ALREADY-seeded project. No new id, no anchor, no
 * scaffold — just materialize worktrees on the EXISTING project branch. Model A
 * (SDD-012): identity + repos derived from the board; nothing read from a state
 * file. Idempotent (an existing worktree is skipped); NOT transactional — a
 * re-run resumes.
 */
import * as path from "node:path";
import { parseBoardUrl, deriveProjectIdentity } from "./identity.js";
import { repoNameFromUrl, baseCloneDir } from "./repo.js";
/** Materialize a worktree of `url` at `worktreePath` on the existing `branch`. */
function materialize(deps, url, worktreePath, branch, agentWorkRoot, remote) {
    if (deps.fs.pathExists(path.join(worktreePath, ".git")))
        return; // already joined — skip
    const baseClone = baseCloneDir(agentWorkRoot, url);
    if (!deps.fs.pathExists(path.join(baseClone, ".git")))
        deps.cloneRepo(url, baseClone);
    deps.vcs.fetch(baseClone, remote, branch);
    // Create a local branch tracking the existing remote project branch, checked
    // out in the new worktree (startPoint = origin/<branch>).
    deps.vcs.worktreeAdd(baseClone, branch, worktreePath, `${remote}/${branch}`);
}
export function join(deps, config, input) {
    const log = deps.log ?? (() => { });
    const remote = config.remote ?? "origin";
    const ref = parseBoardUrl(input.boardUrl);
    if (!ref)
        return { ok: false, code: 1, reason: "bad-url", message: `Not a GitHub Project URL: ${input.boardUrl}` };
    const boardRef = { ...ref, ownerField: config.ownerField ?? ref.ownerField };
    const board = deps.board.fetchProject(boardRef);
    const idr = deriveProjectIdentity({ url: input.boardUrl, title: board.title });
    if (!idr.ok)
        return { ok: false, code: 1, reason: idr.reason, message: `Cannot derive project id (${idr.reason}).` };
    const { projectId, branch } = idr;
    if (deps.authorize && !deps.authorize(boardRef)) {
        return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized to join GitHub Project #${boardRef.number}.` };
    }
    const projectWorkRoot = path.join(config.agentWorkRoot, projectId);
    const orgGovClone = path.join(projectWorkRoot, config.workspaceRepo);
    log(`join ${projectId}: gov worktree on ${branch}`);
    materialize(deps, config.orgRepoUrl, orgGovClone, branch, config.agentWorkRoot, remote);
    if (input.identity)
        deps.vcs.setIdentity(orgGovClone, input.identity);
    const repos = [];
    for (const url of board.repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)) {
        const dir = path.join(projectWorkRoot, repoNameFromUrl(url));
        materialize(deps, url, dir, branch, config.agentWorkRoot, remote);
        if (input.identity)
            deps.vcs.setIdentity(dir, input.identity);
        repos.push(dir);
    }
    return { ok: true, projectId, branch, orgGovClone, repos };
}
