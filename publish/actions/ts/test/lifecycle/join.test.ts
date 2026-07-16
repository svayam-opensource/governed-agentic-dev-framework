// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { join } from "../../src/lifecycle/join.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs, FsProbe } from "../../src/lifecycle/vcs.js";

const CODE_REPO = "https://github.com/Svayamtech/911-SVM-LIB-SVC";
const CONFIG = {
  githubOrg: "Svayamtech",
  workspaceRepo: "svm-prj-work",
  orgRepoUrl: "git@github.com:Svayamtech/svm-prj-work.git",
  agentWorkRoot: "/awr",
  remote: "origin",
};
const INPUT = { boardUrl: "https://github.com/orgs/Svayamtech/projects/43" };
const WORK_ROOT = "/awr/PRJ-43-governance-common-project";

const board = (repoUrls: string[] = [CODE_REPO]): Board => ({
  fetchProject: () => ({ id: "P", title: "@Governance Common Project", shortDescription: null, linkedItemCount: 1, repoUrls }),
});

function fakeVcs() {
  const log: string[] = [];
  const vcs: Vcs = {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h", refExists: () => false,
    lsRemoteHeads: () => [], defaultBranch: () => null, revParse: () => null, currentBranch: () => "main",
    isAncestor: () => false, isClean: () => true, remoteBranchesMatching: () => [], addPath: () => {}, commit: () => {},
    resetHard: () => {}, cleanUntracked: () => {},
    worktreeAdd: (_b, br, wt, sp) => log.push(`worktreeAdd ${wt} ${br} @ ${sp}`),
    worktreeRemove: () => {}, branchDelete: () => {}, push: () => {}, pushDelete: () => {}, clone: () => {},
    fetch: (r, _rm, ref) => log.push(`fetch ${r} ${ref}`), setIdentity: () => {}, checkout: () => {}, checkoutNew: () => {},
    mergeNoEdit: () => "merged", tag: () => {},
  };
  return { vcs, log };
}
const fsPresent = (present: boolean): FsProbe => ({ pathExists: () => present });

describe("prj-work Phase 2 — join (co-dev checkout)", () => {
  it("materializes gov + code worktrees on the EXISTING project branch", () => {
    const { vcs, log } = fakeVcs();
    const cloned: string[] = [];
    const r = join({ board: board(), vcs, fs: fsPresent(false), cloneRepo: (_u, d) => cloned.push(d) }, CONFIG, INPUT);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.projectId).to.equal("PRJ-43-governance-common-project");
    expect(r.branch).to.equal("BRNCH-43-governance-common-project");
    expect(r.orgGovClone).to.equal(`${WORK_ROOT}/svm-prj-work`);
    expect(r.repos).to.deep.equal([`${WORK_ROOT}/911-SVM-LIB-SVC`]);
    // base clones created (missing), worktrees checked out from origin/<branch>
    expect(cloned).to.have.members(["/awr/.bases/svm-prj-work", "/awr/.bases/911-SVM-LIB-SVC"]);
    expect(log).to.include(`worktreeAdd ${WORK_ROOT}/svm-prj-work BRNCH-43-governance-common-project @ origin/BRNCH-43-governance-common-project`);
    expect(log).to.include(`worktreeAdd ${WORK_ROOT}/911-SVM-LIB-SVC BRNCH-43-governance-common-project @ origin/BRNCH-43-governance-common-project`);
  });

  it("is idempotent — an existing worktree is skipped (no clone/worktree)", () => {
    const { vcs, log } = fakeVcs();
    const cloned: string[] = [];
    join({ board: board([]), vcs, fs: fsPresent(true), cloneRepo: (_u, d) => cloned.push(d) }, CONFIG, INPUT);
    expect(cloned).to.deep.equal([]);
    expect(log.some((l) => l.startsWith("worktreeAdd"))).to.equal(false);
  });

  it("rejects a bad board URL and an authorization deny", () => {
    const { vcs } = fakeVcs();
    expect(join({ board: board(), vcs, fs: fsPresent(false), cloneRepo: () => {} }, CONFIG, { boardUrl: "nope" })).to.include({ ok: false, reason: "bad-url" });
    const r = join({ board: board(), vcs, fs: fsPresent(true), cloneRepo: () => {}, authorize: () => false }, CONFIG, INPUT);
    expect(r).to.include({ ok: false, reason: "unauthorized" });
  });
});
