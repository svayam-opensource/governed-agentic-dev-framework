// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { task, type TaskConfig, type TaskInput, type TaskDeps } from "../../src/lifecycle/task-run.js";
import { projectBranchOf, boardNumberFromBranch } from "../../src/lifecycle/task.js";
import { createGhIssues } from "../../src/lifecycle/issues.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs, FsProbe } from "../../src/lifecycle/vcs.js";
import type { Issues, IssueState } from "../../src/lifecycle/issues.js";

describe("prj-work Phase 2 — branch → board helpers", () => {
  it("projectBranchOf strips the .ISSUE- suffix", () => {
    expect(projectBranchOf("BRNCH-43-x.ISSUE-91")).to.equal("BRNCH-43-x");
    expect(projectBranchOf("BRNCH-43-x")).to.equal("BRNCH-43-x");
  });
  it("boardNumberFromBranch reads the board number (case-insensitive), else null", () => {
    expect(boardNumberFromBranch("BRNCH-43-governance-common-project")).to.equal(43);
    expect(boardNumberFromBranch("brnch-7-sanskriti.ISSUE-2")).to.equal(7);
    expect(boardNumberFromBranch("main")).to.equal(null);
  });
});

describe("prj-work Phase 2 — Issues gh adapter", () => {
  it("reads OPEN/CLOSED/UNKNOWN and does best-effort assign/status", () => {
    const calls: string[][] = [];
    const issues = createGhIssues((args) => {
      calls.push(args);
      if (args[0] === "issue" && args[1] === "view") return "OPEN\n";
      if (args[0] === "issue" && args[1] === "edit") throw new Error("no perms"); // swallowed
      return "";
    });
    expect(issues.state("u")).to.equal("OPEN");
    issues.assign("u", "me"); // must not throw despite the gh failure
    expect(calls.some((c) => c[1] === "edit")).to.equal(true);
  });
  it("returns UNKNOWN when gh view fails", () => {
    const issues = createGhIssues(() => {
      throw new Error("gh down");
    });
    expect(issues.state("u")).to.equal("UNKNOWN");
  });
});

const CONFIG: TaskConfig = { githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work", remote: "origin" };
const INPUT: TaskInput = {
  govClone: "/awr/PRJ-43/svm-prj-work",
  projectWorkRoot: "/awr/PRJ-43",
  issueUrls: ["https://github.com/Svayamtech/911-SVM-LIB-SVC/issues/123"],
  assignee: "svayam-rkant",
};
const CODE_REPO = "https://github.com/Svayamtech/911-SVM-LIB-SVC";

function fakeBoard(repoUrls: string[] = [CODE_REPO]): Board {
  return { fetchProject: () => ({ id: "P", title: "T", shortDescription: null, linkedItemCount: 1, repoUrls }) };
}
function fakeIssues(state: IssueState = "OPEN") {
  const acted: string[] = [];
  const issues: Issues = {
    state: () => state,
    assign: (u, a) => acted.push(`assign ${u} ${a}`),
    setBoardStatus: (_r, u, s) => acted.push(`status ${u} ${s}`),
    close: (u) => acted.push(`close ${u}`),
    resolveIssueUrl: () => null,
    closeBoard: () => {},
  };
  return { issues, acted };
}
function fakeVcs(branch = "BRNCH-43-governance-common-project") {
  const log: string[] = [];
  const vcs: Vcs = {
    localBranchExists: () => false,
    remoteBranchExists: () => false,
    headSha: () => "h",
    refExists: () => false,
    lsRemoteHeads: () => [],
    defaultBranch: () => null,
    revParse: () => null,
    currentBranch: () => branch,
    isAncestor: () => false,
    isClean: () => true,
    remoteBranchesMatching: () => [],
    addPath: () => {},
    commit: () => {},
    resetHard: () => {},
    cleanUntracked: () => {},
    worktreeAdd: () => {},
    worktreeRemove: () => {},
    branchDelete: (_r, b) => log.push(`branchDelete ${b}`),
    push: (r, _rm, b) => log.push(`push ${r} ${b}`),
    pushDelete: (r) => log.push(`pushDelete ${r}`),
    clone: () => {},
    fetch: () => {},
    setIdentity: () => {},
    checkout: (r, b) => log.push(`checkout ${r} ${b}`),
    checkoutNew: (r, b) => log.push(`checkoutNew ${r} ${b}`),
    mergeNoEdit: () => "merged",
    tag: () => {},
  };
  return { vcs, log };
}
const fsPresent = (present: boolean): FsProbe => ({ pathExists: () => present });

describe("prj-work Phase 2 — task orchestrator (model A)", () => {
  it("derives the project from cwd, branches workspace + present code repo, reflects on GitHub", () => {
    const { vcs, log } = fakeVcs();
    const { issues, acted } = fakeIssues("OPEN");
    const r = task({ board: fakeBoard(), vcs, fs: fsPresent(true), issues }, CONFIG, INPUT);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.boardNumber).to.equal(43);
    expect(r.projectBranch).to.equal("BRNCH-43-governance-common-project");
    expect(r.taskId).to.equal("BRNCH-43-governance-common-project.ISSUE-123");
    expect(r.reposBranched).to.deep.equal(["/awr/PRJ-43/svm-prj-work", "/awr/PRJ-43/911-SVM-LIB-SVC"]);
    expect(r.reposSkipped).to.deep.equal([]);
    // created the sub-branch in both repos
    expect(log.filter((l) => l.startsWith("checkoutNew"))).to.have.lengthOf(2);
    // reflected on GitHub (best-effort)
    expect(acted).to.include("assign https://github.com/Svayamtech/911-SVM-LIB-SVC/issues/123 svayam-rkant");
    expect(acted.some((a) => a.startsWith("status"))).to.equal(true);
  });

  it("skips a linked repo that has no local worktree (repo-on-demand deferred)", () => {
    const r = task({ board: fakeBoard(), vcs: fakeVcs().vcs, fs: fsPresent(false), issues: fakeIssues().issues }, CONFIG, INPUT);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.reposBranched).to.deep.equal(["/awr/PRJ-43/svm-prj-work"]); // only workspace
    expect(r.reposSkipped).to.deep.equal(["/awr/PRJ-43/911-SVM-LIB-SVC"]);
  });

  it("refuses a closed issue", () => {
    const r = task({ board: fakeBoard(), vcs: fakeVcs().vcs, fs: fsPresent(true), issues: fakeIssues("CLOSED").issues }, CONFIG, INPUT);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("issue-closed");
  });

  it("refuses when not on a project branch", () => {
    const r = task({ board: fakeBoard(), vcs: fakeVcs("main").vcs, fs: fsPresent(true), issues: fakeIssues().issues }, CONFIG, INPUT);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("not-a-project-branch");
  });

  it("honors an authorization deny", () => {
    const deps: TaskDeps = {
      board: fakeBoard(),
      vcs: fakeVcs().vcs,
      fs: fsPresent(true),
      issues: fakeIssues().issues,
      authorize: () => false,
    };
    const r = task(deps, CONFIG, INPUT);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("unauthorized");
  });
});
