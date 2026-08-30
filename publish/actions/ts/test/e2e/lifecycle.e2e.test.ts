// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Hermetic full-flow e2e (MANDATORY PR gate) — runs the REAL orchestrators
 * seed → task → merge over a single STATEFUL in-memory world, proving they
 * COMPOSE (seed's outputs are what task/merge consume): branches, worktrees,
 * pushes, issue state. No network, no GitHub — deterministic + fast, so it gates
 * every PR in node-ci. A REAL-GitHub e2e (Tier B, TESTBED-DESIGN §3) stays a
 * separate manual pre-publish gate.
 */
import { expect } from "chai";
import * as path from "node:path";
import { seed } from "../../src/lifecycle/seed.js";
import { task } from "../../src/lifecycle/task-run.js";
import { merge } from "../../src/lifecycle/merge.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";
import { px } from "../helpers/paths.js";

const GOV_HOME = "/gov";
const AWR = "/work";
const WORKSPACE_REPO = "wsrepo";
const CODE_REPO = "https://github.com/Svayamtech/coderepo";
const BOARD_URL = "https://github.com/orgs/Svayamtech/projects/7";
const ISSUE = "https://github.com/Svayamtech/coderepo/issues/5";

/** A single stateful world backing every port, so the commands compose. */
class World {
  paths = new Set<string>([GOV_HOME]);
  files = new Map<string, string>();
  local = new Map<string, Set<string>>([[GOV_HOME, new Set(["main"])]]);
  current = new Map<string, string>([[GOV_HOME, "main"]]);
  pushed = new Set<string>();
  tags = new Map<string, Set<string>>();
  issues = new Map(Object.entries({ [ISSUE]: { state: "OPEN" as "OPEN" | "CLOSED", assignees: [] as string[] } }));
  anchorCreated = false;
  boardClosed = false;
  log: string[] = [];

  // Every map in this world is keyed by the NORMALISED path: production composes with `path.join`, so on
  // Windows it hands us `\work\PRJ-7`, while the literals seeded above say `/work/PRJ-7`. Both sides of a
  // store must key alike or a write is invisible to the read that follows it.
  private branches(dir: string) {
    let s = this.local.get(px(dir));
    if (!s) this.local.set(px(dir), (s = new Set()));
    return s;
  }
  private markGit(dir: string) {
    this.paths.add(px(dir));
    this.paths.add(px(path.join(dir, ".git")));
  }

  vcs: Vcs = {
    localBranchExists: (dir, b) => this.branches(dir).has(b),
    remoteBranchExists: (_dir, _r, b) => this.pushed.has(b),
    headSha: () => "sha",
    refExists: (_dir, ref) => ref === "refs/remotes/origin/main",
    lsRemoteHeads: () => [],
    // The base exists; no project branch yet — the ordinary case the preflight sees.
    // This world's code repos are based on `main`, not `dev` — the preflight reads
    // the config's default_code_branch, so the fake must agree with it.
    lsRemoteRefs: () => [{ name: "main", sha: "base-sha" }],
    defaultBranch: () => "main",
    revParse: () => null,
    currentBranch: (dir) => this.current.get(px(dir)) ?? "main",
    isAncestor: () => true, // no commits added → sub-branch is an ancestor of its base
    isClean: () => true,
    remoteBranchesMatching: () => [],
    addPath: () => {},
    commit: (dir, m) => this.log.push(`commit ${dir} :: ${m}`),
    resetHard: () => {}, resetKeepingFiles: () => {},
    cleanUntracked: () => {},
    worktreeAdd: (_base, branch, wt) => {
      this.branches(wt).add(branch);
      this.current.set(px(wt), branch);
      this.markGit(wt);
    },
    worktreeRemove: (_b, wt) => this.paths.delete(px(path.join(wt, ".git"))),
    branchDelete: (dir, b) => this.branches(dir).delete(b),
    push: (_dir, _r, b) => this.pushed.add(b),
    pushDelete: (_dir, _r, b) => this.pushed.delete(b),
    clone: (_url, dest) => this.markGit(dest),
    fetch: () => {},
    setIdentity: () => {},
    checkout: (dir, b) => this.current.set(px(dir), b),
    checkoutNew: (dir, b) => {
      this.branches(dir).add(b);
      this.current.set(px(dir), b);
    },
    mergeNoEdit: () => "merged",
    tag: (dir, name) => {
      let s = this.tags.get(px(dir));
      if (!s) this.tags.set(px(dir), (s = new Set()));
      s.add(name);
    },
  };

  fs: Fs = {
    pathExists: (p) => this.paths.has(px(p)),
    mkdirp: (d) => this.paths.add(px(d)),
    writeFile: (f, c) => {
      this.files.set(px(f), c);
      this.paths.add(px(f));
    },
    readFile: (f) => this.files.get(px(f)) ?? null,
    rm: (t) => {
      this.paths.delete(px(t));
      this.files.delete(px(t));
    },
    readdir: () => [],
  };

  board: Board = {
    fetchProject: () => ({ id: "P", title: "E2E", shortDescription: "e2e", linkedItemCount: 1, repoUrls: [CODE_REPO] }),
  };

  issuesPort: Issues = {
    state: (url) => this.issues.get(url)?.state ?? "UNKNOWN",
    assign: (url, a) => this.issues.get(url)?.assignees.push(a),
    setBoardStatus: () => {},
    close: (url) => {
      const i = this.issues.get(url);
      if (i) i.state = "CLOSED";
    },
    resolveIssueUrl: () => ISSUE,
    closeBoard: () => {
      this.boardClosed = true;
    },
  };

  anchor: AnchorCreator = {
    createAnchorIssue: () => {
      this.anchorCreated = true;
      return "Svayamtech/wsrepo#1";
    },
    setState: () => true,
  };
}

describe("prj-work — full-flow e2e (seed → task → merge)", () => {
  it("composes end-to-end over one stateful world", () => {
    const w = new World();
    const deps = { vcs: w.vcs, fs: w.fs, board: w.board, issues: w.issuesPort, anchor: w.anchor, cloneRepo: w.vcs.clone, log: (m: string) => w.log.push(m) };

    // ── seed ────────────────────────────────────────────────────────────────
    const seeded = seed(
      { board: deps.board, vcs: deps.vcs, fs: deps.fs, anchor: deps.anchor, cloneRepo: deps.cloneRepo, log: deps.log },
      { govHome: GOV_HOME, workspaceRepo: WORKSPACE_REPO, agentWorkRoot: AWR, defaultBranch: "main", defaultCodeBranch: "main", githubOrg: "Svayamtech", orgTokens: {}, toolFiles: [] },
      { boardUrl: BOARD_URL, assignee: "svayam-rkant", seededBy: "rk@x", today: "2026-07-04", seederLogin: "svayam-rkant" },
    );
    expect(seeded.ok, "seed ok").to.equal(true);
    if (!seeded.ok) return;
    expect(seeded.projectId).to.equal("PRJ-7-e2e");
    expect(seeded.branch).to.equal("BRNCH-7-e2e");
    expect(w.anchorCreated, "anchor issue created").to.equal(true);
    expect(w.pushed.has("BRNCH-7-e2e"), "project branch pushed").to.equal(true);
    const govClone = seeded.orgGovClone; // /work/PRJ-7-e2e/wsrepo
    const projectWorkRoot = path.dirname(govClone);

    // ── task ────────────────────────────────────────────────────────────────
    const tasked = task(
      { board: deps.board, vcs: deps.vcs, fs: deps.fs, issues: deps.issues, log: deps.log, authorize: () => true },
      { githubOrg: "Svayamtech", workspaceRepo: WORKSPACE_REPO },
      { govClone, projectWorkRoot, issueUrls: [ISSUE], assignee: "svayam-rkant" },
    );
    expect(tasked.ok, "task ok").to.equal(true);
    if (!tasked.ok) return;
    expect(tasked.taskId).to.equal("BRNCH-7-e2e.ISSUE-5");
    expect(tasked.reposBranched, "branched workspace + code repo").to.have.lengthOf(2);
    expect(w.pushed.has("BRNCH-7-e2e.ISSUE-5"), "task branch pushed").to.equal(true);
    expect(w.issues.get(ISSUE)!.assignees, "issue assigned").to.include("svayam-rkant");

    // ── merge ─────────────────────────────────────────────────────────────────
    const merged = merge(
      { board: deps.board, vcs: deps.vcs, fs: deps.fs, issues: deps.issues, log: deps.log, authorize: () => true },
      { githubOrg: "Svayamtech", workspaceRepo: WORKSPACE_REPO },
      { govClone, projectWorkRoot, taskArg: ISSUE },
    );
    expect(merged.ok, "merge ok").to.equal(true);
    if (!merged.ok) return;
    expect(w.issues.get(ISSUE)!.state, "issue closed").to.equal("CLOSED");
    // archive tag created + task branch un-pushed (deleted) in both repos
    expect([...(w.tags.get(px(govClone)) ?? [])], "gov archive tag").to.include("archive/BRNCH-7-e2e.ISSUE-5");
    expect(w.pushed.has("BRNCH-7-e2e.ISSUE-5"), "task branch deleted from remote").to.equal(false);
  });
});
