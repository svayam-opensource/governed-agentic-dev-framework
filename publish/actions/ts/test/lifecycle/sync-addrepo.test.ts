// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { sync } from "../../src/lifecycle/sync.js";
import { addRepo } from "../../src/lifecycle/add-repo.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs, FsProbe } from "../../src/lifecycle/vcs.js";
import { px, pxAll, pxDeep } from "../helpers/paths.js";

const CODE_REPO = "https://github.com/Svayamtech/911-SVM-LIB-SVC";
const GOV = "/awr/PRJ-43/svm-prj-work";
const CODE_DIR = "/awr/PRJ-43/911-SVM-LIB-SVC";

const board = (repoUrls: string[] = [CODE_REPO]): Board => ({
  fetchProject: () => ({ id: "P", title: "T", shortDescription: null, linkedItemCount: 1, repoUrls }),
});
const fsPresent = (present: boolean): FsProbe => ({ pathExists: () => present });

function fakeVcs(opts: { conflict?: boolean; dirty?: boolean } = {}) {
  const log: string[] = [];
  const vcs: Vcs = {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h", refExists: () => false,
    lsRemoteHeads: () => [],
    // The base exists; no project branch yet — the ordinary case the preflight sees.
    lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }], defaultBranch: () => null, revParse: () => null,
    currentBranch: () => "BRNCH-43-governance-common-project", isAncestor: () => false, isClean: () => !opts.dirty,
    remoteBranchesMatching: () => [], addPath: () => {}, commit: () => {}, resetHard: () => {}, resetKeepingFiles: () => {}, cleanUntracked: () => {},
    worktreeAdd: (_b, br, wt) => log.push(`worktreeAdd ${wt} ${br}`), worktreeRemove: () => {}, branchDelete: () => {},
    push: (r, _rm, b) => log.push(`push ${r} ${b}`), pushDelete: () => {}, clone: () => {},
    fetch: (r, _rm, ref) => log.push(`fetch ${r} ${ref}`), setIdentity: () => {},
    checkout: (r, b) => log.push(`checkout ${r} ${b}`), checkoutNew: () => {},
    mergeNoEdit: () => (opts.conflict ? "conflict" : "merged"), tag: () => {},
  };
  return { vcs, log };
}

const SYNC_CONFIG = { githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work", defaultBranch: "main", defaultCodeBranch: "dev", remote: "origin" };
const syncInput = { govClone: GOV, projectWorkRoot: "/awr/PRJ-43" };

describe("prj-work Phase 2 — sync", () => {
  it("merges default→branch in the workspace and base→branch in each code repo", () => {
    const { vcs, log } = fakeVcs();
    const r = sync({ board: board(), authorize: () => true,vcs, fs: fsPresent(true) }, SYNC_CONFIG, syncInput);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(pxDeep(r.synced)).to.deep.equal([GOV, CODE_DIR]);
    expect(pxAll(log)).to.include(`fetch ${GOV} main`); // workspace from default
    expect(pxAll(log)).to.include(`fetch ${CODE_DIR} dev`); // code repo from base
    expect(log.filter((l) => l.startsWith("push")).length).to.equal(2);
  });

  it("stops on a conflict (rc=2) and refuses a dirty tree", () => {
    expect(sync({ board: board(), authorize: () => true,vcs: fakeVcs({ conflict: true }).vcs, fs: fsPresent(true) }, SYNC_CONFIG, syncInput)).to.include({ ok: false, code: 2, reason: "merge-conflict" });
    expect(sync({ board: board(), authorize: () => true,vcs: fakeVcs({ dirty: true }).vcs, fs: fsPresent(true) }, SYNC_CONFIG, syncInput)).to.include({ ok: false, reason: "dirty" });
  });

  it("refuses off a non-project branch", () => {
    const vcs = { ...fakeVcs().vcs, currentBranch: () => "main" };
    expect(sync({ board: board(), authorize: () => true,vcs, fs: fsPresent(true) }, SYNC_CONFIG, syncInput)).to.include({ ok: false, reason: "not-a-project-branch" });
  });
});

const ADD_CONFIG = { githubOrg: "Svayamtech", agentWorkRoot: "/awr", defaultCodeBranch: "dev", remote: "origin" };

describe("prj-work Phase 2 — add-repo (repo-on-demand)", () => {
  it("worktrees the new repo's project branch (base clone missing → cloned)", () => {
    const { vcs, log } = fakeVcs();
    const cloned: string[] = [];
    // base ref exists, project branch absent → setupCodeRepoWorktree proceeds
    const v = { ...vcs, refExists: (_r: string, ref: string) => ref === "refs/remotes/origin/dev" };
    const r = addRepo(
      { vcs: v, fs: fsPresent(false), cloneRepo: (_u, d) => cloned.push(d), authorize: () => true },
      ADD_CONFIG,
      { govClone: GOV, projectWorkRoot: "/awr/PRJ-43", repoUrl: CODE_REPO },
    );
    expect(r.ok).to.equal(true);
    if (r.ok) expect(px(r.repoDir)).to.equal(CODE_DIR);
    expect(pxAll(cloned)).to.deep.equal(["/awr/.bases/911-SVM-LIB-SVC"]);
    expect(pxAll(log)).to.include(`worktreeAdd ${CODE_DIR} BRNCH-43-governance-common-project`);
  });

  it("fails (with rollback) when the base branch is missing", () => {
    const v = { ...fakeVcs().vcs, refExists: () => false }; // base ref absent
    const r = addRepo({ authorize: () => true,vcs: v, fs: fsPresent(true), cloneRepo: () => {} }, ADD_CONFIG, { govClone: GOV, projectWorkRoot: "/awr/PRJ-43", repoUrl: CODE_REPO });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("add-failed");
  });
});
