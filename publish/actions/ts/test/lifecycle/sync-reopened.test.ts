// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * #224 / Q17 (A): a closed project is reopened. `gov close` deleted the code repos' project branches, the local
 * worktrees are still there (detached on the base), and `gov sync` / `gov task` died on `git checkout <branch>`.
 * Now both recreate the missing branch off the base and SAY so. Real git, nothing on the network.
 */
import { expect } from "chai";
import { sync } from "../../src/lifecycle/sync.js";
import { task } from "../../src/lifecycle/task-run.js";
import { addRepo } from "../../src/lifecycle/add-repo.js";
import { createGitVcs } from "../../src/lifecycle/vcs.js";
import { createNodeFs } from "../../src/lifecycle/fs-io.js";
import type { Board } from "../../src/lifecycle/board.js";
import type { Issues } from "../../src/lifecycle/issues.js";
import { makeGitProject, simulateClose, remoteHas, PROJECT_BRANCH, type GitProject } from "../helpers/git-project-fixture.js";

describe("reopened project — gov sync and gov task recreate a missing project branch (#224, Q17 A)", () => {
  let p: GitProject;
  let board: Board;
  const vcs = createGitVcs();
  const fs = createNodeFs();

  beforeEach(() => {
    p = makeGitProject();
    board = { fetchProject: () => ({ id: "P", title: "T", shortDescription: null, linkedItemCount: 1, repoUrls: [p.codeUrl] }) };
    const added = addRepo(
      { vcs, fs, cloneRepo: (u, d) => vcs.clone(u, d), authorize: () => true },
      { githubOrg: "o", agentWorkRoot: p.agentWorkRoot, defaultCodeBranch: "dev" },
      { govClone: p.govClone, projectWorkRoot: p.projectWorkRoot, repoUrl: p.codeUrl },
    );
    expect(added.ok, added.ok ? "" : added.message).to.equal(true);
    simulateClose(p);
  });
  afterEach(() => p.cleanup());

  it("gov sync succeeds, recreates the branch off the base, and prints the recreated line", () => {
    const lines: string[] = [];
    const r = sync(
      { board, vcs, fs, authorize: () => true, log: (m) => lines.push(m) },
      { githubOrg: "o", workspaceRepo: "svm-prj-work", defaultBranch: "main", defaultCodeBranch: "dev" },
      { govClone: p.govClone, projectWorkRoot: p.projectWorkRoot },
    );
    expect(r.ok, r.ok ? "" : r.message).to.equal(true);
    if (r.ok) expect(r.recreated).to.deep.equal([p.codeDir]);
    expect(lines.join("\n")).to.include(`recreated '${PROJECT_BRANCH}' in ${p.codeDir} off origin/dev`);
    expect(p.git(p.codeDir, "branch", "--show-current").trim()).to.equal(PROJECT_BRANCH);
    expect(remoteHas(p, PROJECT_BRANCH)).to.equal(true);
  });

  it("gov task succeeds in the same state, and prints the recreated line", () => {
    const issues = { state: () => "OPEN", assign: () => {} } as unknown as Issues;
    const lines: string[] = [];
    const r = task(
      { board, vcs, fs, issues, authorize: () => true, log: (m) => lines.push(m) },
      { githubOrg: "o", workspaceRepo: "svm-prj-work", defaultCodeBranch: "dev" },
      { govClone: p.govClone, projectWorkRoot: p.projectWorkRoot, issueUrls: ["https://github.com/o/svm-prj-work/issues/7"], assignee: "me" },
    );
    expect(r.ok, r.ok ? "" : r.message).to.equal(true);
    if (r.ok) expect(r.reposBranched).to.include(p.codeDir);
    expect(lines.join("\n")).to.include(`recreated '${PROJECT_BRANCH}' in ${p.codeDir} off origin/dev`);
    expect(p.git(p.codeDir, "branch", "--show-current").trim()).to.equal(`${PROJECT_BRANCH}.ISSUE-7`);
    expect(remoteHas(p, PROJECT_BRANCH)).to.equal(true);
  });
});
