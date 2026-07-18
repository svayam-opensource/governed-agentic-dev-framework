// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `close` orchestrator (SDD Part B, close-project) — finish a project. Model
 * A (SDD-012): no project.yaml status write, no registry flip. Status becomes
 * "completed" by CLOSING THE BOARD. The project branch is promoted to the default
 * branch via a PR (worktree-safe + the governance review point), never a direct
 * checkout/push of the default branch.
 *
 * Gate-before-ship + forward-idempotent: the knowledge gate and the (injected)
 * test-merge gate run BEFORE any base-branch push or PR; code-repo merges are
 * local-first and skip when already merged; a conflict pauses for manual fix.
 */
import * as path from "node:path";
import { repoNameFromUrl } from "./repo.js";
import { projectBranchOf, boardNumberFromBranch } from "./task.js";
import { closeGate } from "./close-gate.js";
import { archiveBranch } from "./merge.js";
/** `BRNCH-<rest>` → `PRJ-<rest>` (inverse of deriveBranch). */
function projectIdFromBranch(branch) {
    return branch.replace(/^brnch-/i, "PRJ-");
}
export function close(deps, config, input) {
    const log = deps.log ?? (() => { });
    const remote = config.remote ?? "origin";
    const repo = `${config.githubOrg}/${config.workspaceRepo}`;
    const projectBranch = projectBranchOf(deps.vcs.currentBranch(input.govClone));
    const boardNumber = boardNumberFromBranch(projectBranch);
    if (boardNumber === null) {
        return { ok: false, code: 1, reason: "not-a-project-branch", message: `'${projectBranch}' is not a project branch.` };
    }
    const projectId = projectIdFromBranch(projectBranch);
    const ref = { owner: config.githubOrg, ownerField: config.ownerField ?? "organization", number: boardNumber };
    const projectDir = path.join(input.govClone, "projects", projectId);
    // ── C01 pre-close knowledge gate ────────────────────────────────────────────
    const kGate = closeGate(deps.fs, projectDir);
    if (!kGate.ok) {
        return { ok: false, code: 1, reason: "knowledge-gate", message: "Pre-close knowledge gate failed.", failures: kGate.failures };
    }
    if (deps.authorize && !deps.authorize(ref)) {
        return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized to close GitHub Project #${boardNumber}.` };
    }
    // ── No unmerged task sub-branches ───────────────────────────────────────────
    const openTasks = deps.vcs.remoteBranchesMatching(input.govClone, remote, `${projectBranch}.*`);
    if (openTasks.length > 0) {
        return { ok: false, code: 1, reason: "open-tasks", message: `Unmerged task sub-branches exist — merge or cancel first:\n  ${openTasks.join("\n  ")}` };
    }
    // ── Sync the project branch with the latest default ─────────────────────────
    deps.vcs.fetch(input.govClone, remote, config.defaultBranch);
    deps.vcs.fetch(input.govClone, remote, projectBranch);
    deps.vcs.checkout(input.govClone, projectBranch);
    if (deps.vcs.mergeNoEdit(input.govClone, `${remote}/${config.defaultBranch}`) === "conflict") {
        return { ok: false, code: 2, reason: "sync-conflict", message: `Merge conflict syncing ${config.defaultBranch} → ${projectBranch}. Resolve, commit, then re-run.`, repoDir: input.govClone };
    }
    // ── Merge code-repo branches → base, LOCAL ONLY (push deferred past the gate) ─
    const codeRepoDirs = deps.board
        .fetchProject(ref)
        .repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)
        .map((u) => path.join(input.projectWorkRoot, repoNameFromUrl(u)))
        .filter((d) => deps.fs.pathExists(path.join(d, ".git")));
    const merged = [];
    for (const dir of codeRepoDirs) {
        const base = config.defaultCodeBranch;
        deps.vcs.fetch(dir, remote, base);
        deps.vcs.fetch(dir, remote, projectBranch);
        deps.vcs.checkout(dir, base);
        if (!deps.vcs.isAncestor(dir, projectBranch, base)) {
            if (deps.vcs.mergeNoEdit(dir, projectBranch) === "conflict") {
                return { ok: false, code: 2, reason: "code-merge-conflict", message: `Merge conflict: ${projectBranch} → ${base} in ${dir}. Resolve, commit, then re-run.`, repoDir: dir };
            }
        }
        merged.push(dir);
    }
    // ── Test-merge gate (Phase 3 validators) — BEFORE any push ──────────────────
    if (deps.gate) {
        const g = deps.gate();
        if (!g.ok)
            return { ok: false, code: 1, reason: "test-merge-gate", message: "Test-merge gate failed — nothing pushed.", failures: g.failures };
    }
    // ── Gate passed — push code bases, then promote the branch via PR ───────────
    for (const dir of merged)
        deps.vcs.push(dir, remote, config.defaultCodeBranch);
    deps.vcs.push(input.govClone, remote, projectBranch);
    const prUrl = deps.pulls.create(repo, config.defaultBranch, projectBranch, `close-project: ${projectId} → ${config.defaultBranch}`, `Automated project close for **${projectId}** (${input.today}). Promotes projects/${projectId}/ (knowledge + agent.md) to ${config.defaultBranch}. Status is GitHub-derived — the board is closed at close.`);
    const outcome = deps.pulls.merge(repo, projectBranch);
    if (outcome === "failed") {
        return { ok: false, code: 1, reason: "pr-merge-failed", message: `Could not merge the close PR${prUrl ? ` (${prUrl})` : ""}. Merge it manually, then re-run.` };
    }
    deps.vcs.fetch(input.govClone, remote, config.defaultBranch);
    // ── Close the board (THIS marks the project completed), then archive ────────
    deps.issues.closeBoard(ref);
    log(`board #${boardNumber} closed`);
    archiveBranch(deps.vcs, input.govClone, projectBranch, remote);
    for (const dir of merged)
        archiveBranch(deps.vcs, dir, projectBranch, remote);
    // ── Best-effort workspace teardown (deferred if not provided) ───────────────
    deps.cleanup?.();
    return { ok: true, projectId, projectBranch, boardNumber, prUrl, reposMerged: merged };
}
