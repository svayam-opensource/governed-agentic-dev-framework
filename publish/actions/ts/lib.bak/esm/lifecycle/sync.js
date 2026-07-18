// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `sync` (SDD Part B, sync.sh, POL-122) — merge the latest default/base into the
 * active project branch across all repos, mid-project, without pausing. Model A
 * (SDD-012): project + repos derived from the workspace + GitHub. Forward-
 * idempotent (re-merging an up-to-date branch is a no-op); a conflict pauses for
 * manual resolution (rc=2).
 */
import * as path from "node:path";
import { repoNameFromUrl } from "./repo.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";
export function sync(deps, config, input) {
    const log = deps.log ?? (() => { });
    const remote = config.remote ?? "origin";
    const projectBranch = projectBranchOf(deps.vcs.currentBranch(input.govClone));
    const boardNumber = boardNumberFromBranch(projectBranch);
    if (boardNumber === null) {
        return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
    }
    const ref = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
    if (deps.authorize && !deps.authorize(ref)) {
        return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` };
    }
    const codeRepoDirs = deps.board
        .fetchProject(ref)
        .repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)
        .map((u) => path.join(input.projectWorkRoot, repoNameFromUrl(u)))
        .filter((d) => deps.fs.pathExists(path.join(d, ".git")));
    // Workspace repo syncs from the default branch; code repos from their base.
    const targets = [
        { dir: input.govClone, base: config.defaultBranch },
        ...codeRepoDirs.map((dir) => ({ dir, base: config.defaultCodeBranch })),
    ];
    for (const t of targets) {
        if (!deps.vcs.isClean(t.dir)) {
            return { ok: false, code: 1, reason: "dirty", message: `Uncommitted changes in ${t.dir} — commit or stash first.`, repoDir: t.dir };
        }
    }
    const synced = [];
    for (const t of targets) {
        log(`sync ${t.base} → ${projectBranch} in ${t.dir}`);
        deps.vcs.fetch(t.dir, remote, t.base);
        deps.vcs.checkout(t.dir, projectBranch);
        if (deps.vcs.mergeNoEdit(t.dir, `${remote}/${t.base}`) === "conflict") {
            return { ok: false, code: 2, reason: "merge-conflict", repoDir: t.dir, message: `Merge conflict: ${t.base} → ${projectBranch} in ${t.dir}. Resolve, commit, then re-run.` };
        }
        deps.vcs.push(t.dir, remote, projectBranch);
        synced.push(t.dir);
    }
    return { ok: true, projectBranch, boardNumber, synced };
}
