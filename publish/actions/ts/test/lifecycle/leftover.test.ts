// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  seedPathsFor,
  detectLeftovers,
  leftoversMessage,
  type SeedPaths,
} from "../../src/lifecycle/leftover.js";
import { createGitVcs, nodeFsProbe, type Vcs, type FsProbe } from "../../src/lifecycle/vcs.js";

const PATHS: SeedPaths = seedPathsFor({
  govHome: "/home/.svm/gov_repo",
  agentWorkRoot: "/home/.svm/projects",
  projectId: "PRJ-43-governance-common-project",
  branch: "BRNCH-43-governance-common-project",
});

/** A Vcs/FsProbe double driven by explicit boolean answers. */
function makeEnv(a: {
  local?: boolean;
  remote?: boolean;
  workRoot?: boolean;
  homeStub?: boolean;
}): { vcs: Vcs; fs: FsProbe } {
  return {
    vcs: {
      localBranchExists: () => a.local ?? false,
      remoteBranchExists: () => a.remote ?? false,
    },
    fs: {
      pathExists: (p) =>
        (p === PATHS.projectWorkRoot && (a.workRoot ?? false)) ||
        (p === PATHS.homeStub && (a.homeStub ?? false)),
    },
  };
}

describe("prj-work Phase 2 — seed leftover detection", () => {
  it("seedPathsFor composes the workspace root and home stub", () => {
    expect(PATHS.projectWorkRoot).to.equal("/home/.svm/projects/PRJ-43-governance-common-project");
    expect(PATHS.homeStub).to.equal("/home/.svm/gov_repo/projects/PRJ-43-governance-common-project");
    expect(PATHS.remote).to.equal("origin");
  });

  it("returns nothing on a clean slate", () => {
    expect(detectLeftovers(makeEnv({}), PATHS)).to.deep.equal([]);
    expect(leftoversMessage([])).to.equal("");
  });

  it("detects all four artifact kinds in seed.sh order, with cleanup data", () => {
    const found = detectLeftovers(
      makeEnv({ local: true, remote: true, workRoot: true, homeStub: true }),
      PATHS,
    );
    expect(found.map((l) => l.kind)).to.deep.equal([
      "local-branch",
      "remote-branch",
      "workspace-dir",
      "home-stub",
    ]);
    expect(found[0]).to.include({ branch: PATHS.branch, repoDir: PATHS.govHome });
    expect(found[1]).to.include({ remote: "origin" });
    expect(found[2]).to.include({ path: PATHS.projectWorkRoot });
    expect(found[3]).to.include({ path: PATHS.homeStub });
  });

  it("detects a subset (remote branch only)", () => {
    const found = detectLeftovers(makeEnv({ remote: true }), PATHS);
    expect(found.map((l) => l.kind)).to.deep.equal(["remote-branch"]);
    expect(leftoversMessage(found)).to.match(/remote branch 'origin\/BRNCH-43/);
  });
});

describe("prj-work Phase 2 — git Vcs adapter", () => {
  it("localBranchExists maps git exit status via an injected runner", () => {
    const calls: string[][] = [];
    const vcs = createGitVcs((args) => {
      calls.push(args);
      return { status: args.includes("refs/heads/exists") ? 0 : 1, stdout: "" };
    });
    expect(vcs.localBranchExists("/r", "exists")).to.equal(true);
    expect(vcs.localBranchExists("/r", "nope")).to.equal(false);
    expect(calls[0]).to.deep.equal(["-C", "/r", "rev-parse", "--verify", "--quiet", "refs/heads/exists"]);
  });

  it("remoteBranchExists uses ls-remote --exit-code", () => {
    const vcs = createGitVcs((args) => ({ status: args.includes("here") ? 0 : 2, stdout: "" }));
    expect(vcs.remoteBranchExists("/r", "origin", "here")).to.equal(true);
    expect(vcs.remoteBranchExists("/r", "origin", "gone")).to.equal(false);
  });

  it("end-to-end against a real git repo (default runner)", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "prjwork-git-"));
    try {
      const g = (...args: string[]) =>
        execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
      g("init", "-q");
      g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init");
      g("branch", "BRNCH-99-feature");
      const vcs = createGitVcs();
      expect(vcs.localBranchExists(repo, "BRNCH-99-feature")).to.equal(true);
      expect(vcs.localBranchExists(repo, "does-not-exist")).to.equal(false);
      expect(nodeFsProbe.pathExists(repo)).to.equal(true);
      expect(nodeFsProbe.pathExists(path.join(repo, "nope"))).to.equal(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
