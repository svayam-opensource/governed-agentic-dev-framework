// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { repoNameFromUrl, baseCloneDir } from "../../src/lifecycle/repo.js";
import { retry } from "../../src/lifecycle/retry.js";
import { setupCodeRepoWorktree, makeCloneRepo } from "../../src/lifecycle/code-repo.js";
import { Transaction } from "../../src/lifecycle/transaction.js";
import { createGitVcs, type Vcs, type FsProbe } from "../../src/lifecycle/vcs.js";

describe("prj-work Phase 2 — repo url helpers + retry", () => {
  it("repoNameFromUrl strips path + .git for ssh and https", () => {
    expect(repoNameFromUrl("git@github.com:Svayamtech/911-SVM-LIB-SVC.git")).to.equal("911-SVM-LIB-SVC");
    expect(repoNameFromUrl("https://github.com/Svayamtech/911-SVM-LIB-SVC")).to.equal("911-SVM-LIB-SVC");
    expect(repoNameFromUrl("https://github.com/o/name/")).to.equal("name");
  });

  it("baseCloneDir composes <agentWorkRoot>/.bases/<name>", () => {
    expect(baseCloneDir("/home/.svm/projects", "git@github.com:O/repo.git")).to.equal(
      "/home/.svm/projects/.bases/repo",
    );
  });

  it("retry succeeds after transient failures, with injected sleep + onRetry", () => {
    const sleeps: number[] = [];
    const retried: number[] = [];
    let n = 0;
    const r = retry(
      () => {
        n += 1;
        if (n < 3) throw new Error("transient");
        return "ok";
      },
      { attempts: 3, delayMs: 5, backoff: 2, sleep: (ms) => sleeps.push(ms), onRetry: (a) => retried.push(a) },
    );
    expect(r).to.equal("ok");
    expect(sleeps).to.deep.equal([5, 10]);
    expect(retried).to.deep.equal([1, 2]);
  });

  it("retry rethrows the last error after exhausting attempts", () => {
    expect(() => retry(() => { throw new Error("nope"); }, { attempts: 2 })).to.throw("nope");
  });
});

/** A recording fake Vcs; refs present are configurable. */
function fakeVcs(existingRefs: Set<string> = new Set()) {
  const calls: string[] = [];
  const vcs: Vcs = {
    localBranchExists: () => false,
    remoteBranchExists: () => false,
    headSha: () => "sha",
    refExists: (_repo, ref) => existingRefs.has(ref),
    lsRemoteHeads: () => [],
    defaultBranch: () => null,
    revParse: () => null,
    checkout: () => {},
    checkoutNew: () => {},
    addPath: () => {},
    commit: () => {},
    resetHard: () => {},
    cleanUntracked: () => {},
    worktreeAdd: (_b, br, wt) => calls.push(`worktreeAdd ${wt} ${br}`),
    worktreeRemove: (_b, wt) => calls.push(`worktreeRemove ${wt}`),
    branchDelete: (_r, br) => calls.push(`branchDelete ${br}`),
    push: (r, _rm, br) => calls.push(`push ${r} ${br}`),
    pushDelete: (r, _rm, br) => calls.push(`pushDelete ${r} ${br}`),
    clone: () => {},
    fetch: () => {},
    setIdentity: (r) => calls.push(`setIdentity ${r}`),
  };
  return { vcs, calls };
}

const PARAMS = {
  url: "git@github.com:Svayamtech/911-SVM-LIB-SVC.git",
  baseBranch: "dev",
  projectBranch: "BRNCH-43-governance-common-project",
  agentWorkRoot: "/awr",
  projectWorkRoot: "/awr/PRJ-43",
  identity: { name: "rk", email: "rk@x" },
};
const REPO_DIR = "/awr/PRJ-43/911-SVM-LIB-SVC";
const BASE_CLONE = "/awr/.bases/911-SVM-LIB-SVC";

describe("prj-work Phase 2 — setupCodeRepoWorktree (Phase C)", () => {
  it("clones the base only when missing, then worktrees + identity + push (in order)", () => {
    const { vcs, calls } = fakeVcs(new Set([`refs/remotes/origin/${PARAMS.baseBranch}`]));
    const tx = new Transaction();
    const clonedTo: string[] = [];
    const fsProbe: FsProbe = { pathExists: () => false }; // base clone absent
    const out = setupCodeRepoWorktree(
      { vcs, fs: fsProbe, tx, cloneRepo: (_u, dest) => clonedTo.push(dest) },
      PARAMS,
    );
    expect(out).to.deep.equal({ repoDir: REPO_DIR, baseClone: BASE_CLONE });
    expect(clonedTo).to.deep.equal([BASE_CLONE]);
    expect(calls).to.deep.equal([
      `worktreeAdd ${REPO_DIR} ${PARAMS.projectBranch}`,
      `setIdentity ${REPO_DIR}`,
      `push ${REPO_DIR} ${PARAMS.projectBranch}`,
    ]);
    expect(tx.pending).to.equal(2);
  });

  it("skips the clone when the base clone already exists", () => {
    const { vcs } = fakeVcs(new Set([`refs/remotes/origin/dev`]));
    const clonedTo: string[] = [];
    setupCodeRepoWorktree(
      { vcs, fs: { pathExists: () => true }, tx: new Transaction(), cloneRepo: (_u, d) => clonedTo.push(d) },
      PARAMS,
    );
    expect(clonedTo).to.deep.equal([]);
  });

  it("rollback removes the worktree/branch and deletes the pushed branch (LIFO)", () => {
    const { vcs, calls } = fakeVcs(new Set([`refs/remotes/origin/dev`]));
    const tx = new Transaction();
    setupCodeRepoWorktree({ vcs, fs: { pathExists: () => true }, tx, cloneRepo: () => {} }, PARAMS);
    calls.length = 0;
    tx.rollback();
    expect(calls).to.deep.equal([
      `pushDelete ${REPO_DIR} ${PARAMS.projectBranch}`,
      `worktreeRemove ${REPO_DIR}`,
      `branchDelete ${PARAMS.projectBranch}`,
    ]);
  });

  it("throws when the base branch is missing (no worktree registered)", () => {
    const { vcs } = fakeVcs(new Set()); // base ref absent
    const tx = new Transaction();
    expect(() =>
      setupCodeRepoWorktree({ vcs, fs: { pathExists: () => true }, tx, cloneRepo: () => {} }, PARAMS),
    ).to.throw(/Base branch 'dev' not found/);
    expect(tx.pending).to.equal(0);
  });

  it("throws when the project branch already exists in the repo", () => {
    const { vcs } = fakeVcs(
      new Set([`refs/remotes/origin/dev`, `refs/heads/${PARAMS.projectBranch}`]),
    );
    expect(() =>
      setupCodeRepoWorktree(
        { vcs, fs: { pathExists: () => true }, tx: new Transaction(), cloneRepo: () => {} },
        PARAMS,
      ),
    ).to.throw(/already exists/);
  });

  it("makeCloneRepo rm's the dest and retries via the injected runner", () => {
    const rmDirs: string[] = [];
    let attempts = 0;
    const cloneRepo = makeCloneRepo(
      {
        clone: () => {
          attempts += 1;
          if (attempts < 2) throw new Error("net");
        },
      },
      { rmDir: (d) => rmDirs.push(d), attempts: 3, sleep: () => {} },
    );
    cloneRepo("url", "/dest");
    expect(attempts).to.equal(2);
    expect(rmDirs).to.deep.equal(["/dest", "/dest"]); // rm before each attempt
  });
});

describe("prj-work Phase 2 — Vcs code-repo reads (real git)", () => {
  it("lsRemoteHeads + defaultBranch + clone against a local bare repo", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "prjwork-remote-")));
    try {
      const origin = path.join(tmp, "origin");
      fs.mkdirSync(origin);
      const g = (...a: string[]) => execFileSync("git", ["-C", origin, ...a], { encoding: "utf8" });
      g("init", "-q", "-b", "dev");
      g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init");
      g("branch", "feature-x");

      const vcs = createGitVcs();
      const heads = vcs.lsRemoteHeads(origin);
      expect(heads).to.have.members(["dev", "feature-x"]);
      expect(vcs.defaultBranch(origin)).to.equal("dev");

      const dest = path.join(tmp, "clone");
      vcs.clone(origin, dest);
      expect(fs.existsSync(path.join(dest, ".git"))).to.equal(true);
      expect(vcs.refExists(dest, "refs/remotes/origin/dev")).to.equal(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
