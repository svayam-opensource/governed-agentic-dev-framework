// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { repoNameFromUrl, baseCloneDir, basesRoot, ensureBaseFresh, syncAllBases } from "../../src/lifecycle/repo.js";
import { retry } from "../../src/lifecycle/retry.js";
import { setupCodeRepoWorktree, makeCloneRepo } from "../../src/lifecycle/code-repo.js";
import { Transaction } from "../../src/lifecycle/transaction.js";
import { createGitVcs, type Vcs, type FsProbe } from "../../src/lifecycle/vcs.js";
import { px, pxAll, pxDeep } from "../helpers/paths.js";
import { addRepo } from "../../src/lifecycle/add-repo.js";
import { createNodeFs } from "../../src/lifecycle/fs-io.js";
import { makeGitProject, simulateClose, remoteHas, PROJECT_BRANCH, CODE_REPO_NAME, type GitProject } from "../helpers/git-project-fixture.js";

describe("prj-work Phase 2 — repo url helpers + retry", () => {
  it("repoNameFromUrl strips path + .git for ssh and https", () => {
    expect(repoNameFromUrl("git@github.com:Svayamtech/911-SVM-LIB-SVC.git")).to.equal("911-SVM-LIB-SVC");
    expect(repoNameFromUrl("https://github.com/Svayamtech/911-SVM-LIB-SVC")).to.equal("911-SVM-LIB-SVC");
    expect(repoNameFromUrl("https://github.com/o/name/")).to.equal("name");
  });

  it("baseCloneDir composes <agentWorkRoot>/.bases/<name>", () => {
    expect(px(baseCloneDir("/home/.svm/projects", "git@github.com:O/repo.git"))).to.equal(
      "/home/.svm/projects/.bases/repo",
    );
  });

  it("basesRoot is the single spelling of the .bases layout constant", () => {
    expect(px(basesRoot("/home/.svm/projects"))).to.equal("/home/.svm/projects/.bases");
  });

  describe("ensureBaseFresh — the single base-access seam (clone-if-missing + ALWAYS sync)", () => {
    const url = "git@github.com:O/repo.git";
    const mkIo = (present: boolean) => {
      const calls = { clone: [] as string[][], fetch: [] as unknown[][] };
      const io = {
        pathExists: (p: string) => present && p.endsWith(path.join(".bases", "repo", ".git")),
        cloneRepo: (u: string, d: string) => calls.clone.push([u, d]),
        fetch: (d: string, r: string, ref?: string) => calls.fetch.push([d, r, ref]),
      };
      return { io, calls };
    };

    it("clones on first use, then fetches, and returns the base-clone path", () => {
      const { io, calls } = mkIo(false);
      const dir = ensureBaseFresh(io, "/w", url, "origin", "dev");
      expect(px(dir)).to.equal("/w/.bases/repo");
      expect(pxDeep(calls.clone)).to.deep.equal([[url, "/w/.bases/repo"]]);
      expect(pxDeep(calls.fetch)).to.deep.equal([["/w/.bases/repo", "origin", "dev"]]);
    });

    it("when the base clone already exists → NO clone, but STILL fetches (sync is the contract)", () => {
      const { io, calls } = mkIo(true);
      ensureBaseFresh(io, "/w", url, "origin", "dev");
      expect(pxDeep(calls.clone)).to.deep.equal([]);
      expect(pxDeep(calls.fetch)).to.deep.equal([["/w/.bases/repo", "origin", "dev"]]);
    });
  });

  describe("syncAllBases — fetch every present base clone (the deploy-path counterpart)", () => {
    it("fetches origin for each base-clone dir under <basesRoot>", () => {
      const fetched: string[] = [];
      syncAllBases(
        { listBaseDirs: (root) => (px(root) === "/w/.bases" ? ["repo-a", "repo-b"] : []), fetch: (d) => fetched.push(d) },
        "/w",
      );
      expect(pxAll(fetched)).to.deep.equal(["/w/.bases/repo-a", "/w/.bases/repo-b"]);
    });

    it("no bases present → no fetches (never throws)", () => {
      let n = 0;
      syncAllBases({ listBaseDirs: () => [], fetch: () => { n++; } }, "/w");
      expect(n).to.equal(0);
    });
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
    // The base exists; no project branch yet — the ordinary case the preflight sees.
    lsRemoteRefs: () => [{ name: "dev", sha: "base-sha" }],
    defaultBranch: () => null,
    revParse: () => null,
    currentBranch: () => "BRNCH-43-x",
    isAncestor: () => false,
    isClean: () => true,
    remoteBranchesMatching: () => [],
    checkout: () => {},
    checkoutNew: () => {},
    mergeNoEdit: () => "merged",
    tag: () => {},
    addPath: () => {},
    commit: () => {},
    resetHard: () => {}, resetKeepingFiles: () => {},
    cleanUntracked: () => {},
    // `worktree add -b` creates the ref, as git does — the rollback deletes only a ref that is there (#214).
    worktreeAdd: (_b, br, wt) => { existingRefs.add(`refs/heads/${br}`); calls.push(`worktreeAdd ${wt} ${br}`); },
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
    expect(pxDeep(out)).to.deep.equal({ repoDir: REPO_DIR, baseClone: BASE_CLONE });
    expect(pxDeep(clonedTo)).to.deep.equal([BASE_CLONE]);
    expect(pxDeep(calls)).to.deep.equal([
      `worktreeAdd ${REPO_DIR} ${PARAMS.projectBranch}`,
      `setIdentity ${REPO_DIR}`,
      `push ${REPO_DIR} ${PARAMS.projectBranch}`,
    ]);
    expect(tx.pending).to.equal(3); // branch ref (#214) + worktree + push
  });

  it("skips the clone when the base clone already exists", () => {
    const { vcs } = fakeVcs(new Set([`refs/remotes/origin/dev`]));
    const clonedTo: string[] = [];
    setupCodeRepoWorktree(
      { vcs, fs: { pathExists: (q) => q.endsWith(".git") }, tx: new Transaction(), cloneRepo: (_u, d) => clonedTo.push(d) },
      PARAMS,
    );
    expect(pxDeep(clonedTo)).to.deep.equal([]);
  });

  it("rollback removes the worktree/branch and deletes the pushed branch (LIFO)", () => {
    const { vcs, calls } = fakeVcs(new Set([`refs/remotes/origin/dev`]));
    const tx = new Transaction();
    setupCodeRepoWorktree({ vcs, fs: { pathExists: (q) => q.endsWith(".git") }, tx, cloneRepo: () => {} }, PARAMS);
    calls.length = 0;
    tx.rollback();
    expect(pxDeep(calls)).to.deep.equal([
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
        { vcs, fs: { pathExists: (q) => q.endsWith(".git") }, tx: new Transaction(), cloneRepo: () => {} },
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
    expect(pxAll(rmDirs)).to.deep.equal(["/dest", "/dest"]); // rm before each attempt
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

// ── #214 / #224: what a previous attempt (or a closed project) left at the path ──────────────────────────────
describe("add-repo — leftovers at the worktree path (#214) and a present worktree (#224), real git", () => {
  let p: GitProject;
  beforeEach(() => { p = makeGitProject(); });
  afterEach(() => p.cleanup());

  const run = (fsOverride?: Partial<ReturnType<typeof createNodeFs>>) => {
    const vcs = createGitVcs();
    const lines: string[] = [];
    const r = addRepo(
      { vcs, fs: { ...createNodeFs(), ...fsOverride }, cloneRepo: (u, d) => vcs.clone(u, d), authorize: () => true, log: (m) => lines.push(m) },
      { githubOrg: "o", agentWorkRoot: p.agentWorkRoot, defaultCodeBranch: "dev" },
      { govClone: p.govClone, projectWorkRoot: p.projectWorkRoot, repoUrl: p.codeUrl },
    );
    return { r, lines };
  };

  it("a stale clone at the path → add-repo succeeds, and the old clone is archived (never deleted)", () => {
    execFileSync("git", ["clone", "-q", p.codeUrl, p.codeDir], { stdio: "ignore" });
    fs.writeFileSync(path.join(p.codeDir, "mine.txt"), "evidence\n");

    const { r, lines } = run();

    expect(r.ok, r.ok ? "" : r.message).to.equal(true);
    expect(p.git(p.codeDir, "branch", "--show-current").trim()).to.equal(PROJECT_BRANCH);
    expect(remoteHas(p, PROJECT_BRANCH)).to.equal(true);
    const stamps = fs.readdirSync(path.join(p.projectWorkRoot, "archive"));
    expect(stamps).to.have.length(1);
    const archived = path.join(p.projectWorkRoot, "archive", stamps[0]!, CODE_REPO_NAME);
    expect(fs.readFileSync(path.join(archived, "mine.txt"), "utf8")).to.equal("evidence\n");
    expect(lines.join("\n")).to.include(`archived the previous attempt → ${archived}`);
  });

  it("a failed `worktree add -b` leaves no ref behind, and the message names the real path", () => {
    // The path is occupied, but the probe says it is free — so nothing is archived and git itself fails,
    // AFTER it has created the branch. That ref is what made every retry fail (#214).
    fs.mkdirSync(p.codeDir, { recursive: true });
    fs.writeFileSync(path.join(p.codeDir, "x"), "x");
    const { r } = run({ pathExists: (q: string) => q !== p.codeDir && fs.existsSync(q) });

    expect(r.ok).to.equal(false);
    if (!r.ok) {
      expect(r.message).to.include(p.codeDir);
      expect(r.rollbackFailures ?? []).to.deep.equal([]);
    }
    expect(p.git(p.baseClone, "branch", "--list", PROJECT_BRANCH).trim()).to.equal("");
    expect(remoteHas(p, PROJECT_BRANCH)).to.equal(false);
  });

  it("a present worktree whose project branch is gone (closed, then reopened) is reused and the branch recreated", () => {
    expect(run().r.ok).to.equal(true);
    simulateClose(p);

    const { r, lines } = run();

    expect(r.ok, r.ok ? "" : r.message).to.equal(true);
    expect(p.git(p.codeDir, "branch", "--show-current").trim()).to.equal(PROJECT_BRANCH);
    expect(remoteHas(p, PROJECT_BRANCH)).to.equal(true);
    expect(fs.existsSync(path.join(p.projectWorkRoot, "archive"))).to.equal(false); // reused, not archived
    expect(lines.join("\n")).to.match(/recreated '.*' in .*911-SVM-LIB-SVC off origin\/dev/);
  });

  it("add-repo run twice is a no-op the second time (the worktree is already on the project branch)", () => {
    expect(run().r.ok).to.equal(true);
    const { r } = run();
    expect(r.ok, r.ok ? "" : r.message).to.equal(true);
    expect(fs.existsSync(path.join(p.projectWorkRoot, "archive"))).to.equal(false);
  });
});

describe("setupCodeRepoWorktree — the refusal names where the branch actually is (#214)", () => {
  it("a LOCAL branch with commits of its own is reported in the base clone, not on the remote", () => {
    const { vcs } = fakeVcs(new Set([`refs/remotes/origin/dev`, `refs/heads/${PARAMS.projectBranch}`]));
    const v = { ...vcs, revParse: (_r: string, rev: string) => (rev === "origin/dev" ? "base" : "other") };
    expect(() =>
      setupCodeRepoWorktree({ vcs: v, fs: { pathExists: (q) => q.endsWith(".git") }, tx: new Transaction(), cloneRepo: () => {} }, PARAMS),
    ).to.throw(/locally, in the base clone at .*911-SVM-LIB-SVC/);
  });
});
