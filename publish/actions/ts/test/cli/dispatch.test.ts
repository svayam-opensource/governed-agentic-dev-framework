// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { parseArgv, flagStr } from "../../src/cli/args.js";
import { route, type CliContext } from "../../src/cli/dispatch.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import type { AnchorCreator } from "../../src/lifecycle/anchor.js";
import type { Pulls } from "../../src/lifecycle/pulls.js";

describe("prj-work — parseArgv", () => {
  it("splits command, positionals, and flags", () => {
    expect(parseArgv(["task", "https://x/issues/1", "--assignee=me"])).to.deep.equal({
      command: "task",
      positionals: ["https://x/issues/1"],
      flags: { assignee: "me" },
    });
  });
  it("supports --flag value and boolean --flag", () => {
    const p = parseArgv(["seed", "url", "--login", "rk", "--force"]) as { flags: Record<string, unknown> };
    expect(p.flags).to.deep.equal({ login: "rk", force: true });
    expect(flagStr(p.flags as Record<string, string | boolean>, "login")).to.equal("rk");
  });
  it("errors on no command", () => {
    expect(parseArgv([])).to.have.property("error");
  });
});

const CONFIG: OrgConfig = {
  orgName: "Svayam", orgShortName: "Svayam", orgSlug: "SVM", orgSlugLower: "svm",
  githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work", orgRepoUrl: "git@github.com:Svayamtech/svm-prj-work.git",
  defaultBranch: "main", defaultCodeBranch: "dev",
  agentWorkRoot: "/awr", govWorkspace: "/gov", policyOwnerEmail: "rk@x", orgTokens: {},
};

/** A Vcs whose branch is a project branch so from-workspace commands resolve. */
function fakeVcs(): Vcs {
  const noop = () => {};
  return {
    localBranchExists: () => false, remoteBranchExists: () => true, headSha: () => "h",
    refExists: () => false, lsRemoteHeads: () => [], defaultBranch: () => null, revParse: () => null,
    currentBranch: () => "BRNCH-43-governance-common-project", isAncestor: () => false, isClean: () => true,
    remoteBranchesMatching: () => [], addPath: noop, commit: noop, resetHard: noop, cleanUntracked: noop,
    worktreeAdd: noop, worktreeRemove: noop, branchDelete: noop, push: noop, pushDelete: noop, clone: noop,
    fetch: noop, setIdentity: noop, checkout: noop, checkoutNew: noop, mergeNoEdit: () => "merged", tag: noop,
  };
}
const board: Board = { fetchProject: () => ({ id: "P", title: "@Governance Common Project", shortDescription: null, linkedItemCount: 1, repoUrls: [] }) };
const fs: Fs = { pathExists: () => false, readFile: () => null, mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [] };
const issues: Issues = { state: () => "OPEN", assign: () => {}, setBoardStatus: () => {}, close: () => {}, resolveIssueUrl: () => null, closeBoard: () => {} };
const anchor: AnchorCreator = { createAnchorIssue: () => "r#1", setState: () => true };
const pulls: Pulls = { create: () => "pr", merge: () => "merged" };

function ctx(over: Partial<CliContext> = {}): CliContext {
  return {
    config: CONFIG, home: "/awr/PRJ-43-governance-common-project/svm-prj-work", today: "2026-07-03",
    seededBy: "svayam-rkant", board, vcs: fakeVcs(), fs, issues, anchor, pulls, projects: { listBoards: () => [] }, cloneRepo: () => {}, authorize: () => true, gate: () => ({ ok: true, failures: [] }), ...over,
  };
}

describe("prj-work — route (dispatcher)", () => {
  it("routes `task` to the task orchestrator (exit 0)", () => {
    const r = route(parseArgv(["task", "https://github.com/Svayamtech/x/issues/9"]) as never, ctx());
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/^Task BRNCH-43-governance-common-project\.ISSUE-9/);
  });

  it("routes `pause` and reports the derived status", () => {
    const r = route(parseArgv(["pause"]) as never, ctx());
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/Project #43 → paused/);
  });

  it("routes `merge` (issue URL arg)", () => {
    const r = route(parseArgv(["merge", "https://github.com/Svayamtech/x/issues/9"]) as never, ctx());
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/Merged .*ISSUE-9 →/);
  });

  it("returns usage (exit 2) when a required arg is missing", () => {
    expect(route(parseArgv(["task"]) as never, ctx()).code).to.equal(2);
    expect(route(parseArgv(["merge"]) as never, ctx()).code).to.equal(2);
  });

  it("rejects an unknown command (exit 2)", () => {
    const r = route(parseArgv(["frobnicate"]) as never, ctx());
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.match(/unknown command 'frobnicate'/);
  });

  it("surfaces an orchestrator failure code (e.g. not-a-project-branch)", () => {
    const badVcs = { ...fakeVcs(), currentBranch: () => "main" };
    const r = route(parseArgv(["pause"]) as never, ctx({ vcs: badVcs }));
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/not a project branch/);
  });
});

// The verbs gov used to DELEGATE now belong to other binaries (adr-three-clients, PRJ-43). Removing a verb
// costs whoever types it next, so the removal has to answer them: the reader knows `deploy` exists, so the
// useful reply is which client owns it — not "unknown command".
describe("cli — verbs that MOVED to another client", () => {
  const lines = (cmd: string): string => route(parseArgv([cmd]) as never, ctx()).lines.join("\n");

  it("names the owning client and the exact command to run", () => {
    const out = lines("deploy");
    expect(out).to.match(/'deploy' is a gov-cicd verb/);
    expect(out, "the fix must be runnable, not described").to.contain("gov-cicd deploy");
    expect(out).to.contain("npm i -g @svayam/gov-cicd");
  });

  it("covers the infra plane too", () => {
    expect(lines("infra")).to.match(/gov-infra/);
  });

  it("still exits 2 — a moved verb is a usage error, not a success", () => {
    expect(route(parseArgv(["deploy"]) as never, ctx()).code).to.equal(2);
  });

  it("a genuinely unknown command is still 'unknown command'", () => {
    const out = lines("wibble");
    expect(out).to.match(/unknown command 'wibble'/);
    expect(out, "no client owns it, so none may be suggested").to.not.match(/gov-cicd|gov-infra/);
  });
});
