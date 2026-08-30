// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { deriveStatus, pause, resume, cancel, type StateConfig, type StateInput, type StateDeps } from "../../src/lifecycle/state.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { AnchorCreator, AnchorStateLabel } from "../../src/lifecycle/anchor.js";
import type { Issues } from "../../src/lifecycle/issues.js";

describe("prj-work Phase 2 — deriveStatus (SDD-020)", () => {
  it("maps board state × anchor labels to status", () => {
    expect(deriveStatus(true, [])).to.equal("active");
    expect(deriveStatus(true, ["paused"])).to.equal("paused");
    expect(deriveStatus(false, [])).to.equal("completed");
    expect(deriveStatus(false, ["cancelled"])).to.equal("cancelled");
    // cancelled wins over completed when the board is closed
    expect(deriveStatus(false, ["cancelled", "paused"])).to.equal("cancelled");
  });
});

const CONFIG: StateConfig = { githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work" };
const INPUT: StateInput = { govClone: "/awr/PRJ-43/svm-prj-work" };

function fakeVcs(branch = "BRNCH-43-governance-common-project"): Vcs {
  return {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h",
    refExists: () => false, lsRemoteHeads: () => [], defaultBranch: () => null, revParse: () => null,
    currentBranch: () => branch, isAncestor: () => false, isClean: () => true, remoteBranchesMatching: () => [],
    addPath: () => {}, commit: () => {}, resetHard: () => {}, resetKeepingFiles: () => {}, cleanUntracked: () => {},
    worktreeAdd: () => {}, worktreeRemove: () => {}, branchDelete: () => {}, push: () => {}, pushDelete: () => {},
    clone: () => {}, fetch: () => {}, setIdentity: () => {}, checkout: () => {}, checkoutNew: () => {},
    mergeNoEdit: () => "merged", tag: () => {},
  };
}
function fakeAnchor() {
  const calls: string[] = [];
  const anchor: AnchorCreator = {
    createAnchorIssue: () => null,
    setState: (ref, _ws, label: AnchorStateLabel, action) => {
      calls.push(`${action} ${label} #${ref.number}`);
      return true;
    },
    find: () => null,
    setAssignee: () => true,
  };
  return { anchor, calls };
}
function fakeIssues() {
  const calls: string[] = [];
  const issues: Issues = {
    state: () => "OPEN", assign: () => {}, setBoardStatus: () => {}, close: () => {},
    resolveIssueUrl: () => null, closeBoard: (r) => calls.push(`closeBoard ${r.number}`),
  };
  return { issues, calls };
}
function deps(vcs = fakeVcs()): { deps: StateDeps; anchorCalls: string[]; issueCalls: string[] } {
  const a = fakeAnchor();
  const i = fakeIssues();
  return { deps: { vcs, anchor: a.anchor, issues: i.issues, authorize: () => true }, anchorCalls: a.calls, issueCalls: i.calls };
}

describe("prj-work Phase 2 — pause / resume / cancel", () => {
  it("pause adds the paused label (board stays open → paused)", () => {
    const { deps: d, anchorCalls } = deps();
    const r = pause(d, CONFIG, INPUT);
    expect(r).to.deep.equal({ ok: true, status: "paused", boardNumber: 43, applied: true });
    expect(anchorCalls).to.deep.equal(["add paused #43"]);
  });

  it("resume removes the paused label → active", () => {
    const { deps: d, anchorCalls } = deps();
    const r = resume(d, CONFIG, INPUT);
    expect(r).to.include({ ok: true, status: "active" });
    expect(anchorCalls).to.deep.equal(["remove paused #43"]);
  });

  it("cancel adds the cancelled label AND closes the board → cancelled", () => {
    const { deps: d, anchorCalls, issueCalls } = deps();
    const r = cancel(d, CONFIG, INPUT);
    expect(r).to.include({ ok: true, status: "cancelled" });
    expect(anchorCalls).to.deep.equal(["add cancelled #43"]);
    expect(issueCalls).to.deep.equal(["closeBoard 43"]);
  });

  it("refuses off a non-project branch", () => {
    const r = pause(deps(fakeVcs("main")).deps, CONFIG, INPUT);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("not-a-project-branch");
  });

  it("honors an authorization deny", () => {
    const { deps: base } = deps();
    const r = cancel({ ...base, authorize: () => false }, CONFIG, INPUT);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("unauthorized");
  });
});
