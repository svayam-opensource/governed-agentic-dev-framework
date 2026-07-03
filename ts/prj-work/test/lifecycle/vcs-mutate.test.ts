// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createGitVcs, type RunGit } from "../../src/lifecycle/vcs.js";

/** A runGit spy: records args, returns a scripted status per matcher. */
function spy(statusFor: (args: string[]) => number = () => 0) {
  const calls: string[][] = [];
  const runGit: RunGit = (args) => {
    calls.push(args);
    return { status: statusFor(args), stdout: "abc123\n", stderr: "boom" };
  };
  return { calls, runGit };
}

describe("prj-work Phase 2 — Vcs mutating ops (injected runner)", () => {
  it("issues the expected git args for each operation", () => {
    const { calls, runGit } = spy();
    const vcs = createGitVcs(runGit);
    vcs.addPath("/r", "projects/PRJ-43");
    vcs.commit("/r", "seed: scaffold");
    vcs.resetHard("/r", "deadbeef");
    vcs.cleanUntracked("/r", "projects");
    vcs.worktreeAdd("/base", "BRNCH-43", "/wt", "main");
    vcs.branchDelete("/base", "BRNCH-43");
    vcs.push("/r", "origin", "BRNCH-43", { setUpstream: true });
    vcs.push("/r", "origin", "main");
    vcs.pushDelete("/r", "origin", "BRNCH-43");
    expect(calls).to.deep.equal([
      ["-C", "/r", "add", "projects/PRJ-43"],
      ["-C", "/r", "commit", "-m", "seed: scaffold"],
      ["-C", "/r", "reset", "--hard", "deadbeef"],
      ["-C", "/r", "clean", "-fd", "projects"],
      ["-C", "/base", "worktree", "add", "-b", "BRNCH-43", "/wt", "main"],
      ["-C", "/base", "branch", "-D", "BRNCH-43"],
      ["-C", "/r", "push", "-u", "origin", "BRNCH-43"],
      ["-C", "/r", "push", "origin", "main"],
      ["-C", "/r", "push", "origin", "--delete", "BRNCH-43"],
    ]);
  });

  it("headSha trims the rev-parse output", () => {
    const { runGit } = spy();
    expect(createGitVcs(runGit).headSha("/r")).to.equal("abc123");
  });

  it("throws on a non-zero mutating command, surfacing stderr", () => {
    const vcs = createGitVcs(spy(() => 1).runGit);
    expect(() => vcs.commit("/r", "x")).to.throw(/git .*commit.* failed \(exit 1\): boom/);
  });

  it("worktreeRemove falls back to prune when `worktree remove` fails", () => {
    const calls: string[][] = [];
    const runGit: RunGit = (args) => {
      calls.push(args);
      return { status: args.includes("remove") ? 1 : 0, stdout: "", stderr: "" };
    };
    createGitVcs(runGit).worktreeRemove("/base", "/wt");
    expect(calls[0]).to.deep.equal(["-C", "/base", "worktree", "remove", "--force", "/wt"]);
    expect(calls[1]).to.deep.equal(["-C", "/base", "worktree", "prune"]);
  });
});

describe("prj-work Phase 2 — Vcs mutating ops (real git worktree round-trip)", () => {
  it("worktreeAdd creates a branch + worktree; worktreeRemove + branchDelete clean it", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "prjwork-wt-")));
    try {
      const base = path.join(tmp, "base");
      fs.mkdirSync(base);
      const g = (...a: string[]) => execFileSync("git", ["-C", base, ...a], { encoding: "utf8" });
      g("init", "-q");
      g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init");

      const vcs = createGitVcs();
      const wt = path.join(tmp, "wt");
      const startPoint = g("rev-parse", "--abbrev-ref", "HEAD").trim();
      vcs.worktreeAdd(base, "BRNCH-99", wt, startPoint);
      expect(fs.existsSync(path.join(wt, ".git"))).to.equal(true);
      expect(vcs.localBranchExists(base, "BRNCH-99")).to.equal(true);

      vcs.worktreeRemove(base, wt);
      expect(fs.existsSync(wt)).to.equal(false);
      vcs.branchDelete(base, "BRNCH-99");
      expect(vcs.localBranchExists(base, "BRNCH-99")).to.equal(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
