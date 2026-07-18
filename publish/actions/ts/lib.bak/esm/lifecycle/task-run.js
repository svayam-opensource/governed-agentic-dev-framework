// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `task` orchestrator (SDD Part B, create-task) — model A (SDD-012): derives
 * the project from the workspace (current branch → board number) and the repos
 * from GitHub (board linked items); NO project.yaml. Creates the task sub-branch
 * in the workspace clone + each present code-repo worktree through a Transaction,
 * then reflects the task on GitHub (assign + board status, best-effort).
 */
import * as path from "node:path";
import { Transaction } from "./transaction.js";
import { repoNameFromUrl } from "./repo.js";
import { parseIssueUrl, taskIdFor, projectBranchOf, boardNumberFromBranch, createSubBranch, } from "./task.js";
export function task(deps, config, input) {
    const log = deps.log ?? (() => { });
    const remote = config.remote ?? "origin";
    // ── Derive the project from the workspace branch ────────────────────────────
    const rawBranch = deps.vcs.currentBranch(input.govClone);
    const projectBranch = projectBranchOf(rawBranch);
    const boardNumber = boardNumberFromBranch(projectBranch);
    if (boardNumber === null) {
        return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${rawBranch}' is not a project branch (expected BRNCH-<n>-…).` };
    }
    const ref = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
    // ── Parse + validate issues (open only) ─────────────────────────────────────
    if (input.issueUrls.length === 0)
        return { ok: false, code: 1, reason: "no-issues", message: "No issue URLs given." };
    const issueNumbers = [];
    for (const url of input.issueUrls) {
        const parsed = parseIssueUrl(url);
        if (!parsed)
            return { ok: false, code: 1, reason: "bad-issue-url", message: `Could not extract an issue number from '${url}'.` };
        if (deps.issues.state(url) === "CLOSED") {
            return { ok: false, code: 1, reason: "issue-closed", message: `Issue ${url} is closed — cannot start a task on it.` };
        }
        issueNumbers.push(parsed.number);
    }
    // ── Authorization (best-effort gate) ────────────────────────────────────────
    if (deps.authorize && !deps.authorize(ref)) {
        return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized on GitHub Project #${boardNumber}.` };
    }
    const taskId = taskIdFor(projectBranch, issueNumbers);
    const board = deps.board.fetchProject(ref);
    const codeRepoUrls = board.repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo);
    // ── Create sub-branches (workspace + present code worktrees) ─────────────────
    const tx = new Transaction();
    const reposBranched = [];
    const reposSkipped = [];
    try {
        log(`task ${taskId}: workspace repo`);
        createSubBranch({ vcs: deps.vcs, tx }, { repoDir: input.govClone, projectBranch, taskId, label: "workspace repo", remote });
        reposBranched.push(input.govClone);
        for (const url of codeRepoUrls) {
            const repoDir = path.join(input.projectWorkRoot, repoNameFromUrl(url));
            if (!deps.fs.pathExists(path.join(repoDir, ".git"))) {
                reposSkipped.push(repoDir); // needs repo-on-demand (add-repo) — deferred
                continue;
            }
            createSubBranch({ vcs: deps.vcs, tx }, { repoDir, projectBranch, taskId, label: url, remote });
            reposBranched.push(repoDir);
        }
        tx.commit();
    }
    catch (error) {
        const rollbackFailures = tx.rollback();
        return { ok: false, code: 1, reason: "task-failed", message: error.message, rollbackFailures };
    }
    // ── Reflect the task on GitHub (best-effort, post-branch) ────────────────────
    for (const url of input.issueUrls) {
        deps.issues.assign(url, input.assignee);
        deps.issues.setBoardStatus(ref, url, "In progress");
    }
    return { ok: true, taskId, projectBranch, boardNumber, issueNumbers, reposBranched, reposSkipped };
}
