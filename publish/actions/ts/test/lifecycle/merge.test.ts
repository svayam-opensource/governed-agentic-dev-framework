// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { merge, type MergeConfig, type MergeInput } from "../../src/lifecycle/merge.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs, FsProbe } from "../../src/lifecycle/vcs.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import { pxDeep } from "../helpers/paths.js";

const CONFIG: MergeConfig = { githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work", remote: "origin" };
const GOV = "/awr/PRJ-43/svm-prj-work";
const CODE_REPO = "https://github.com/Svayamtech/911-SVM-LIB-SVC";
const CODE_DIR = "/awr/PRJ-43/911-SVM-LIB-SVC";
const ISSUE = "https://github.com/Svayamtech/911-SVM-LIB-SVC/issues/123";
const TASK_ID = "BRNCH-43-governance-common-project.ISSUE-123";

function fakeBoard(repoUrls: string[] = [CODE_REPO]): Board {
  return { fetchProject: () => ({ id: "P", title: "T", shortDescription: null, linkedItemCount: 1, repoUrls }) };
}
function fakeIssues() {
  const acted: string[] = [];
  const issues: Issues = {
    state: () => "OPEN",
    assign: () => {},
    setBoardStatus: (_r, u, s) => acted.push(`status ${u} ${s}`),
    close: (u, c) => acted.push(`close ${u} :: ${c}`),
    resolveIssueUrl: () => null,
    closeBoard: () => {},
  };
  return { issues, acted };
}
function fakeVcs(opts: { conflict?: boolean; alreadyMerged?: boolean; dirty?: boolean; hasRemoteTask?: boolean } = {}) {
  const log: string[] = [];
  const vcs: Vcs = {
    localBranchExists: () => false,
    remoteBranchExists: () => opts.hasRemoteTask ?? true,
    headSha: () => "h",
    refExists: () => false,
    lsRemoteHeads: () => [],
    // The base exists; no project branch yet — the ordinary case the preflight sees.
    lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }],
    defaultBranch: () => null,
    revParse: () => null,
    currentBranch: () => "BRNCH-43-governance-common-project",
    isAncestor: () => opts.alreadyMerged ?? false,
    isClean: () => !(opts.dirty ?? false),
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
    fetch: () => {},
    setIdentity: () => {},
    checkout: (r, b) => log.push(`checkout ${r} ${b}`),
    checkoutNew: () => {},
    mergeNoEdit: (r) => {
      log.push(`merge ${r}`);
      return opts.conflict ? "conflict" : "merged";
    },
    tag: (r, t) => log.push(`tag ${r} ${t}`),
  };
  return { vcs, log };
}
const fsPresent = (present: boolean): FsProbe => ({ pathExists: () => present });
const input = (taskArg = ISSUE): MergeInput => ({ govClone: GOV, projectWorkRoot: "/awr/PRJ-43", taskArg });

describe("prj-work Phase 2 — merge orchestrator (model A)", () => {
  it("merges the sub-branch across repos, archives it, and closes the issue", () => {
    const { vcs, log } = fakeVcs();
    const { issues, acted } = fakeIssues();
    const r = merge({ board: fakeBoard(), authorize: () => true,vcs, fs: fsPresent(true), issues }, CONFIG, input());
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.taskId).to.equal(TASK_ID);
    expect(r.issueUrls).to.deep.equal([ISSUE]);
    expect(pxDeep(r.reposMerged)).to.deep.equal([GOV, CODE_DIR]);
    // merged into project branch in both repos, then archived (tag + delete)
    expect(log.filter((l) => l.startsWith("merge "))).to.have.lengthOf(2);
    expect(log).to.include(`tag ${GOV} archive/${TASK_ID}`);
    expect(log).to.include(`pushDelete ${GOV} ${TASK_ID}`);
    expect(acted[0]).to.match(/^close .*issues\/123 :: Task `BRNCH-43.*` merged/);
    expect(acted).to.include(`status ${ISSUE} Done`);
  });

  it("is idempotent: an already-merged sub-branch is skipped, still archived", () => {
    const { vcs, log } = fakeVcs({ alreadyMerged: true });
    const r = merge({ board: fakeBoard(), authorize: () => true,vcs, fs: fsPresent(true), issues: fakeIssues().issues }, CONFIG, input());
    expect(r.ok).to.equal(true);
    expect(log.some((l) => l.startsWith("merge "))).to.equal(false); // no merge performed
    expect(log).to.include(`tag ${GOV} archive/${TASK_ID}`); // but archived
  });

  it("stops on a merge conflict (rc=2) without archiving", () => {
    const { vcs, log } = fakeVcs({ conflict: true });
    const r = merge({ board: fakeBoard(), authorize: () => true,vcs, fs: fsPresent(true), issues: fakeIssues().issues }, CONFIG, input());
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.code).to.equal(2);
    expect(r.reason).to.equal("merge-conflict");
    expect(r.repoDir).to.equal(GOV);
    expect(log.some((l) => l.startsWith("tag "))).to.equal(false); // nothing archived
  });

  it("refuses a dirty working tree", () => {
    const r = merge({ board: fakeBoard(), authorize: () => true,vcs: fakeVcs({ dirty: true }).vcs, fs: fsPresent(true), issues: fakeIssues().issues }, CONFIG, input());
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("dirty");
  });

  it("refuses when the sub-branch isn't on the remote", () => {
    const r = merge({ board: fakeBoard(), authorize: () => true,vcs: fakeVcs({ hasRemoteTask: false }).vcs, fs: fsPresent(true), issues: fakeIssues().issues }, CONFIG, input());
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("no-subbranch");
  });

  it("accepts a task-branch arg and resolves its issues via the board", () => {
    const { issues } = fakeIssues();
    const resolved: Issues = { ...issues, resolveIssueUrl: (_ref, n) => `https://x/issues/${n}` };
    const r = merge({ board: fakeBoard(), authorize: () => true,vcs: fakeVcs().vcs, fs: fsPresent(true), issues: resolved }, CONFIG, input(`${TASK_ID}`));
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.issueUrls).to.deep.equal(["https://x/issues/123"]);
  });
});

/**
 * WHAT GOVERNED THIS CHANGE (design §10.10).
 *
 * Every test here is about a way the stamp could make things worse: failing a merge that has already landed,
 * looking for a pull request after the branch it is found by has been deleted, or reporting success when it
 * recorded nothing.
 */
describe("merge — the governance stamp", () => {
  const STAMP = ["<!-- gov:governed-by -->", "`gov-rules-hash: aaaabbbbccccdddd`", "<!-- /gov:governed-by -->"];

  it("stamps the pull request in every repo the merge touched", () => {
    const seen: { repoDir: string; head: string }[] = [];
    const r = merge({
      board: fakeBoard(), authorize: () => true, vcs: fakeVcs().vcs, fs: fsPresent(true), issues: fakeIssues().issues,
      stamp: () => ({ lines: STAMP }),
      stampPr: (repoDir, head) => { seen.push({ repoDir, head }); return "stamped"; },
    }, CONFIG, input());
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(pxDeep(seen.map((s) => s.repoDir))).to.deep.equal([GOV, CODE_DIR]);
    expect(seen.every((s) => s.head === TASK_ID)).to.equal(true);
    expect(r.stamp!.placed.map((p) => p.outcome)).to.deep.equal(["stamped", "stamped"]);
  });

  it("stamps BEFORE archiving — a pull request is found by its head branch, and archiving deletes it", () => {
    const order: string[] = [];
    const { vcs } = fakeVcs();
    const watched = { ...vcs, tag: (r: string, t: string) => order.push(`tag ${r} ${t}`) };
    merge({
      board: fakeBoard(), authorize: () => true, vcs: watched, fs: fsPresent(true), issues: fakeIssues().issues,
      stamp: () => ({ lines: STAMP }),
      stampPr: () => { order.push("stamp"); return "stamped"; },
    }, CONFIG, input());
    expect(order[0], "stamping after the archive would find no branch and report 'no pull request'").to.equal("stamp");
  });

  it("a task with no pull request is not a failure — the facts are carried by the result instead", () => {
    const r = merge({
      board: fakeBoard(), authorize: () => true, vcs: fakeVcs().vcs, fs: fsPresent(true), issues: fakeIssues().issues,
      stamp: () => ({ lines: STAMP }),
      stampPr: () => "no-pr",
    }, CONFIG, input());
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.stamp!.lines).to.deep.equal(STAMP);
    expect(r.stamp!.placed.every((p) => p.outcome === "no-pr")).to.equal(true);
  });

  it("an uncomputable stamp does NOT fail the merge — the work has already landed", () => {
    const r = merge({
      board: fakeBoard(), authorize: () => true, vcs: fakeVcs().vcs, fs: fsPresent(true), issues: fakeIssues().issues,
      stamp: () => ({ error: "this workspace has never run `gov rules build`" }),
      stampPr: () => "stamped",
    }, CONFIG, input());
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.stamp!.error).to.contain("never run");
    expect(r.stamp!.placed).to.deep.equal([]);
  });

  it("a pull request that could not be edited is reported, and the merge still succeeds", () => {
    const r = merge({
      board: fakeBoard(), authorize: () => true, vcs: fakeVcs().vcs, fs: fsPresent(true), issues: fakeIssues().issues,
      stamp: () => ({ lines: STAMP }),
      stampPr: () => "failed",
    }, CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.stamp!.placed.every((p) => p.outcome === "failed")).to.equal(true);
  });

  it("with no stamp port wired, merge behaves exactly as it did before §10.10", () => {
    const r = merge({ board: fakeBoard(), authorize: () => true, vcs: fakeVcs().vcs, fs: fsPresent(true), issues: fakeIssues().issues }, CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.stamp).to.equal(undefined);
  });

  it("nothing is stamped when the merge never completed — a conflict leaves no record to make", () => {
    let called = false;
    merge({
      board: fakeBoard(), authorize: () => true, vcs: fakeVcs({ conflict: true }).vcs, fs: fsPresent(true), issues: fakeIssues().issues,
      stamp: () => { called = true; return { lines: STAMP }; },
    }, CONFIG, input());
    expect(called).to.equal(false);
  });
});
