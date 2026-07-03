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
  const vcs: Vcs = {
    localBranchExists: () => opts.leftoverLocalBranch ?? false,
    remoteBranchExists: () => false,
    headSha: () => "presha",
    refExists: (_r, ref) => ref === "refs/remotes/origin/dev",
    lsRemoteHeads: () => [],
    defaultBranch: () => null,
    revParse: () => null,
    currentBranch: () => "main",
    isAncestor: () => false,
    isClean: () => true,
    checkout: (r) => log.push(`checkout ${r}`),
    checkoutNew: (r) => log.push(`checkoutNew ${r}`),
    mergeNoEdit: () => "merged",
    tag: () => {},
    addPath: (r) => log.push(`addPath ${r}`),
    commit: (r, m) => log.push(`commit ${r} :: ${m}`),
    resetHard: (r, s) => log.push(`resetHard ${r} ${s}`),
    cleanUntracked: (r, p) => log.push(`clean ${r} ${p}`),
    worktreeAdd: (_b, br, wt) => log.push(`worktreeAdd ${wt} ${br}`),
    worktreeRemove: (_b, wt) => log.push(`worktreeRemove ${wt}`),
    branchDelete: (_r, br) => log.push(`branchDelete ${br}`),
    push: (r, _rm, br) => {
      if (opts.throwPushFor?.includes(r)) throw new Error(`push failed: ${r}`);
      log.push(`push ${r} ${br}`);
    },
    pushDelete: (r) => log.push(`pushDelete ${r}`),
    clone: () => {},
    fetch: () => {},
    setIdentity: (r) => log.push(`setIdentity ${r}`),
  };
  return { vcs, log };
}

/** A recording in-memory Fs. `existing` paths report as present. */
function fakeFs(existing: Set<string> = new Set()) {
  const writes: string[] = [];
  const fsPort: Fs = {
    pathExists: (p) => existing.has(p),
    mkdirp: () => {},
    writeFile: (f) => writes.push(f),
    readFile: () => null, // no todo template / tool files in these tests
    rm: () => {},
  };
  return { fsPort, writes };
}

const fakeAnchor = (ref: string | null = "Svayamtech/svm-prj-work#1"): AnchorCreator => ({
  createAnchorIssue: () => ref,
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
    expect(r.orgGovClone).to.equal(ORG_GOV_CLONE);
    expect(r.repos).to.deep.equal([
      { name: "911-SVM-LIB-SVC", url: CODE_REPO, repoDir: "/awr/PRJ-43-governance-common-project/911-SVM-LIB-SVC" },
    ]);
    expect(r.anchorRef).to.equal("Svayamtech/svm-prj-work#1");

    // wrote authored content — agent.md — but NO project.yaml (GitHub is SoT)
    expect(writes.some((w) => w.endsWith("/agent.md"))).to.equal(true);
    expect(writes.some((w) => w.endsWith("/project.yaml"))).to.equal(false);
    // base clone was missing → cloned
    expect(cloned).to.deep.equal(["/awr/.bases/911-SVM-LIB-SVC"]);
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
    // compensations ran: home reset + gov worktree removed + code-repo branch cleanup
    expect(log).to.include("resetHard /gov presha");
    expect(log).to.include(`worktreeRemove ${ORG_GOV_CLONE}`);
    expect(log.some((l) => l.startsWith("pushDelete"))).to.equal(true);
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
