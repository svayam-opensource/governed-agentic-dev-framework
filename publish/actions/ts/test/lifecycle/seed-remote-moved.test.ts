// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * gadf#180, the part that was still open: seed and a STALE MIRROR (PRJ-121 intent 05, Item 2, ruling Q3).
 *
 * Phase B cut the project branch from the gov home's LOCAL default branch, with no fetch. A home whose `main` is
 * behind the remote gave a project branch based on old policy — and nothing said so. Q3: seed fetches first and
 * cuts the branch from the FETCHED remote default branch; the developer's local `main` is left untouched.
 *
 * And a failed seed says what it did: "created: …; rolled back: …; left behind: …".
 *
 * The fake here is STATEFUL (branches, paths, the remote), so "the re-run converges" is a property of the world
 * the first run left, not of a fake that answers the same thing twice.
 */
import { expect } from "chai";
import { seed, type SeedConfig, type SeedInput, type SeedDeps } from "../../src/lifecycle/seed.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";
import { harnessAtDefault } from "../helpers/harness-at-default.js";
import { px } from "../helpers/paths.js";

const CONFIG: SeedConfig = {
  govHome: "/gov",
  workspaceRepo: "acme-gov",
  agentWorkRoot: "/awr",
  defaultBranch: "main",
  defaultCodeBranch: "dev",
  githubOrg: "acme",
  orgTokens: {},
  remote: "origin",
};
const INPUT: SeedInput = {
  boardUrl: "https://github.com/orgs/acme/projects/7",
  assignee: "adopter-bot",
  seededBy: "adopter@example.test",
  today: "2026-10-12",
  seederLogin: "adopter-bot",
};
const BRANCH = "BRNCH-7-alpha";
const WORK_ROOT = "/awr/PRJ-7-alpha";
const GOV_CLONE = `${WORK_ROOT}/acme-gov`;

/** A board whose one linked item is an issue in the governance repo itself: no code repos, so Phase C is empty. */
const board: Board = {
  fetchProject: () => ({
    id: "PVT", title: "Alpha", shortDescription: "d", linkedItemCount: 1,
    repoUrls: ["https://github.com/acme/acme-gov"],
  }),
};
const anchor: AnchorCreator = {
  createAnchorIssue: () => "acme/acme-gov#1", setState: () => true, find: () => null, setAssignee: () => true,
};

interface World {
  /** sha of each LOCAL branch in the gov home. */
  local: Map<string, string>;
  /** sha of each branch ON THE REMOTE. */
  remote: Map<string, string>;
  /** the remote-tracking refs the home last fetched (`origin/<b>`). */
  tracking: Map<string, string>;
  /** paths that exist. */
  paths: Set<string>;
  /** every operation, in order. */
  ops: string[];
  /** the start point each worktreeAdd was given. */
  startPoints: string[];
}

/**
 * The gov home is behind: its local `main` (and its last-fetched `origin/main`) is `old-sha`; the remote is two
 * commits ahead at `remote-sha`.
 */
function world(opts: { pushFails?: boolean; fetchFails?: boolean } = {}) {
  const w: World = {
    local: new Map([["main", "old-sha"]]),
    remote: new Map([["main", "remote-sha"]]),
    tracking: new Map([["main", "old-sha"]]),
    paths: new Set(["/gov", "/gov/org-config.yaml"]),
    ops: [],
    startPoints: [],
  };
  const state = { pushFails: opts.pushFails ?? false };
  const rec = (s: string) => w.ops.push(px(s));
  const vcs: Vcs = {
    localBranchExists: (_r, b) => w.local.has(b),
    remoteBranchExists: (_r, _rm, b) => w.remote.has(b),
    headSha: () => w.local.get("main")!,
    refExists: () => false,
    lsRemoteHeads: () => [...w.remote.keys()],
    lsRemoteRefs: () => [...w.remote].map(([name, sha]) => ({ name, sha })),
    defaultBranch: () => "main",
    revParse: (_r, rev) => w.local.get(rev) ?? (rev.startsWith("origin/") ? w.tracking.get(rev.slice(7)) ?? null : null),
    currentBranch: () => "main",
    isAncestor: () => true,
    isClean: () => true,
    dirtyPaths: () => [],
    remoteBranchesMatching: () => [],
    addPath: (r, p) => rec(`addPath ${r} ${p}`),
    commit: (r) => rec(`commit ${r}`),
    resetHard: (r, s) => rec(`resetHard ${r} ${s}`),
    resetKeepingFiles: (r, s) => rec(`resetKeepingFiles ${r} ${s}`),
    cleanUntracked: (r, p) => rec(`clean ${r} ${p}`),
    worktreeAdd: (_b, br, wt, start) => {
      // A start point resolves the way git resolves it: a sha is itself, a ref is whatever this home has for it.
      const sha = w.local.get(start) ?? (start.startsWith("origin/") ? w.tracking.get(start.slice(7)) : undefined) ?? start;
      w.local.set(br, sha);
      w.paths.add(px(wt));
      w.startPoints.push(start);
      rec(`worktreeAdd ${wt} ${br} ${start}`);
    },
    worktreeAddExisting: (_b, br, wt) => { w.paths.add(px(wt)); rec(`worktreeAddExisting ${wt} ${br}`); },
    worktreeRemove: (_b, wt) => { w.paths.delete(px(wt)); rec(`worktreeRemove ${wt}`); },
    branchDelete: (_r, br) => { w.local.delete(br); rec(`branchDelete ${br}`); },
    push: (r, _rm, br) => {
      if (state.pushFails) throw new Error(`push failed: ${br}`);
      w.remote.set(br, w.local.get(br)!);
      rec(`push ${r} ${br}`);
    },
    pushDelete: (r, _rm, br) => { w.remote.delete(br); rec(`pushDelete ${r} ${br}`); },
    clone: () => {},
    fetch: (r) => rec(`fetch ${r}`),
    fetchDefault: (r, _rm, b) => {
      rec(`fetchDefault ${r} ${b}`);
      if (opts.fetchFails) return null;
      const sha = w.remote.get(b);
      if (sha === undefined) return null;
      w.tracking.set(b, sha);
      return sha;
    },
    setIdentity: () => {},
    checkout: (r, b) => rec(`checkout ${r} ${b}`),
    checkoutNew: (r, b) => rec(`checkoutNew ${r} ${b}`),
    mergeNoEdit: () => "merged",
    tag: () => {},
  };
  const fs: Fs = {
    pathExists: (p) => w.paths.has(px(p)),
    mkdirp: (p) => { w.paths.add(px(p)); },
    writeFile: (p) => { w.paths.add(px(p)); },
    readFile: (f) => (/todo-template\.md$/.test(f) ? "# To-do for <PROJECT_ID>\n\n## Open\n\n## Done\n" : null),
    rm: (p) => { for (const q of [...w.paths]) if (q === px(p) || q.startsWith(`${px(p)}/`)) w.paths.delete(q); },
    readdir: () => [],
  };
  const deps: SeedDeps = { board, vcs, fs, anchor, cloneRepo: () => {}, git: harnessAtDefault(fs, "main").git };
  return { w, deps, state };
}

describe("seed against a remote that moved since the last fetch (gadf#180, Q3)", () => {
  it("fetches first and cuts the project branch at the REMOTE's default-branch sha", () => {
    const { w, deps } = world();
    const r = seed(deps, CONFIG, INPUT);
    expect(r.ok, r.ok ? "" : r.message).to.equal(true);
    const fetchAt = w.ops.findIndex((o) => o.startsWith("fetchDefault /gov main"));
    const cutAt = w.ops.findIndex((o) => o.startsWith(`worktreeAdd ${GOV_CLONE} ${BRANCH}`));
    expect(fetchAt, "the default branch is fetched").to.be.greaterThan(-1);
    expect(fetchAt, "before the branch is cut").to.be.lessThan(cutAt);
    expect(w.startPoints, "cut from what the remote holds now").to.deep.equal(["remote-sha"]);
    expect(w.local.get(BRANCH), "the project branch carries current policy").to.equal("remote-sha");
    expect(w.remote.get(BRANCH), "and that is what was pushed").to.equal("remote-sha");
  });

  it("leaves the developer's local main exactly where it was", () => {
    const { w, deps } = world();
    seed(deps, CONFIG, INPUT);
    expect(w.local.get("main"), "local main not fast-forwarded").to.equal("old-sha");
    expect(w.ops.filter((o) => /\b(checkout|resetHard|resetKeepingFiles|commit) \/gov\b/.test(o) || / main$/.test(o) && o.startsWith("push")),
      "nothing checked out, reset, committed or pushed in the gov home's main").to.deep.equal([]);
  });

  it("refuses before the first write when the default branch cannot be fetched", () => {
    const { w, deps } = world({ fetchFails: true });
    const r = seed(deps, CONFIG, INPUT);
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.reason).to.equal("preflight-failed");
    expect(r.message).to.include("nothing has been created");
    expect(r.message).to.include("origin/main");
    expect(w.ops.filter((o) => !o.startsWith("fetchDefault")), "no write of any kind").to.deep.equal([]);
    expect(w.paths.has(WORK_ROOT)).to.equal(false);
  });
});

describe("a failed seed says what it created and what it rolled back (gadf#180)", () => {
  it("Phase D failure → message ends with created / rolled back / left behind", () => {
    const { deps } = world({ pushFails: true });
    const r = seed(deps, CONFIG, INPUT);
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.reason).to.equal("seed-failed");
    const last = r.message.split("\n").filter(Boolean).pop()!;
    expect(px(last)).to.match(/^created: .*work root \/awr\/PRJ-7-alpha.*worktree \/awr\/PRJ-7-alpha\/acme-gov.*; rolled back: .*; left behind: nothing$/);
    expect(px(last)).to.include("rolled back: worktree /awr/PRJ-7-alpha/acme-gov, work root /awr/PRJ-7-alpha");
    expect(r.message, "the cause is still first").to.match(/^push failed: BRNCH-7-alpha/);
  });

  it("names an undo that failed as left behind", () => {
    const { deps } = world({ pushFails: true });
    deps.vcs.worktreeRemove = () => { throw new Error("busy"); };
    const r = seed(deps, CONFIG, INPUT);
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    const last = px(r.message.split("\n").filter(Boolean).pop()!);
    expect(last).to.match(/left behind: worktree \/awr\/PRJ-7-alpha\/acme-gov \(busy\)$/);
    expect(last).to.include("rolled back: work root /awr/PRJ-7-alpha;");
  });

  it("re-running after a clean rollback converges", () => {
    const { w, deps, state } = world({ pushFails: true });
    const first = seed(deps, CONFIG, INPUT);
    expect(first.ok).to.equal(false);
    expect(w.local.has(BRANCH), "no local branch left").to.equal(false);
    expect(w.remote.has(BRANCH), "no remote branch left").to.equal(false);
    expect(w.paths.has(WORK_ROOT), "no work root left").to.equal(false);

    state.pushFails = false;
    const second = seed(deps, CONFIG, INPUT);
    expect(second.ok, second.ok ? "" : second.message).to.equal(true);
    expect(w.remote.get(BRANCH)).to.equal("remote-sha");
  });
});
