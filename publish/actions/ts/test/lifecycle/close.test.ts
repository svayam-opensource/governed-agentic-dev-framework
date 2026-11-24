// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { close, type CloseConfig, type CloseInput, type CloseDeps } from "../../src/lifecycle/close.js";
import { closeGate } from "../../src/lifecycle/close-gate.js";
import { createGhPulls } from "../../src/lifecycle/pulls.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { BoardWriter } from "../../src/ports/work-tracker.js";
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
    fetchDefault: () => "remote-sha",
    setIdentity: () => {},
    checkout: () => {},
    checkoutNew: () => {},
    mergeNoEdit: (r) => (opts.syncConflict && r === GOV ? "conflict" : "merged"),
    tag: (r, t) => log.push(`tag ${r} ${t}`),
  };
  return { vcs, log };
}
/** Closing the board goes through the WorkTrackerPort (gadf#225). */
function fakeTracker() {
  const acted: string[] = [];
  const tracker: BoardWriter = {
    setState: () => ({ ok: true }),
    closeProject: (r) => { acted.push(`closeBoard ${r.number}`); return { ok: true }; },
  };
  return { acted, tracker };
}
/** `null` — gov could not read the PR — is the state that lets close take its ordinary path. */
const fakePulls = (state: PrState = null): Pulls => ({
  create: () => "https://github.com/Svayamtech/svm-prj-work/pull/1",
  state: () => state,
});

describe("prj-work Phase 2 — close orchestrator (model A)", () => {
  function deps(over: Partial<CloseDeps> = {}): CloseDeps {
    return { board: fakeBoard(), vcs: fakeVcs().vcs, fs: fakeFs(), pulls: fakePulls(), authorize: () => true, gate: () => ({ ok: true, failures: [] }), ...over };
  }

  it("gates → merges → PR-promotes → closes board → archives (happy path)", () => {
    const v = fakeVcs();
    const iss = fakeTracker();
    const r = close(deps({ vcs: v.vcs, tracker: iss.tracker }), CONFIG, input());
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

  it("gadf#225: a board that will not close is REPORTED — close still succeeds, never silently", () => {
    const tracker: BoardWriter = { setState: () => ({ ok: true }), closeProject: () => ({ ok: false, why: "denied", detail: "HTTP 403" }) };
    const r = close(deps({ tracker }), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.boardClosed).to.deep.equal({ ok: false, why: "denied", detail: "HTTP 403" });
    const unwired = close(deps(), CONFIG, input());
    if (unwired.ok) expect(unwired.boardClosed).to.include({ ok: false, why: "unreachable" });
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

// F154 A: the policy change's pull request number is written by the AUTHOR, the moment close has opened the PR —
// never left for CI, whose commit would hold a private repository's workflows at "waiting for approval to run".
describe("close names the policy change's pull request in the author's commit (F154 A)", () => {
  function recordingVcs() {
    const v = fakeVcs();
    const steps: string[] = [];
    const vcs: Vcs = {
      ...v.vcs,
      addPath: (r, p) => steps.push(`add ${r} ${p}`),
      commit: (r, m) => steps.push(`commit ${r} ${m.split("\n")[0]}`),
      push: (r, rm, b) => { steps.push(`push ${r} ${b}`); v.vcs.push(r, rm, b); },
    };
    return { vcs, steps };
  }
  const base = (over: Partial<CloseDeps>): CloseDeps => ({ board: fakeBoard(), vcs: fakeVcs().vcs, fs: fakeFs(), pulls: fakePulls(), authorize: () => true, gate: () => ({ ok: true, failures: [] }), ...over });

  it("after the PR opens: called with its number; what it wrote is committed and pushed to the project branch", () => {
    const v = recordingVcs();
    const asked: number[] = [];
    const r = close(base({ vcs: v.vcs, numberPolicyPr: (pr) => { asked.push(pr); return { wrote: ["policies/CHANGELOG.md", "policies/rules/rules.yaml"] }; } }), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(asked).to.deep.equal([1]);
    expect(r.policyNumbered).to.deep.equal({ ok: true, pr: 1, wrote: ["policies/CHANGELOG.md", "policies/rules/rules.yaml"] });
    const tail = pxAll(v.steps).slice(pxAll(v.steps).indexOf(`push ${GOV} BRNCH-43-governance-common-project`) + 1);
    expect(tail.slice(0, 3), "right after the PR opens — before the code repos archive").to.deep.equal([
      `add ${GOV} policies`,
      `commit ${GOV} gov close: name pull request #1 in the policy change`,
      `push ${GOV} BRNCH-43-governance-common-project`,
    ]);
  });

  it("nothing to write (policies/ untouched, or propose never ran) → no commit, nothing reported", () => {
    const v = recordingVcs();
    const r = close(base({ vcs: v.vcs, numberPolicyPr: () => ({ wrote: [] }) }), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.policyNumbered).to.equal(undefined);
    expect(v.steps.some((s) => s.startsWith("commit"))).to.equal(false);
  });

  it("a writer error or a failing push is REPORTED, never thrown — the project is closed either way", () => {
    const err = close(base({ numberPolicyPr: () => ({ error: "the merge-base could not be read" }) }), CONFIG, input());
    expect(err.ok).to.equal(true);
    if (err.ok) expect(err.policyNumbered).to.deep.equal({ ok: false, pr: 1, why: "the merge-base could not be read" });
    const v = recordingVcs();
    const throwing: Vcs = { ...v.vcs, commit: () => { throw new Error("git commit failed: nothing staged"); } };
    const r = close(base({ vcs: throwing, numberPolicyPr: () => ({ wrote: ["policies/CHANGELOG.md"] }) }), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.policyNumbered).to.deep.equal({ ok: false, pr: 1, why: "git commit failed: nothing staged" });
  });

  it("without the dep, close is what it was — no policy step", () => {
    const r = close(base({}), CONFIG, input());
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.policyNumbered).to.equal(undefined);
  });
});
