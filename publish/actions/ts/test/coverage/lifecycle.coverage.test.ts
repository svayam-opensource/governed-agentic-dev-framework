// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EXHAUSTIVE (full-cartesian) coverage for the LIFECYCLE commands routed through
 * `route()` in src/cli/dispatch.ts:
 *
 *   seed · join · task · merge · sync · add-repo · close · pause · resume · cancel
 *
 * For each command this file crosses {flag present-with-value / absent / default}
 * × {--flag=value and --flag value forms} × {argument shapes} × {every reachable
 * error reason}. It drives `route()` over fully faked ports (no real IO), reusing
 * the `ctx()` + fake vcs/board/issues/anchor/pulls pattern from
 * test/cli/dispatch.test.ts. The `--gov-home` global is handled by main(), not
 * route(), and is deliberately NOT tested here.
 */
import { expect } from "chai";
import { parseArgv } from "../../src/cli/args.js";
import { route, type CliContext } from "../../src/cli/dispatch.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";
import type { Pulls } from "../../src/lifecycle/pulls.js";

// ── Shared constants (derived id/branch must match the fake board title) ────────
const BOARD_URL = "https://github.com/orgs/Svayamtech/projects/43";
const PID = "PRJ-43-governance-common-project";
const PBRANCH = "BRNCH-43-governance-common-project";
const GOV_CLONE = "/awr/PRJ-43-governance-common-project/svm-prj-work"; // = ctx.home
const PWR = "/awr/PRJ-43-governance-common-project"; // = dirname(home) = projectWorkRoot
const ISSUE9 = "https://github.com/Svayamtech/x/issues/9";
const ISSUE10 = "https://github.com/Svayamtech/x/issues/10";
const APP_URL = "https://github.com/Svayamtech/app.git";
const APP_DIR = "/awr/PRJ-43-governance-common-project/app";

const CONFIG: OrgConfig = {
  orgName: "Svayam", orgShortName: "Svayam", orgSlug: "SVM", orgSlugLower: "svm",
  githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work", orgRepoUrl: "git@github.com:Svayamtech/svm-prj-work.git",
  defaultBranch: "main", defaultCodeBranch: "dev",
  agentWorkRoot: "/awr", govWorkspace: "/gov", policyOwnerEmail: "rk@x", orgTokens: {},
};

// ── Fake ports ──────────────────────────────────────────────────────────────
/** A Vcs whose current branch is a project branch so from-workspace commands resolve. */
function fakeVcs(): Vcs {
  const noop = () => {};
  return {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h",
    refExists: () => false, lsRemoteHeads: () => [], defaultBranch: () => null, revParse: () => null,
    currentBranch: () => PBRANCH, isAncestor: () => false, isClean: () => true,
    remoteBranchesMatching: () => [], addPath: noop, commit: noop, resetHard: noop, cleanUntracked: noop,
    worktreeAdd: noop, worktreeRemove: noop, branchDelete: noop, push: noop, pushDelete: noop, clone: noop,
    fetch: noop, setIdentity: noop, checkout: noop, checkoutNew: noop, mergeNoEdit: () => "merged", tag: noop,
  };
}

const okBoard: Board = {
  fetchProject: () => ({ id: "P", title: "@Governance Common Project", shortDescription: null, linkedItemCount: 1, repoUrls: [] }),
};
/** A board whose linked items include one code repo (+ the workspace repo, which is filtered out). */
const boardWithCodeRepo: Board = {
  fetchProject: () => ({ id: "P", title: "@Governance Common Project", shortDescription: null, linkedItemCount: 1, repoUrls: ["git@github.com:Svayamtech/svm-prj-work.git", APP_URL] }),
};
const boardTitled = (title: string, linkedItemCount = 1): Board => ({
  fetchProject: () => ({ id: "P", title, shortDescription: null, linkedItemCount, repoUrls: [] }),
});

const fs: Fs = { pathExists: () => false, readFile: () => null, mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [] };
const issues: Issues = { state: () => "OPEN", assign: () => {}, setBoardStatus: () => {}, close: () => {}, resolveIssueUrl: () => null, closeBoard: () => {} };
const anchor: AnchorCreator = { createAnchorIssue: () => "r#1", setState: () => true } as unknown as AnchorCreator;
const pulls: Pulls = { create: () => "pr", merge: () => "merged" };

function ctx(over: Partial<CliContext> = {}): CliContext {
  return {
    config: CONFIG, home: GOV_CLONE, today: "2026-07-03",
    seededBy: "svayam-rkant", board: okBoard, vcs: fakeVcs(), fs, issues, anchor, pulls,
    projects: { listBoards: () => [] }, cloneRepo: () => {}, ...over,
  };
}

/** Route an argv string[] through a fresh ctx (optionally overridden). */
function run(argv: string[], over: Partial<CliContext> = {}) {
  return route(parseArgv(argv) as never, ctx(over));
}

// ── Spies for flag-threading assertions ─────────────────────────────────────
/** An AnchorCreator that records the assigneeLogin passed to createAnchorIssue. */
function spyAnchor() {
  const calls: Array<string | null | undefined> = [];
  const a = {
    createAnchorIssue: (p: { assigneeLogin?: string | null }) => { calls.push(p.assigneeLogin); return "r#1"; },
    setState: () => true,
  } as unknown as AnchorCreator;
  return { anchor: a, calls };
}
/** An Issues that records the assignee passed to assign(). */
function spyIssues(over: Partial<Issues> = {}) {
  const assignees: string[] = [];
  const i: Issues = { ...issues, assign: (_url: string, who: string) => { assignees.push(who); }, ...over };
  return { issues: i, assignees };
}

// ════════════════════════════════════════════════════════════════════════════
//  seed  —  seed <board-url> [assignee]   flag: --login
// ════════════════════════════════════════════════════════════════════════════
describe("lifecycle coverage — seed", () => {
  /** A Vcs with no pre-existing remote branch so the leftover guard passes. */
  const seedVcs = (over: Partial<Vcs> = {}): Vcs => ({ ...fakeVcs(), remoteBranchExists: () => false, ...over });

  it("missing <board-url> → usage (exit 2)", () => {
    const r = run(["seed"]);
    expect(r.code).to.equal(2);
    expect(r.lines).to.deep.equal(["usage: gov-work seed <board-url> [--assignee <login>]"]);
  });

  it("happy path → exit 0 with exact lines", () => {
    const r = run(["seed", BOARD_URL], { vcs: seedVcs() });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([
      `Project ${PID} seeded on ${PBRANCH}`,
      `  workspace: ${PWR}`,
      "  anchor: r#1",
    ]);
  });

  it("accepts the optional [assignee] positional (exit 0, same output)", () => {
    const r = run(["seed", BOARD_URL, "someone-else"], { vcs: seedVcs() });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal(`Project ${PID} seeded on ${PBRANCH}`);
  });

  it("--login absent → anchor assigneeLogin is null (no ctx.login)", () => {
    const s = spyAnchor();
    const r = run(["seed", BOARD_URL], { vcs: seedVcs(), anchor: s.anchor });
    expect(r.code).to.equal(0);
    expect(s.calls).to.deep.equal([null]);
  });

  it("--login <value> (space form) → threaded to the anchor assignee", () => {
    const s = spyAnchor();
    const r = run(["seed", BOARD_URL, "--login", "rk"], { vcs: seedVcs(), anchor: s.anchor });
    expect(r.code).to.equal(0);
    expect(s.calls).to.deep.equal(["rk"]);
  });

  it("--login=<value> (equals form) → threaded to the anchor assignee", () => {
    const s = spyAnchor();
    const r = run(["seed", BOARD_URL, "--login=rk"], { vcs: seedVcs(), anchor: s.anchor });
    expect(r.code).to.equal(0);
    expect(s.calls).to.deep.equal(["rk"]);
  });

  it("--login absent but ctx.login present → falls back to ctx.login", () => {
    const s = spyAnchor();
    const r = run(["seed", BOARD_URL], { vcs: seedVcs(), anchor: s.anchor, login: "ctx-login" });
    expect(r.code).to.equal(0);
    expect(s.calls).to.deep.equal(["ctx-login"]);
  });

  it("--login flag overrides ctx.login", () => {
    const s = spyAnchor();
    const r = run(["seed", BOARD_URL, "--login", "flagwin"], { vcs: seedVcs(), anchor: s.anchor, login: "ctx-login" });
    expect(r.code).to.equal(0);
    expect(s.calls).to.deep.equal(["flagwin"]);
  });

  it("error: bad board URL → exit 1", () => {
    const r = run(["seed", "not-a-url"]);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not a GitHub Project URL: not-a-url");
  });

  it("error: board has no title → exit 1", () => {
    const r = run(["seed", BOARD_URL], { vcs: seedVcs(), board: boardTitled("") });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("GitHub Project has no name.");
  });

  it("error: board has no linked items → exit 1", () => {
    const r = run(["seed", BOARD_URL], { vcs: seedVcs(), board: boardTitled("Good Title", 0) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("GitHub Project has no linked Issues or PRs.");
  });

  it("error: title slugifies to empty → exit 1 (empty-slug)", () => {
    const r = run(["seed", BOARD_URL], { vcs: seedVcs(), board: boardTitled("@@@ !!!") });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Cannot derive project id (empty-slug).");
  });

  it("error: leftover state from a prior failed run → exit 1", () => {
    // Default fakeVcs.remoteBranchExists === true → the project branch already exists.
    const r = run(["seed", BOARD_URL]);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/^Detected leftover state from a previous failed run:/);
  });

  it("error: an effect throws mid-transaction → exit 1 (seed-failed)", () => {
    const boom = seedVcs({ commit: () => { throw new Error("boom"); } });
    const r = run(["seed", BOARD_URL], { vcs: boom });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("boom");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  join  —  join <board-url>   (no flags read by route)
// ════════════════════════════════════════════════════════════════════════════
describe("lifecycle coverage — join", () => {
  it("missing <board-url> → usage (exit 2)", () => {
    const r = run(["join"]);
    expect(r.code).to.equal(2);
    expect(r.lines).to.deep.equal(["usage: gov-work join <board-url>"]);
  });

  it("happy path (no code repos) → exit 0 with exact lines", () => {
    const r = run(["join", BOARD_URL]);
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([
      `Joined ${PID} on ${PBRANCH}`,
      `  workspace: ${GOV_CLONE}`,
      "  code repos: 0",
    ]);
  });

  it("happy path with one linked code repo → reports code repos: 1", () => {
    const r = run(["join", BOARD_URL], { board: boardWithCodeRepo });
    expect(r.code).to.equal(0);
    expect(r.lines[2]).to.equal("  code repos: 1");
  });

  it("error: bad board URL → exit 1", () => {
    const r = run(["join", "nope"]);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not a GitHub Project URL: nope");
  });

  it("error: title slugifies to empty → exit 1 (empty-slug)", () => {
    const r = run(["join", BOARD_URL], { board: boardTitled("###") });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Cannot derive project id (empty-slug).");
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["join", BOARD_URL], { authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized to join GitHub Project #43.");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  task  —  task <issue-url[,issue-url...]>   flag: --assignee
// ════════════════════════════════════════════════════════════════════════════
describe("lifecycle coverage — task", () => {
  it("missing <issue-url> → usage (exit 2)", () => {
    const r = run(["task"]);
    expect(r.code).to.equal(2);
    expect(r.lines).to.deep.equal(["usage: gov-work task <issue-url[,issue-url...]>"]);
  });

  it("happy path (single issue URL) → exit 0 with exact lines", () => {
    const r = run(["task", ISSUE9]);
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([
      `Task ${PBRANCH}.ISSUE-9`,
      "  branched: 1 repo(s)",
    ]);
  });

  it("argument shape: comma-separated issue URLs → combined ISSUE-9-10 task id", () => {
    const r = run(["task", `${ISSUE9},${ISSUE10}`]);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal(`Task ${PBRANCH}.ISSUE-9-10`);
    expect(r.lines[1]).to.equal("  branched: 1 repo(s)");
  });

  it("reports repos skipped when a linked code repo has no local worktree", () => {
    const r = run(["task", ISSUE9], { board: boardWithCodeRepo });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([
      `Task ${PBRANCH}.ISSUE-9`,
      "  branched: 1 repo(s)",
      `  skipped (not cloned): ${APP_DIR}`,
    ]);
  });

  it("--assignee absent → assigns via ctx.seededBy (no ctx.login)", () => {
    const s = spyIssues();
    const r = run(["task", ISSUE9], { issues: s.issues });
    expect(r.code).to.equal(0);
    expect(s.assignees).to.deep.equal(["svayam-rkant"]);
  });

  it("--assignee absent but ctx.login present → assigns via ctx.login", () => {
    const s = spyIssues();
    const r = run(["task", ISSUE9], { issues: s.issues, login: "loginuser" });
    expect(r.code).to.equal(0);
    expect(s.assignees).to.deep.equal(["loginuser"]);
  });

  it("--assignee <value> (space form) → threaded to the issue assignee", () => {
    const s = spyIssues();
    const r = run(["task", ISSUE9, "--assignee", "me"], { issues: s.issues, login: "loginuser" });
    expect(r.code).to.equal(0);
    expect(s.assignees).to.deep.equal(["me"]);
  });

  it("--assignee=<value> (equals form) → threaded to the issue assignee", () => {
    const s = spyIssues();
    const r = run(["task", ISSUE9, "--assignee=me"], { issues: s.issues });
    expect(r.code).to.equal(0);
    expect(s.assignees).to.deep.equal(["me"]);
  });

  it("error: not on a project branch → exit 1", () => {
    const r = run(["task", ISSUE9], { vcs: { ...fakeVcs(), currentBranch: () => "main" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/^'main' is not a project branch/);
  });

  it("error: unparseable issue URL → exit 1 (bad-issue-url)", () => {
    const r = run(["task", "https://github.com/Svayamtech/x/pull/9"]);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Could not extract an issue number from 'https://github.com/Svayamtech/x/pull/9'.");
  });

  it("error: issue already closed → exit 1 (issue-closed)", () => {
    const r = run(["task", ISSUE9], { issues: { ...issues, state: () => "CLOSED" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal(`Issue ${ISSUE9} is closed — cannot start a task on it.`);
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["task", ISSUE9], { authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized on GitHub Project #43.");
  });

  it("error: an effect throws while branching → exit 1 (task-failed)", () => {
    const r = run(["task", ISSUE9], { vcs: { ...fakeVcs(), checkoutNew: () => { throw new Error("boom"); } } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("boom");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  merge  —  merge <issue-url | task-branch>   (no flags)
// ════════════════════════════════════════════════════════════════════════════
describe("lifecycle coverage — merge", () => {
  it("missing arg → usage (exit 2)", () => {
    const r = run(["merge"]);
    expect(r.code).to.equal(2);
    expect(r.lines).to.deep.equal(["usage: gov-work merge <issue-url | task-branch>"]);
  });

  it("happy path (issue-URL arg) → exit 0 with exact lines", () => {
    const r = run(["merge", ISSUE9]);
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([
      `Merged ${PBRANCH}.ISSUE-9 → ${PBRANCH}`,
      "  closed issue(s): 1",
    ]);
  });

  it("argument shape: task-branch arg (unresolved issues) → closed issue(s): 0", () => {
    const r = run(["merge", `${PBRANCH}.ISSUE-9`]);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal(`Merged ${PBRANCH}.ISSUE-9 → ${PBRANCH}`);
    expect(r.lines[1]).to.equal("  closed issue(s): 0");
  });

  it("argument shape: task-branch arg with a resolvable issue → closed issue(s): 1", () => {
    const r = run(["merge", `${PBRANCH}.ISSUE-9`], { issues: { ...issues, resolveIssueUrl: () => ISSUE9 } });
    expect(r.code).to.equal(0);
    expect(r.lines[1]).to.equal("  closed issue(s): 1");
  });

  it("argument shape: multi-issue task-branch arg with resolver → closed issue(s): 2", () => {
    const r = run(["merge", `${PBRANCH}.ISSUE-9-10`], { issues: { ...issues, resolveIssueUrl: (_r, n) => `https://github.com/Svayamtech/x/issues/${n}` } });
    expect(r.code).to.equal(0);
    expect(r.lines[1]).to.equal("  closed issue(s): 2");
  });

  it("error: not on a project branch → exit 1", () => {
    const r = run(["merge", ISSUE9], { vcs: { ...fakeVcs(), currentBranch: () => "main" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("error: arg is neither an issue URL nor a task branch → exit 1 (not-a-task)", () => {
    const r = run(["merge", "random-branch"]);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal(`'random-branch' is neither an issue URL nor a '${PBRANCH}.ISSUE-…' branch.`);
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["merge", ISSUE9], { authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized on GitHub Project #43.");
  });

  it("error: no sub-branch on the remote → exit 1 (no-subbranch)", () => {
    const r = run(["merge", ISSUE9], { vcs: { ...fakeVcs(), remoteBranchExists: () => false } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal(`No sub-branch '${PBRANCH}.ISSUE-9' on the remote — was the task created?`);
  });

  it("error: a working tree is dirty → exit 1 (dirty)", () => {
    const r = run(["merge", ISSUE9], { vcs: { ...fakeVcs(), isClean: () => false } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal(`Uncommitted changes in ${GOV_CLONE} — commit or stash first.`);
  });

  it("error: merge conflict → exit 2 (merge-conflict)", () => {
    const r = run(["merge", ISSUE9], { vcs: { ...fakeVcs(), mergeNoEdit: () => "conflict" } });
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal(`Merge conflict: ${PBRANCH}.ISSUE-9 → ${PBRANCH} in ${GOV_CLONE}. Resolve, commit, then re-run.`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  sync  —  sync   (no positionals, no flags)
// ════════════════════════════════════════════════════════════════════════════
describe("lifecycle coverage — sync", () => {
  it("happy path → exit 0 with exact lines", () => {
    const r = run(["sync"]);
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([
      `Synced ${PBRANCH}`,
      "  1 repo(s) up to date",
    ]);
  });

  it("error: not on a project branch → exit 1", () => {
    const r = run(["sync"], { vcs: { ...fakeVcs(), currentBranch: () => "main" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["sync"], { authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized on GitHub Project #43.");
  });

  it("error: a working tree is dirty → exit 1 (dirty)", () => {
    const r = run(["sync"], { vcs: { ...fakeVcs(), isClean: () => false } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal(`Uncommitted changes in ${GOV_CLONE} — commit or stash first.`);
  });

  it("error: merge conflict → exit 2 (merge-conflict)", () => {
    const r = run(["sync"], { vcs: { ...fakeVcs(), mergeNoEdit: () => "conflict" } });
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal(`Merge conflict: main → ${PBRANCH} in ${GOV_CLONE}. Resolve, commit, then re-run.`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  add-repo  —  add-repo <repo-url> [base-branch]   (no flags)
// ════════════════════════════════════════════════════════════════════════════
describe("lifecycle coverage — add-repo", () => {
  /** A Vcs where only the given base branch's remote ref exists (worktree setup succeeds). */
  const addVcs = (base: string): Vcs => ({ ...fakeVcs(), refExists: (_d, ref) => ref === `refs/remotes/origin/${base}` });

  it("missing <repo-url> → usage (exit 2)", () => {
    const r = run(["add-repo"]);
    expect(r.code).to.equal(2);
    expect(r.lines).to.deep.equal(["usage: gov-work add-repo <repo-url> [--base-branch <branch>]"]);
  });

  it("happy path (default base branch = dev) → exit 0 with exact line", () => {
    const r = run(["add-repo", APP_URL], { vcs: addVcs("dev") });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([`Added ${APP_DIR} on ${PBRANCH}`]);
  });

  it("argument shape: explicit [base-branch] positional is threaded through", () => {
    // vcs accepts ONLY 'release' as a base — success proves the positional was used.
    const r = run(["add-repo", APP_URL, "--base-branch", "release"], { vcs: addVcs("release") });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([`Added ${APP_DIR} on ${PBRANCH}`]);
  });

  it("error: not on a project branch → exit 1", () => {
    const r = run(["add-repo", APP_URL], { vcs: { ...fakeVcs(), currentBranch: () => "main" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["add-repo", APP_URL], { vcs: addVcs("dev"), authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized on GitHub Project #43.");
  });

  it("error: base branch not found → exit 1 (add-failed)", () => {
    // Default fakeVcs.refExists === false → base ref missing.
    const r = run(["add-repo", APP_URL]);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal(`Base branch 'dev' not found in ${APP_URL}`);
  });

  it("error: project branch already exists in the repo → exit 1 (add-failed)", () => {
    const r = run(["add-repo", APP_URL], { vcs: { ...fakeVcs(), refExists: () => true } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal(`Branch '${PBRANCH}' already exists in ${APP_URL} — investigate.`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  pause / resume / cancel  (state.ts) — no positionals, no flags
// ════════════════════════════════════════════════════════════════════════════
describe("lifecycle coverage — pause", () => {
  it("happy path (label applied) → exit 0", () => {
    const r = run(["pause"]);
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal(["Project #43 → paused"]);
  });

  it("label not applied → success with a warning suffix", () => {
    const r = run(["pause"], { anchor: { ...anchor, setState: () => false } });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Project #43 → paused (anchor label not applied — check gh access)");
  });

  it("error: not on a project branch → exit 1", () => {
    const r = run(["pause"], { vcs: { ...fakeVcs(), currentBranch: () => "main" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["pause"], { authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized on GitHub Project #43.");
  });
});

describe("lifecycle coverage — resume", () => {
  it("happy path → exit 0 (status active)", () => {
    const r = run(["resume"]);
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal(["Project #43 → active"]);
  });

  it("label not applied → success with a warning suffix", () => {
    const r = run(["resume"], { anchor: { ...anchor, setState: () => false } });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Project #43 → active (anchor label not applied — check gh access)");
  });

  it("error: not on a project branch → exit 1", () => {
    const r = run(["resume"], { vcs: { ...fakeVcs(), currentBranch: () => "main" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["resume"], { authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized on GitHub Project #43.");
  });
});

describe("lifecycle coverage — cancel", () => {
  it("happy path → exit 0 (status cancelled) and closes the board", () => {
    let closed = 0;
    const r = run(["cancel"], { issues: { ...issues, closeBoard: () => { closed++; } } });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal(["Project #43 → cancelled"]);
    expect(closed).to.equal(1);
  });

  it("label not applied → success with a warning suffix", () => {
    const r = run(["cancel"], { anchor: { ...anchor, setState: () => false } });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal("Project #43 → cancelled (anchor label not applied — check gh access)");
  });

  it("error: not on a project branch → exit 1", () => {
    const r = run(["cancel"], { vcs: { ...fakeVcs(), currentBranch: () => "main" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["cancel"], { authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized on GitHub Project #43.");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  close  —  close   (no positionals, no flags)
// ════════════════════════════════════════════════════════════════════════════
describe("lifecycle coverage — close", () => {
  // A knowledge-close manifest that satisfies every required section, no placeholders.
  const MANIFEST = [
    "## Graduated to org knowledge",
    "## Kept project-local",
    "## Discarded",
    "## Journeys created / updated",
    "## Completeness critic",
  ].join("\n");

  /** An Fs that passes the pre-close knowledge gate. */
  const closeFs = (): Fs => ({
    pathExists: () => true,
    readFile: (p: string) => (p.endsWith("knowledge-close.md") ? MANIFEST : null),
    mkdirp: () => {}, writeFile: () => {}, rm: () => {},
    readdir: () => ["compliance.md", "knowledge-close.md"],
  });

  it("happy path → exit 0 with exact lines (PR url reported)", () => {
    const r = run(["close"], { fs: closeFs() });
    expect(r.code).to.equal(0);
    expect(r.lines).to.deep.equal([
      `Project ${PID} closed`,
      "  PR: pr",
    ]);
  });

  it("happy path with a null PR url → reports (merged)", () => {
    const r = run(["close"], { fs: closeFs(), pulls: { create: () => null, merge: () => "merged" } });
    expect(r.code).to.equal(0);
    expect(r.lines[1]).to.equal("  PR: (merged)");
  });

  it("happy path with a passing test-merge gate → exit 0", () => {
    const r = run(["close"], { fs: closeFs(), gate: () => ({ ok: true, failures: [] }) });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.equal(`Project ${PID} closed`);
  });

  it("error: not on a project branch → exit 1 (checked before the gate)", () => {
    const r = run(["close"], { vcs: { ...fakeVcs(), currentBranch: () => "main" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("'main' is not a project branch.");
  });

  it("error: knowledge gate fails → exit 1 with failure detail lines", () => {
    const r = run(["close"]); // default fs → empty knowledge/
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Pre-close knowledge gate failed.");
    expect(r.lines).to.include("knowledge/ is empty — document project learnings first.");
  });

  it("error: unauthorized → exit 1", () => {
    const r = run(["close"], { fs: closeFs(), authorize: () => false });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Not authorized to close GitHub Project #43.");
  });

  it("error: unmerged task sub-branches exist → exit 1 (open-tasks)", () => {
    const r = run(["close"], { fs: closeFs(), vcs: { ...fakeVcs(), remoteBranchesMatching: () => [`${PBRANCH}.ISSUE-9`] } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/^Unmerged task sub-branches exist — merge or cancel first:/);
    expect(r.lines[0]).to.contain(`${PBRANCH}.ISSUE-9`);
  });

  it("error: conflict syncing default → project branch → exit 2 (sync-conflict)", () => {
    const r = run(["close"], { fs: closeFs(), vcs: { ...fakeVcs(), mergeNoEdit: () => "conflict" } });
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal(`Merge conflict syncing main → ${PBRANCH}. Resolve, commit, then re-run.`);
  });

  it("error: code-repo merge conflict → exit 2 (code-merge-conflict)", () => {
    const vcs: Vcs = {
      ...fakeVcs(),
      // Sync merge (origin/main) succeeds; the code-repo merge (project branch) conflicts.
      mergeNoEdit: (_dir, from) => (from === PBRANCH ? "conflict" : "merged"),
    };
    const r = run(["close"], { fs: closeFs(), board: boardWithCodeRepo, vcs });
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.equal(`Merge conflict: ${PBRANCH} → dev in ${APP_DIR}. Resolve, commit, then re-run.`);
  });

  it("error: test-merge gate fails → exit 1 with failure detail lines", () => {
    const r = run(["close"], { fs: closeFs(), gate: () => ({ ok: false, failures: ["validator X failed"] }) });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Test-merge gate failed — nothing pushed.");
    expect(r.lines).to.include("validator X failed");
  });

  it("error: the close PR cannot be merged → exit 1 (pr-merge-failed)", () => {
    const r = run(["close"], { fs: closeFs(), pulls: { create: () => "pr", merge: () => "failed" } });
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("Could not merge the close PR (pr). Merge it manually, then re-run.");
  });
});
