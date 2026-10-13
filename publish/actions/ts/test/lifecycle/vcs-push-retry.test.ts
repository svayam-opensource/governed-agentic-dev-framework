// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A push GitHub refused for its own reasons is tried again; one refused for ours is not (svayam-e2e run 38482423935:
 * the joiner's `gov task` died on `remote: fatal error in commit_refs`, a server error the same push does not hit
 * seconds later).
 */
import { expect } from "chai";
import { createGitVcs, type RunGit } from "../../src/lifecycle/vcs.js";

const COMMIT_REFS = "remote: fatal error in commit_refs\nTo https://github.com/o/r\n ! [remote rejected] B.ISSUE-2 -> B.ISSUE-2 (failure)\nerror: failed to push some refs";
const NON_FF = "To https://github.com/o/r\n ! [rejected] main -> main (non-fast-forward)\nerror: failed to push some refs";

function world(replies: { status: number; stderr?: string }[]) {
  const calls: string[][] = [];
  const naps: number[] = [];
  const run: RunGit = (args) => { calls.push(args); const r = replies.shift() ?? { status: 0 }; return { status: r.status, stdout: "", stderr: r.stderr ?? "" }; };
  return { vcs: createGitVcs(run, (ms) => naps.push(ms)), calls, naps };
}

describe("gov-work — git push retries GitHub's own failures, never ours", () => {
  it("a transient server failure, then success: pushed, after one wait", () => {
    const { vcs, calls, naps } = world([{ status: 1, stderr: COMMIT_REFS }, { status: 0 }]);
    vcs.push("/r", "origin", "B.ISSUE-2", { setUpstream: true });
    expect(calls).to.have.length(2);
    expect(calls[0]).to.deep.equal(["-C", "/r", "push", "-u", "origin", "B.ISSUE-2"]);
    expect(naps).to.deep.equal([2000]);
  });

  it("three transient failures: it stops and reports git's own words", () => {
    const { vcs, calls } = world([{ status: 1, stderr: COMMIT_REFS }, { status: 1, stderr: COMMIT_REFS }, { status: 1, stderr: COMMIT_REFS }]);
    expect(() => vcs.push("/r", "origin", "b")).to.throw(/fatal error in commit_refs/);
    expect(calls).to.have.length(3);
  });

  it("a rejection that is ours (non-fast-forward) fails at once — no retry", () => {
    const { vcs, calls, naps } = world([{ status: 1, stderr: NON_FF }]);
    expect(() => vcs.push("/r", "origin", "main")).to.throw(/non-fast-forward/);
    expect(calls).to.have.length(1);
    expect(naps).to.deep.equal([]);
  });
});
