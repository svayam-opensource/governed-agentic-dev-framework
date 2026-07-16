// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Gap-1 fill — branches unreachable through the CLI router but valid as
 * defense-in-depth, tested by calling the orchestrator directly. `task`'s
 * `no-issues` guard can't fire via route() (dispatch's split(",") never yields
 * an empty list), yet the guard is correct and worth pinning.
 */
import { expect } from "chai";
import { task, type TaskConfig, type TaskInput, type TaskDeps } from "../../src/lifecycle/task-run.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs, FsProbe } from "../../src/lifecycle/vcs.js";
import type { Issues } from "../../src/lifecycle/issues.js";

const CONFIG: TaskConfig = { githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work", remote: "origin" };
const board: Board = { fetchProject: () => ({ id: "P", title: "T", shortDescription: null, linkedItemCount: 1, repoUrls: [] }) };
const issues: Issues = { state: () => "OPEN", assign() {}, setBoardStatus() {}, close() {}, resolveIssueUrl: () => null, closeBoard() {} };
const fs: FsProbe = { pathExists: () => true };
function vcsOn(branch: string): Vcs {
  const noop = () => {};
  return {
    localBranchExists: () => false, remoteBranchExists: () => false, headSha: () => "h", refExists: () => false,
    lsRemoteHeads: () => [], defaultBranch: () => null, revParse: () => null, currentBranch: () => branch,
    isAncestor: () => false, isClean: () => true, remoteBranchesMatching: () => [], addPath: noop, commit: noop,
    resetHard: noop, cleanUntracked: noop, worktreeAdd: noop, worktreeRemove: noop, branchDelete: noop, push: noop,
    pushDelete: noop, clone: noop, fetch: noop, setIdentity: noop, checkout: noop, checkoutNew: noop, mergeNoEdit: () => "merged", tag: noop,
  };
}
const deps: TaskDeps = { board, vcs: vcsOn("BRNCH-43-governance-common-project"), fs, issues };

describe("gov-work — direct orchestrator gap-fills (unreachable via route)", () => {
  it("task(): empty issueUrls on a valid project branch → no-issues (exit 1)", () => {
    const input: TaskInput = { govClone: "/awr/PRJ-43/svm-prj-work", projectWorkRoot: "/awr/PRJ-43", issueUrls: [], assignee: "rk" };
    const r = task(deps, CONFIG, input);
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.reason).to.equal("no-issues");
    expect(r.code).to.equal(1);
    expect(r.message).to.match(/No issue URLs/i);
  });

  it("sanity: the same deps with one issue succeed (guard is specific to empties)", () => {
    const input: TaskInput = { govClone: "/awr/PRJ-43/svm-prj-work", projectWorkRoot: "/awr/PRJ-43", issueUrls: ["https://github.com/Svayamtech/r/issues/1"], assignee: "rk" };
    expect(task(deps, CONFIG, input).ok).to.equal(true);
  });
});
