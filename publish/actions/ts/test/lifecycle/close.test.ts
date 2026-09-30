// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { close, type CloseConfig, type CloseInput, type CloseDeps } from "../../src/lifecycle/close.js";
import { closeGate } from "../../src/lifecycle/close-gate.js";
import { createGhPulls } from "../../src/lifecycle/pulls.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { Pulls, PrState } from "../../src/lifecycle/pulls.js";
import { px, pxAll, pxDeep } from "../helpers/paths.js";

/** An Fs whose knowledge/ presence is configurable. */
function fakeFs(over: { files?: string[]; knowledgeDir?: boolean } = {}): Fs {
  const files = over.files ?? ["compliance.md", "notes.md"];
  return {
    pathExists: (p) => (px(p).endsWith("/knowledge") ? (over.knowledgeDir ?? true) : true),
    mkdirp: () => {},
    writeFile: () => {},
    readFile: () => null,
    rm: () => {},
    readdir: () => files,
  };
}

describe("closeGate — the framework's own conditions, and ONLY those", () => {
  it("passes a project whose knowledge/ exists, however sparse it is", () => {
    expect(closeGate(fakeFs({ files: ["todo.md"] }), "/p")).to.deep.equal({ ok: true, failures: [] });
  });

  // THE RULING (Policy Owner, 2026-09-27): knowledge curation is the organization's decision. It used to be
  // hardcoded here — five exact headings in a knowledge-close.md that `gov seed` never creates — which made a
  // human-only project unclosable, at the end of the project, with a message pointing at an agent protocol.
  it("does NOT require compliance.md — whether a project may close without one is a policy choice", () => {
    expect(closeGate(fakeFs({ files: ["todo.md"] }), "/p").ok).to.equal(true);
  });
  it("does NOT require a knowledge-close manifest, or any heading in one", () => {
    const r = closeGate(fakeFs({ files: ["todo.md"] }), "/p");
    expect(r.failures.join(" ")).to.not.match(/knowledge-close|Harvest|Completeness critic/);
  });
  it("does NOT judge an empty knowledge/ — only an ABSENT one, because close promotes that directory", () => {
    expect(closeGate(fakeFs({ files: [] }), "/p").ok, "empty is the organization's business").to.equal(true);
    const absent = closeGate(fakeFs({ knowledgeDir: false }), "/p");
    expect(absent.ok).to.equal(false);
    expect(absent.failures[0], "the message names the directory and how to get one").to.match(/knowledge\/ does not exist/);
    expect(absent.failures[0]).to.not.match(/Protocol/);
  });
});

describe("prj-work Phase 2 — Pulls gh adapter", () => {
  /**
   * `merge()` IS GONE, and that is the subject of this block now. It shelled to `gh pr merge --merge --admin` —
   * the administrator override of the approving review that `gov repo protect` installs — and close called it on
   * a pull request this file's own header called "the governance review point". The Policy Owner's ruling of
   * 2026-09-30: a code repo's branch returns to its source branch as an authorized automatic merge, and the
   * governance repo's branch is a pull request a HUMAN merges. So gov reads the state and never sets it.
   */
  it("create returns the PR url", () => {
    const pulls = createGhPulls((args) => (args[1] === "create" ? "https://github.com/O/r/pull/9\n" : ""));
    expect(pulls.create("O/r", "main", "BR", "t", "b")).to.equal("https://github.com/O/r/pull/9");
  });

  it("never shells to `gh pr merge`, with or without --admin", () => {
    // The regression, asserted on the arguments rather than on the outcome: an override is a thing gov DOES, so
    // the only durable check is that the command is never issued.
    const issued: string[][] = [];
    const pulls = createGhPulls((args) => { issued.push([...args]); return "OPEN"; });
    pulls.create("O/r", "main", "BR", "t", "b");
    pulls.state("O/r", "BR");
    const verbs = issued.map((a) => a.slice(0, 2).join(" "));
    expect(verbs, "no merge verb at all").to.not.include("pr merge");
    expect(issued.flat(), "and nothing carries the admin override").to.not.include("--admin");
  });

  it("reads merged, open and closed", () => {
    for (const [raw, want] of [["MERGED", "merged"], ["OPEN", "open"], ["CLOSED", "closed"]] as const) {
      expect(createGhPulls(() => raw).state("O/r", "BR"), raw).to.equal(want);
    }
  });

  it("an UNREADABLE state is null, never 'open'", () => {
    // The asymmetry that matters: close deletes the branch only on `merged`. If a failed read collapsed to
    // "open" the caller would wait forever; if it collapsed to "merged" it would delete the head branch of a
    // live pull request and close it unmerged, losing the proposal.
    expect(createGhPulls(() => { throw new Error("gh exploded"); }).state("O/r", "BR")).to.equal(null);
    expect(createGhPulls(() => "SOMETHING_NEW").state("O/r", "BR"), "a state gh grew").to.equal(null);
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
    // The base exists; no project branch yet — the ordinary case the preflight sees.
    lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }],
    defaultBranch: () => null,
    revParse: () => null,
    currentBranch: () => "BRNCH-43-governance-common-project",
    isAncestor: () => false,
    isClean: () => true,
    remoteBranchesMatching: () => opts.openTasks ?? [],
    addPath: () => {},
    commit: () => {},
    resetHard: () => {}, resetKeepingFiles: () => {},
    cleanUntracked: () => {},
    worktreeAdd: () => {}, worktreeAddExisting: () => {},
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
/** `null` — gov could not read the PR — is the state that lets close take its ordinary path. */
const fakePulls = (state: PrState = null): Pulls => ({
  create: () => "https://github.com/Svayamtech/svm-prj-work/pull/1",
  state: () => state,
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
    expect(pxDeep(r.reposMerged)).to.deep.equal([CODE_DIR]);
    // pushed code base + project branch, closed board, archived THE CODE REPO ONLY
    expect(pxAll(v.log)).to.include("push /awr/PRJ-43/911-SVM-LIB-SVC dev");
    expect(pxAll(v.log)).to.include(`push ${GOV} BRNCH-43-governance-common-project`);
    expect(iss.acted).to.include("closeBoard 43");
    expect(pxAll(v.log)).to.include(`tag ${CODE_DIR} archive/BRNCH-43-governance-common-project`);
    // AND NOT THE GOVERNANCE BRANCH. It is the open PR's head; archiving deletes the remote branch, which closes
    // that PR unmerged and loses the knowledge proposal. A later run archives it once a person has merged.
    expect(pxAll(v.log)).to.not.include(`tag ${GOV} archive/BRNCH-43-governance-common-project`);
  });

  it("fails the structural pre-close gate before touching anything", () => {
    const v = fakeVcs();
    const r = close(deps({ vcs: v.vcs, fs: fakeFs({ knowledgeDir: false }) }), CONFIG, input());
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

  it("LEAVES the governance branch and says a person merges it", () => {
    const v = fakeVcs();
    const r = close(deps({ vcs: v.vcs }), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.awaitingReview, "the project is complete AND the proposal is pending").to.equal(true);
    // The branch is the open PR's head. Tagging or deleting it would close that PR unmerged.
    // Filter on the GOV CLONE's path, not on a guess about the line's shape — the first version of this filter
    // excluded lines containing "code", which no line contains, so it caught the code repo's archive instead.
    const govTouch = pxAll(v.log).filter((l) => /^(tag|branchDelete) /.test(l) && l.includes(GOV));
    expect(govTouch, `the governance branch must survive — saw ${govTouch.join(", ")}`).to.deep.equal([]);
  });

  it("archives the governance branch on a LATER run, once a person has merged", () => {
    const v = fakeVcs();
    const r = close(deps({ vcs: v.vcs, pulls: fakePulls("merged") }), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.archivedOnly).to.equal(true);
    expect(v.log.some((l) => l.startsWith("tag")), "tagged before deleting").to.equal(true);
  });

  it("an OPEN PR reports awaiting-review and changes nothing", () => {
    const v = fakeVcs();
    const r = close(deps({ vcs: v.vcs, pulls: fakePulls("open") }), CONFIG, input());
    expect(r.ok).to.equal(false);
    if (!r.ok) {
      expect(r.reason).to.equal("awaiting-review");
      expect(r.message, "and says the board is already closed, so nobody re-runs looking for that").to.contain("board is already closed");
    }
    expect(v.log.some((l) => l.startsWith("push")), "nothing pushed on a re-run").to.equal(false);
  });

  it("an UNREADABLE PR state does NOT archive — it proceeds as an ordinary close", () => {
    // Treating an unreadable state as merged would delete a live PR's head branch. The fixture's default is null,
    // so this is the same path every other test above exercises; asserted explicitly because it is a safety
    // property and not an accident of the fixture.
    const r = close(deps({ pulls: fakePulls(null) }), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.archivedOnly, "no archive-only shortcut was taken").to.equal(undefined);
  });
});
