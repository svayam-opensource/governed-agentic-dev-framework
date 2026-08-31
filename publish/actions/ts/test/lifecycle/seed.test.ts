// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { seed, type SeedConfig, type SeedInput, type SeedDeps } from "../../src/lifecycle/seed.js";
import { createNodeFs } from "../../src/lifecycle/fs-io.js";
import type { Board, BoardProject } from "../../src/lifecycle/board.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";
import { px, pxAll, pxDeep } from "../helpers/paths.js";

const CONFIG: SeedConfig = {
  govHome: "/gov",
  workspaceRepo: "svm-prj-work",
  agentWorkRoot: "/awr",
  defaultBranch: "main",
  defaultCodeBranch: "dev",
  githubOrg: "Svayamtech",
  orgTokens: { ORG_NAME: "Svayam" },
  toolFiles: [],
  remote: "origin",
};
const INPUT: SeedInput = {
  boardUrl: "https://github.com/orgs/Svayamtech/projects/43",
  assignee: "svayam-rkant",
  seededBy: "rkant@svayam.ai",
  today: "2026-07-03",
  identity: { name: "rk", email: "rk@x" },
  seederLogin: "svayam-rkant",
};
const CODE_REPO = "https://github.com/Svayamtech/911-SVM-LIB-SVC";
const ORG_GOV_CLONE = "/awr/PRJ-43-governance-common-project/svm-prj-work";

function fakeBoard(over: Partial<BoardProject> = {}): Board {
  return {
    fetchProject: () => ({
      id: "PVT",
      title: "@Governance Common Project",
      shortDescription: "d",
      linkedItemCount: 3,
      repoUrls: [CODE_REPO],
      ...over,
    }),
  };
}

/** A recording fake Vcs; push throws for any dir in `throwPushFor`. */
function fakeVcs(opts: { throwPushFor?: string[]; leftoverLocalBranch?: boolean } = {}) {
  const log: string[] = [];
  // Record NORMALISED: production composes dirs with `path.join`, so on Windows every line would read
  // `worktreeAdd \awr\...` and no assertion below — nor `throwPushFor` — would recognise its own target.
  const rec = (line: string) => log.push(px(line));
  const vcs: Vcs = {
    localBranchExists: () => opts.leftoverLocalBranch ?? false,
    remoteBranchExists: () => false,
    headSha: () => "presha",
    refExists: (_r, ref) => ref === "refs/remotes/origin/dev",
    lsRemoteHeads: () => [],
    // The base exists; no project branch yet — the ordinary case the preflight sees.
    lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }],
    defaultBranch: () => null,
    revParse: () => null,
    currentBranch: () => "main",
    isAncestor: () => false,
    isClean: () => true,
    remoteBranchesMatching: () => [],
    checkout: (r) => rec(`checkout ${r}`),
    checkoutNew: (r) => rec(`checkoutNew ${r}`),
    mergeNoEdit: () => "merged",
    tag: () => {},
    addPath: (r) => rec(`addPath ${r}`),
    commit: (r, m) => rec(`commit ${r} :: ${m}`),
    resetHard: (r, s) => rec(`resetHard ${r} ${s}`),
    resetKeepingFiles: (r, s) => rec(`resetKeepingFiles ${r} ${s}`),
    cleanUntracked: (r, p) => rec(`clean ${r} ${p}`),
    worktreeAdd: (_b, br, wt) => rec(`worktreeAdd ${wt} ${br}`),
    worktreeAddExisting: (_b, br, wt) => rec(`worktreeAddExisting ${wt} ${br}`),
    worktreeRemove: (_b, wt) => rec(`worktreeRemove ${wt}`),
    branchDelete: (_r, br) => rec(`branchDelete ${br}`),
    push: (r, _rm, br) => {
      if (opts.throwPushFor?.includes(px(r))) throw new Error(`push failed: ${r}`);
      rec(`push ${r} ${br}`);
    },
    pushDelete: (r) => rec(`pushDelete ${r}`),
    clone: () => {},
    fetch: () => {},
    setIdentity: (r) => rec(`setIdentity ${r}`),
  };
  return { vcs, log };
}

/** A recording in-memory Fs. `existing` paths report as present. */
function fakeFs(existing: Set<string> = new Set()) {
  const writes: string[] = [];
  const removed: string[] = [];
  const fsPort: Fs = {
    pathExists: (p) => existing.has(px(p)),
    mkdirp: () => {},
    writeFile: (f) => writes.push(px(f)),
    readFile: () => null, // no todo template / tool files in these tests
    // Deletion is MODELLED, not ignored: an undo that removes the wrong path is
    // exactly the defect #191 records, and a no-op rm cannot express it.
    rm: (f) => { removed.push(px(f)); existing.delete(px(f)); },
    readdir: () => [],
  };
  return { fsPort, writes, removed, existing };
}

const fakeAnchor = (ref: string | null = "Svayamtech/svm-prj-work#1"): AnchorCreator => ({
  createAnchorIssue: () => ref,
  setState: () => true,
  find: () => null,
  setAssignee: () => true,
});

describe("prj-work Phase 2 — seed orchestrator", () => {
  it("happy path: seeds, scaffolds, worktrees, pushes, anchors — no rollback", () => {
    const { vcs, log } = fakeVcs();
    const { fsPort, writes } = fakeFs();
    const cloned: string[] = [];
    const deps: SeedDeps = {
      board: fakeBoard(),
      vcs,
      fs: fsPort,
      anchor: fakeAnchor(),
      cloneRepo: (_u, d) => cloned.push(d),
    };
    const r = seed(deps, CONFIG, INPUT);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.projectId).to.equal("PRJ-43-governance-common-project");
    expect(r.branch).to.equal("BRNCH-43-governance-common-project");
    expect(px(r.orgGovClone)).to.equal(ORG_GOV_CLONE);
    expect(pxDeep(r.repos)).to.deep.equal([
      { name: "911-SVM-LIB-SVC", url: CODE_REPO, repoDir: "/awr/PRJ-43-governance-common-project/911-SVM-LIB-SVC" },
    ]);
    expect(r.anchorRef).to.equal("Svayamtech/svm-prj-work#1");

    // wrote authored content — agent.md — but NO project.yaml (GitHub is SoT)
    expect(writes.some((w) => w.endsWith("/agent.md"))).to.equal(true);
    expect(writes.some((w) => w.endsWith("/project.yaml"))).to.equal(false);
    // seed folds in the project-ROOT harness so an agent launched at <project> runs session-start:
    expect(writes.some((w) => w.endsWith("/CLAUDE.md")), "root CLAUDE.md import").to.equal(true);
    expect(writes.some((w) => w.endsWith("/.claude/settings.json")), "Claude SessionStart hook").to.equal(true);
    // base clone was missing → cloned
    expect(pxAll(cloned)).to.deep.equal(["/awr/.bases/911-SVM-LIB-SVC"]);
    // gov worktree created before the code-repo push; home default pushed
    expect(log).to.include(`worktreeAdd ${ORG_GOV_CLONE} BRNCH-43-governance-common-project`);
    expect(log).to.include("push /gov main");
    // no compensations ran
    expect(log.some((l) => l.startsWith("resetHard") || l.startsWith("worktreeRemove"))).to.equal(false);
  });

  it("rolls back when the project-branch push fails in phase D", () => {
    const { vcs, log } = fakeVcs({ throwPushFor: [ORG_GOV_CLONE] });
    const { fsPort } = fakeFs();
    const r = seed(
      { board: fakeBoard(), vcs, fs: fsPort, anchor: fakeAnchor(), cloneRepo: () => {} },
      CONFIG,
      INPUT,
    );
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.reason).to.equal("seed-failed");
    // compensations ran: home un-committed + gov worktree removed + code-repo branch cleanup.
    // `resetKeepingFiles`, NOT `resetHard`: the undo runs inside the RESOLVED workspace,
    // where `reset --hard` and `clean` can destroy files this seed never created — which
    // is how a failed seed once removed org-config.yaml and left gov unable to resolve
    // the workspace at all (#191).
    expect(log).to.include("resetKeepingFiles /gov presha");
    expect(log, "never --hard inside the workspace").to.not.include("resetHard /gov presha");
    expect(log).to.include(`worktreeRemove ${ORG_GOV_CLONE}`);
    expect(log.some((l) => l.startsWith("pushDelete"))).to.equal(true);
  });

  it("a failed seed leaves org-config.yaml alone — the workspace still resolves (#191)", () => {
    // The real failure: a seed died in a later phase, its rollback ran `reset --hard`
    // and `clean` inside the RESOLVED workspace, and the adopter's next command said
    // "no gov workspace resolved" about a workspace that was still registered.
    const { vcs } = fakeVcs({ throwPushFor: [ORG_GOV_CLONE] });
    const { fsPort, removed, existing } = fakeFs(new Set(["/gov/org-config.yaml"]));

    const r = seed({ board: fakeBoard(), vcs, fs: fsPort, anchor: fakeAnchor(), cloneRepo: () => {} }, CONFIG, INPUT);

    expect(r.ok).to.equal(false);
    expect(existing.has("/gov/org-config.yaml"), "the workspace is still a workspace").to.equal(true);
    expect(removed, "the undo removes only what Phase A created").to.not.include("/gov/org-config.yaml");
  });

  it("says so loudly if a rollback DID cost the workspace its config (#191)", () => {
    const { vcs } = fakeVcs({ throwPushFor: [ORG_GOV_CLONE] });
    const { fsPort, existing } = fakeFs(new Set(["/gov/org-config.yaml"]));
    // Simulate an undo that overreaches, the way `reset --hard` + `clean` could.
    const sabotaged: Fs = { ...fsPort, rm: (f) => { existing.delete(px(f)); existing.delete("/gov/org-config.yaml"); } };

    const r = seed({ board: fakeBoard(), vcs, fs: sabotaged, anchor: fakeAnchor(), cloneRepo: () => {} }, CONFIG, INPUT);

    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.reason).to.equal("rollback-damaged-workspace");
    expect(r.message).to.contain("org-config.yaml is gone");
    expect(r.message, "and how to get it back").to.contain("checkout -- org-config.yaml");
  });

  it("refuses BEFORE the first write when a code repo's branch has real work (#180)", () => {
    // It used to discover this in Phase C, after three phases of writes — and the
    // failed run left a pushed branch that made every retry fail at the same place.
    const { vcs, log } = fakeVcs();
    (vcs as unknown as { lsRemoteRefs: () => unknown }).lsRemoteRefs =
      () => [{ name: "dev", sha: "base-sha" }, { name: "BRNCH-43-governance-common-project", sha: "someone-elses-work" }];
    const { fsPort } = fakeFs();

    const r = seed({ board: fakeBoard(), vcs, fs: fsPort, anchor: fakeAnchor(), cloneRepo: () => {} }, CONFIG, INPUT);

    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.reason).to.equal("preflight-failed");
    expect(r.message).to.contain("nothing has been created");
    expect(log, "and nothing WAS created").to.deep.equal([]);
  });

  it("reuses a branch left by its own failed run, instead of refusing forever (#180)", () => {
    const { vcs } = fakeVcs();
    (vcs as unknown as { lsRemoteRefs: () => unknown }).lsRemoteRefs =
      () => [{ name: "dev", sha: "base-sha" }, { name: "BRNCH-43-governance-common-project", sha: "base-sha" }];
    const { fsPort } = fakeFs();

    const r = seed({ board: fakeBoard(), vcs, fs: fsPort, anchor: fakeAnchor(), cloneRepo: () => {} }, CONFIG, INPUT);

    expect(r.ok, "a branch on the base tip carries nothing — it is ours").to.equal(true);
  });

  it("an override that collapses two linked repos onto one processes it ONCE (#194)", () => {
    // The board linked an issue in the fork AND one upstream. The override sends the
    // upstream one to the fork, so the same work repo appeared twice — Phase C
    // created the project branch for the first, met it again for the second, and
    // reported "Branch … already exists" about a branch it had made seconds earlier.
    // On a fresh machine, with the branch on no remote and in no clone, which is
    // exactly as confusing as it sounds.
    const { vcs, log } = fakeVcs();
    (vcs as unknown as { lsRemoteRefs: () => unknown }).lsRemoteRefs = () => [{ name: "dev", sha: "base-sha" }];
    const { fsPort } = fakeFs();

    const r = seed(
      { board: fakeBoard({ repoUrls: [CODE_REPO, "https://github.com/upstream/911-SVM-LIB-SVC"] }), vcs, fs: fsPort, anchor: fakeAnchor(), cloneRepo: () => {} },
      { ...CONFIG, repoOverrides: { "upstream/911-SVM-LIB-SVC": "Svayamtech/911-SVM-LIB-SVC" } },
      INPUT,
    );

    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.repos, "one repo, not the same one twice").to.have.length(1);
    expect(log.filter((l) => l.startsWith("worktreeAdd ")).length, "one worktree").to.equal(2); // gov clone + the one code repo
  });

  it("aborts on leftover state without mutating", () => {
    const { vcs, log } = fakeVcs({ leftoverLocalBranch: true });
    const { fsPort } = fakeFs();
    const r = seed(
      { board: fakeBoard(), vcs, fs: fsPort, anchor: fakeAnchor(), cloneRepo: () => {} },
      CONFIG,
      INPUT,
    );
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.reason).to.equal("leftover-state");
    expect(log.some((l) => l.startsWith("worktreeAdd"))).to.equal(false);
  });

  it("rejects a board that fails the C01 gates", () => {
    const r = seed(
      { board: fakeBoard({ linkedItemCount: 0 }), vcs: fakeVcs().vcs, fs: fakeFs().fsPort, anchor: fakeAnchor(), cloneRepo: () => {} },
      CONFIG,
      INPUT,
    );
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.equal("no-linked-items");
  });
});

describe("prj-work Phase 2 — createNodeFs (real temp dir)", () => {
  it("mkdirp / writeFile / readFile / rm round-trip", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prjwork-fs-"));
    try {
      const io = createNodeFs();
      const f = path.join(tmp, "a", "b", "c.txt");
      io.writeFile(f, "hello"); // creates parent dirs
      expect(io.pathExists(f)).to.equal(true);
      expect(io.readFile(f)).to.equal("hello");
      expect(io.readFile(path.join(tmp, "nope"))).to.equal(null);
      io.rm(path.join(tmp, "a"));
      expect(io.pathExists(f)).to.equal(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
