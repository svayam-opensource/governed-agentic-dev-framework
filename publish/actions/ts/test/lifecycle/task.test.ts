// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import {
  parseIssueUrl,
  taskIdFor,
  normalizeRepoUrl,
  createSubBranch,
} from "../../src/lifecycle/task.js";
import { Transaction } from "../../src/lifecycle/transaction.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";

describe("prj-work Phase 2 — task parsing helpers", () => {
  it("parseIssueUrl extracts the number + repo URL, or null", () => {
    expect(parseIssueUrl("https://github.com/Svayamtech/911-SVM-LIB-SVC/issues/123")).to.deep.equal({
      number: 123,
      repoUrl: "https://github.com/Svayamtech/911-SVM-LIB-SVC",
    });
    expect(parseIssueUrl("https://github.com/Svayamtech/svm-prj-work")).to.equal(null);
  });

  it("taskIdFor sorts, de-dupes, and dash-joins issue numbers", () => {
    expect(taskIdFor("BRNCH-43-x", [91])).to.equal("BRNCH-43-x.ISSUE-91");
    expect(taskIdFor("BRNCH-43-x", [91, 90, 91])).to.equal("BRNCH-43-x.ISSUE-90-91");
  });

  it("normalizeRepoUrl makes ssh and https forms compare equal", () => {
    const ssh = normalizeRepoUrl("git@github.com:Svayamtech/911-SVM-LIB-SVC.git");
    const https = normalizeRepoUrl("https://github.com/Svayamtech/911-SVM-LIB-SVC");
    expect(ssh).to.equal("svayamtech/911-svm-lib-svc");
    expect(ssh).to.equal(https);
  });
});

/** A recording fake Vcs; branch existence + sha resolution are configurable. */
function fakeVcs(opts: { hasTask?: boolean; taskSha?: string | null; baseSha?: string | null } = {}) {
  const log: string[] = [];
  const vcs: Vcs = {
    localBranchExists: () => opts.hasTask ?? false,
    remoteBranchExists: () => false,
    headSha: () => "h",
    refExists: () => false,
    lsRemoteHeads: () => [],
    // The base exists; no project branch yet — the ordinary case the preflight sees.
    lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }],
    defaultBranch: () => null,
    revParse: (_r, rev) => (rev.includes("origin/") || rev.endsWith("BRNCH-43-x") ? (opts.baseSha ?? null) : (opts.taskSha ?? null)),
    currentBranch: () => "BRNCH-43-x",
    isAncestor: () => false,
    isClean: () => true,
    remoteBranchesMatching: () => [],
    addPath: () => {},
    commit: () => {},
    resetHard: () => {}, resetKeepingFiles: () => {},
    cleanUntracked: () => {},
    worktreeAdd: () => {}, worktreeAddExisting: () => {},
    worktreeRemove: () => {},
    branchDelete: (_r, b) => log.push(`branchDelete ${b}`),
    push: (r, _rm, b) => log.push(`push ${r} ${b}`),
    pushDelete: (r, _rm, b) => log.push(`pushDelete ${r} ${b}`),
    clone: () => {},
    fetch: () => log.push("fetch"),
    setIdentity: () => {},
    checkout: (r, b) => log.push(`checkout ${r} ${b}`),
    checkoutNew: (r, b) => log.push(`checkoutNew ${r} ${b}`),
    mergeNoEdit: () => "merged",
    tag: () => {},
  };
  return { vcs, log };
}

const PARAMS = {
  repoDir: "/repo",
  projectBranch: "BRNCH-43-x",
  taskId: "BRNCH-43-x.ISSUE-91",
  label: "workspace repo",
};

describe("prj-work Phase 2 — createSubBranch", () => {
  it("creates the sub-branch: checkout base → branch off → push (2 undo steps)", () => {
    const { vcs, log } = fakeVcs();
    const tx = new Transaction();
    expect(createSubBranch({ vcs, tx }, PARAMS)).to.equal("created");
    expect(log).to.deep.equal([
      "fetch",
      "checkout /repo BRNCH-43-x",
      "checkoutNew /repo BRNCH-43-x.ISSUE-91",
      "push /repo BRNCH-43-x.ISSUE-91",
    ]);
    expect(tx.pending).to.equal(2);
  });

  it("resumes (no-op) when the sub-branch already exists at the base", () => {
    const { vcs, log } = fakeVcs({ hasTask: true, taskSha: "same", baseSha: "same" });
    const tx = new Transaction();
    expect(createSubBranch({ vcs, tx }, PARAMS)).to.equal("resumed");
    expect(tx.pending).to.equal(0);
    expect(log).to.deep.equal(["fetch"]); // no checkout/branch/push
  });

  it("throws when the existing sub-branch diverges from the base", () => {
    const { vcs } = fakeVcs({ hasTask: true, taskSha: "aaa", baseSha: "bbb" });
    expect(() => createSubBranch({ vcs, tx: new Transaction() }, PARAMS)).to.throw(/diverges/);
  });

  it("rollback deletes the pushed + local sub-branch (LIFO)", () => {
    const { vcs, log } = fakeVcs();
    const tx = new Transaction();
    createSubBranch({ vcs, tx }, PARAMS);
    log.length = 0;
    tx.rollback();
    expect(log).to.deep.equal([
      "pushDelete /repo BRNCH-43-x.ISSUE-91",
      "checkout /repo BRNCH-43-x",
      "branchDelete BRNCH-43-x.ISSUE-91",
    ]);
  });
});
