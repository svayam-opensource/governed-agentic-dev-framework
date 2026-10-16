// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A machine where git has no identity (a fresh laptop, a container, a CI runner — node-ci run 38754542002) refuses
 * every commit with `fatal: empty ident name … not allowed`. gov's commits (autorun's draft/stale steps, …) say what
 * to set instead of passing that line on.
 */
import { expect } from "chai";
import { createGitVcs, GIT_IDENTITY_HINT, NO_GIT_IDENTITY, type RunGit } from "../../src/lifecycle/vcs.js";

const NO_NAME = [
  "Author identity unknown", "", "*** Please tell me who you are.", "", "Run", "",
  '  git config --global user.email "you@example.com"', '  git config --global user.name "Your Name"', "",
  "to set your account's default identity.", "Omit --global to set the identity only in this repository.", "",
  "fatal: empty ident name (for <runner@fv-az1.internal>) not allowed",
].join("\n");
const NO_EMAIL = "*** Please tell me who you are.\n…\nfatal: unable to auto-detect email address (got 'me@box.(none)')";

const vcsReplying = (status: number, stderr: string) => {
  const calls: string[][] = [];
  const run: RunGit = (args) => { calls.push(args); return { status, stdout: "", stderr }; };
  return { vcs: createGitVcs(run, () => {}), calls };
};

describe("gov-work — a commit on a machine where git has no identity says what to set", () => {
  for (const [why, stderr] of [["no name", NO_NAME], ["no email", NO_EMAIL]] as const) {
    it(`${why}: the error is gov's one line naming user.name and user.email, not git's`, () => {
      const { vcs, calls } = vcsReplying(128, stderr);
      expect(NO_GIT_IDENTITY.test(stderr)).to.equal(true);
      expect(() => vcs.commit("/r", "msg")).to.throw(GIT_IDENTITY_HINT);
      expect(calls).to.deep.equal([["-C", "/r", "commit", "-m", "msg"]]);
      expect(GIT_IDENTITY_HINT).to.include("user.name").and.include("user.email").and.not.include("\n");
    });
  }

  it("any other commit failure (a hook refusing it) keeps git's own words", () => {
    const { vcs } = vcsReplying(1, "refused by GOV-FRM-086");
    expect(() => vcs.commit("/r", "msg")).to.throw(/git commit failed \(exit 1\): refused by GOV-FRM-086/);
  });

  it("a commit that succeeds throws nothing", () => {
    const { vcs } = vcsReplying(0, "");
    expect(() => vcs.commit("/r", "msg")).to.not.throw();
  });
});
