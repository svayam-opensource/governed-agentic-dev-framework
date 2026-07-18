// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { close, type CloseConfig, type CloseInput, type CloseDeps } from "../../src/lifecycle/close.js";
import { closeGate, KNOWLEDGE_CLOSE_SECTIONS } from "../../src/lifecycle/close-gate.js";
import { createGhPulls } from "../../src/lifecycle/pulls.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { Pulls } from "../../src/lifecycle/pulls.js";

const GOOD_MANIFEST = KNOWLEDGE_CLOSE_SECTIONS.map((s) => `${s}\n- done\n`).join("\n");

/** An Fs whose knowledge/ contents are configurable. */
function fakeFs(over: { files?: string[]; compliance?: boolean; manifest?: string | null } = {}): Fs {
  const files = over.files ?? ["compliance.md", "knowledge-close.md", "notes.md"];
  return {
    pathExists: (p) => (p.endsWith("/compliance.md") ? (over.compliance ?? true) : true),
    mkdirp: () => {},
    writeFile: () => {},
    readFile: (p) => (p.endsWith("knowledge-close.md") ? (over.manifest === undefined ? GOOD_MANIFEST : over.manifest) : null),
    rm: () => {},
    readdir: () => files,
  };
}

describe("prj-work Phase 2 — closeGate (knowledge, model A)", () => {
  it("passes a complete knowledge dir", () => {
    expect(closeGate(fakeFs(), "/p")).to.deep.equal({ ok: true, failures: [] });
  });
  it("fails on empty knowledge/, missing compliance.md, or missing manifest", () => {
    const r = closeGate(fakeFs({ files: [], compliance: false, manifest: null }), "/p");
    expect(r.ok).to.equal(false);
    expect(r.failures).to.have.length.greaterThan(2);
  });
  it("fails on a missing section or a TBD placeholder", () => {
    expect(closeGate(fakeFs({ manifest: "## Discarded\n- x" }), "/p").ok).to.equal(false);
    expect(closeGate(fakeFs({ manifest: GOOD_MANIFEST + "\nTODO: finish" }), "/p").failures.some((f) => /placeholder/.test(f))).to.equal(true);
  });
});

describe("prj-work Phase 2 — Pulls gh adapter", () => {
  it("create returns the PR url; merge reports merged", () => {
    const pulls = createGhPulls((args) => {
      if (args[1] === "create") return "https://github.com/O/r/pull/9\n";
      if (args[1] === "merge") return "";
      return "";
    });
    expect(pulls.create("O/r", "main", "BR", "t", "b")).to.equal("https://github.com/O/r/pull/9");
    expect(pulls.merge("O/r", "BR")).to.equal("merged");
  });
  it("merge treats an already-merged PR as success", () => {
    const pulls = createGhPulls((args) => {
      if (args[1] === "merge") throw new Error("not mergeable");
      if (args[1] === "view") return "MERGED";
      return "";
    });
    expect(pulls.merge("O/r", "BR")).to.equal("already-merged");
  });
});

const CONFIG: CloseConfig = {
  githubOrg: "Svayamtech",
  workspaceRepo: "svm-prj-work",
  defaultBranch: "main",
  defaultCodeBranch: "dev",
  remote: "origin",
};
const GOV = "/awr/PRJ-43/svm-prj-work";
const CODE_DIR = "/awr/PRJ-43/911-SVM-LIB-SVC";
const input = (): CloseInput => ({ govClone: GOV, projectWorkRoot: "/awr/PRJ-43", today: "2026-07-03" });

function fakeBoard(): Board {
  return { fetchProject: () => ({ id: "P", title: "T", shortDescription: null, linkedItemCount: 1, repoUrls: ["https://github.com/Svayamtech/911-SVM-LIB-SVC"] }) };
}
function fakeVcs(opts: { openTasks?: string[]; syncConflict?: boolean } = {}) {
  const log: string[] = [];
  const vcs: Vcs = {
    localBranchExists: () => false,
    remoteBranchExists: () => true,
    headSha: () => "h",
    refExists: () => false,
    lsRemoteHeads: () => [],
    defaultBranch: () => null,
    revParse: () => null,
    currentBranch: () => "BRNCH-43-governance-common-project",
    isAncestor: () => false,
    isClean: () => true,
    remoteBranchesMatching: () => opts.openTasks ?? [],
    addPath: () => {},
    commit: () => {},
    resetHard: () => {},
    cleanUntracked: () => {},
    worktreeAdd: () => {},
    worktreeRemove: () => {},
    branchDelete: () => {},
    push: (r, _rm, b) => log.push(`push ${r} ${b}`),
    pushDelete: () => {},
    clone: () => {},
    fetch: () => {},
    setIdentity: () => {},
    checkout: () => {},
    checkoutNew: () => {},
    mergeNoEdit: (r) => (opts.syncConflict && r === GOV ? "conflict" : "merged"),
    tag: (r, t) => log.push(`tag ${r} ${t}`),
  };
  return { vcs, log };
}
function fakeIssues() {
  const acted: string[] = [];
  const issues: Issues = {
    state: () => "OPEN",
    assign: () => {},
    setBoardStatus: () => {},
    close: () => {},
    resolveIssueUrl: () => null,
    closeBoard: (r) => acted.push(`closeBoard ${r.number}`),
  };
  return { issues, acted };
}
const fakePulls = (mergeOutcome: "merged" | "already-merged" | "failed" = "merged"): Pulls => ({
  create: () => "https://github.com/Svayamtech/svm-prj-work/pull/1",
  merge: () => mergeOutcome,
});

describe("prj-work Phase 2 — close orchestrator (model A)", () => {
  function deps(over: Partial<CloseDeps> = {}): CloseDeps {
    return { board: fakeBoard(), vcs: fakeVcs().vcs, fs: fakeFs(), issues: fakeIssues().issues, pulls: fakePulls(), authorize: () => true, gate: () => ({ ok: true, failures: [] }), ...over };
  }

  it("gates → merges → PR-promotes → closes board → archives (happy path)", () => {
    const v = fakeVcs();
    const iss = fakeIssues();
    const r = close(deps({ vcs: v.vcs, issues: iss.issues }), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.projectId).to.equal("PRJ-43-governance-common-project");
    expect(r.prUrl).to.equal("https://github.com/Svayamtech/svm-prj-work/pull/1");
    expect(r.reposMerged).to.deep.equal([CODE_DIR]);
    // pushed code base + project branch, closed board, archived both repos
    expect(v.log).to.include("push /awr/PRJ-43/911-SVM-LIB-SVC dev");
    expect(v.log).to.include(`push ${GOV} BRNCH-43-governance-common-project`);
    expect(iss.acted).to.include("closeBoard 43");
    expect(v.log).to.include(`tag ${GOV} archive/BRNCH-43-governance-common-project`);
    expect(v.log).to.include(`tag ${CODE_DIR} archive/BRNCH-43-governance-common-project`);
  });

  it("fails the knowledge gate before touching anything", () => {
    const v = fakeVcs();
    const r = close(deps({ vcs: v.vcs, fs: fakeFs({ manifest: null }) }), CONFIG, input());
    expect(r.ok).to.equal(false);
    if (!r.ok) {
      expect(r.reason).to.equal("knowledge-gate");
      expect(r.failures).to.not.be.empty;
    }
    expect(v.log.some((l) => l.startsWith("push"))).to.equal(false); // nothing shipped
  });

  it("refuses when unmerged task sub-branches remain", () => {
    const r = close(deps({ vcs: fakeVcs({ openTasks: ["BRNCH-43-governance-common-project.ISSUE-5"] }).vcs }), CONFIG, input());
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("open-tasks");
  });

  it("stops on a sync conflict (rc=2) before any push", () => {
    const v = fakeVcs({ syncConflict: true });
    const r = close(deps({ vcs: v.vcs }), CONFIG, input());
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("sync-conflict");
    expect(v.log.some((l) => l.startsWith("push"))).to.equal(false);
  });

  it("honors the injected test-merge gate (nothing pushed on failure)", () => {
    const v = fakeVcs();
    const r = close(deps({ vcs: v.vcs, gate: () => ({ ok: false, failures: ["validator X failed"] }) }), CONFIG, input());
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("test-merge-gate");
    expect(v.log.some((l) => l.startsWith("push"))).to.equal(false);
  });

  it("reports a failed PR merge", () => {
    const r = close(deps({ pulls: fakePulls("failed") }), CONFIG, input());
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("pr-merge-failed");
  });
});
