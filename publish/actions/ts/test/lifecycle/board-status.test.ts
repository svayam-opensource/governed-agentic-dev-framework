// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * gadf#225 — task / merge / close / cancel go through the WorkTrackerPort and REPORT what happened on the board
 * (PRJ-121 intent 05, Item 3, ruling Q4). A board that cannot be updated never fails the command: it still exits
 * 0, and prints one line saying which issue and why.
 */
import { expect } from "chai";
import { route, type CliContext } from "../../src/cli/dispatch.js";
import { parseArgv } from "../../src/cli/args.js";
import { task } from "../../src/lifecycle/task-run.js";
import { merge } from "../../src/lifecycle/merge.js";
import { cancel } from "../../src/lifecycle/state.js";
import type { BoardWriter, BoardStatusResult, BoardCloseResult } from "../../src/ports/work-tracker.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";

const noop = () => {};
function fakeVcs(over: Partial<Vcs> = {}): Vcs {
  return {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h", refExists: () => false, lsRemoteHeads: () => [],
    lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }], defaultBranch: () => null, revParse: () => null,
    currentBranch: () => "BRNCH-43-governance-common-project", isAncestor: () => false, isClean: () => true,
    remoteBranchesMatching: () => [], addPath: noop, commit: noop, resetHard: noop, resetKeepingFiles: noop, cleanUntracked: noop,
    worktreeAdd: noop, worktreeAddExisting: noop, worktreeRemove: noop, branchDelete: noop, push: noop, pushDelete: noop, clone: noop,
    fetch: noop, setIdentity: noop, checkout: noop, checkoutNew: noop, mergeNoEdit: () => "merged", tag: noop,
    ...over,
  };
}
const board: Board = { fetchProject: () => ({ id: "P", title: "T", shortDescription: null, linkedItemCount: 1, repoUrls: [] }) };
const fs: Fs = { pathExists: () => false, readFile: () => null, mkdirp: noop, writeFile: noop, rm: noop, readdir: () => [] };
const issues: Issues = { state: () => "OPEN", assign: noop, close: noop, resolveIssueUrl: () => null } as unknown as Issues;
const anchor: AnchorCreator = { createAnchorIssue: () => "r#1", setState: () => true };
const ISSUE = "https://github.com/Svayamtech/x/issues/9";
const CFG = { githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work" };

function tracker(status: BoardStatusResult = { ok: true }, closed: BoardCloseResult = { ok: true }) {
  const calls: string[] = [];
  const t: BoardWriter = {
    setState: (ref, url, s) => { calls.push(`status #${ref.number} ${url} ${s}`); return status; },
    closeProject: (ref) => { calls.push(`close #${ref.number}`); return closed; },
  };
  return { t, calls };
}
const WHYS: BoardStatusResult[] = [
  { ok: false, why: "no-field", detail: "board #43 has no single-select field named Status" },
  { ok: false, why: "no-option", detail: "Status on board #43 has no option \"In progress\" (options: Todo, Done)" },
  { ok: false, why: "not-on-board", detail: "the issue is not on board #43" },
  { ok: false, why: "denied", detail: "Resource not accessible by personal access token" },
  { ok: false, why: "unreachable", detail: "EOF" },
];

describe("gadf#225 — task / merge set the board Status through the WorkTrackerPort", () => {
  const base = { board, vcs: fakeVcs({ remoteBranchExists: () => false }), fs: { pathExists: () => false }, issues, authorize: () => true };
  const input = { govClone: "/g", projectWorkRoot: "/w", issueUrls: [ISSUE], assignee: "me" };

  it("task sets 'In progress' and returns the outcome per issue", () => {
    const { t, calls } = tracker();
    const r = task({ ...base, tracker: t }, CFG, input);
    expect(r.ok).to.equal(true);
    expect(calls).to.deep.equal([`status #43 ${ISSUE} in-progress`]);
    if (r.ok) expect(r.boardStatus).to.deep.equal([{ issueUrl: ISSUE, status: "In progress", result: { ok: true } }]);
  });

  for (const why of WHYS) {
    it(`task still succeeds when the board says ${why.ok ? "" : why.why}`, () => {
      const r = task({ ...base, tracker: tracker(why).t }, CFG, input);
      expect(r.ok).to.equal(true);
      if (r.ok) expect(r.boardStatus[0].result).to.deep.equal(why);
    });
  }

  it("no tracker wired → reported as unreachable, never silent", () => {
    const r = task(base, CFG, input);
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.boardStatus[0].result).to.include({ ok: false, why: "unreachable" });
  });

  it("merge sets 'Done' after closing the issue", () => {
    const { t, calls } = tracker();
    const r = merge({ board, vcs: fakeVcs(), fs: { pathExists: () => false }, issues, authorize: () => true, tracker: t }, CFG,
      { govClone: "/g", projectWorkRoot: "/w", taskArg: ISSUE });
    expect(r.ok).to.equal(true);
    expect(calls).to.deep.equal([`status #43 ${ISSUE} done`]);
    if (r.ok) expect(r.boardStatus).to.deep.equal([{ issueUrl: ISSUE, status: "Done", result: { ok: true } }]);
  });

  it("cancel closes the board through the port and returns the outcome", () => {
    const { t, calls } = tracker(undefined, { ok: false, why: "denied", detail: "HTTP 403" });
    const r = cancel({ vcs: fakeVcs(), anchor, authorize: () => true, tracker: t }, CFG, { govClone: "/g" });
    expect(calls).to.deep.equal(["close #43"]);
    expect(r).to.include({ ok: true, status: "cancelled" });
    if (r.ok) expect(r.boardClosed).to.deep.equal({ ok: false, why: "denied", detail: "HTTP 403" });
  });
});

const CONFIG = {
  orgName: "Svayam", orgShortName: "Svayam", orgSlug: "SVM", orgSlugLower: "svm",
  orgRepoUrl: "https://github.com/Svayamtech/svm-prj-work", githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work",
  defaultBranch: "main", defaultCodeBranch: "dev", agentWorkRoot: "/awr",
} as unknown as OrgConfig;
function ctx(over: Partial<CliContext> = {}): CliContext {
  return {
    config: CONFIG, home: "/awr/PRJ-43-governance-common-project/svm-prj-work", today: "2026-07-03",
    seededBy: "svayam-rkant", login: "svayam-rkant", board, vcs: fakeVcs({ remoteBranchExists: () => false }), fs, issues, anchor,
    pulls: { create: () => "pr", state: () => null }, projects: { listBoards: () => [] }, cloneRepo: noop, authorize: () => true,
    gate: () => ({ ok: true, failures: [] }), ...over,
  };
}
const run = (argv: string[], over: Partial<CliContext> = {}) => route(parseArgv(argv) as never, ctx(over));

describe("gadf#225 — what task / merge / cancel print about the board", () => {
  it("task: `board: #9 Status → In progress`", () => {
    const r = run(["task", ISSUE], { workTracker: tracker().t });
    expect(r.code).to.equal(0);
    expect(r.lines).to.include("  board: #9 Status → In progress");
  });

  for (const why of WHYS) {
    if (why.ok) continue;
    it(`task exits 0 and prints \`board: Status not set — ${why.why}\``, () => {
      const r = run(["task", ISSUE], { workTracker: tracker(why).t });
      expect(r.code).to.equal(0);
      expect(r.lines).to.include(`  board: Status not set — ${why.why} (#9: ${why.detail})`);
    });
  }

  it("merge: `board: #9 Status → Done`, or the reason it was not set (exit 0 either way)", () => {
    const merged = { vcs: fakeVcs() };
    const ok = run(["merge", ISSUE], { ...merged, workTracker: tracker().t });
    expect(ok.code).to.equal(0);
    expect(ok.lines).to.include("  board: #9 Status → Done");
    const denied = run(["merge", ISSUE], { ...merged, workTracker: tracker(WHYS[3]).t });
    expect(denied.code).to.equal(0);
    expect(denied.lines).to.include(`  board: Status not set — denied (#9: ${(WHYS[3] as { detail: string }).detail})`);
  });

  it("cancel: says when the board could not be closed", () => {
    const r = run(["cancel"], { vcs: fakeVcs(), workTracker: tracker(undefined, { ok: false, why: "unreachable", detail: "EOF" }).t });
    expect(r.code).to.equal(0);
    expect(r.lines).to.include("  board: not closed — unreachable (EOF)");
  });
});
