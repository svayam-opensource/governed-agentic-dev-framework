// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// svm-prj-work#393 — STARTING A PROJECT NEVER PUSHES THE DEFAULT BRANCH.
//
// The report: starting a project failed on push. The push was the seed's own — it committed
// `projects/<id>/.gitkeep` in the governance repo and pushed it to `main`, which a protected default branch
// (`governance_posture: hard`) rejects whoever makes it. 653146f removed that write. This test holds the line
// over the WHOLE call log rather than one call site: `recordingVcs` records every mutating Vcs call, so a push,
// commit or remote delete added anywhere in seed later is seen here without anyone remembering to look.
//
// Asserted for a clean start, for a start whose project branch is already there, for a start that fails and
// rolls back, and with a default branch that is not called `main` — the rule is about the org's DEFAULT
// branches (governance and code), not about a branch name.
import { expect } from "chai";
import { seed, type SeedConfig } from "../../src/lifecycle/seed.js";
import {
  SEED_CONFIG, SEED_INPUT, PROJECT_BRANCH, GOV_WORKTREE, seedBoard, seedAnchor, recordingVcs, recordingFs, type SeedVcsOptions,
} from "../helpers/seed-world.js";

const WRITES_A_REMOTE = /^(push|pushDelete) /;

function start(opts: SeedVcsOptions = {}, config: SeedConfig = SEED_CONFIG) {
  const { vcs, log } = recordingVcs(opts);
  const { fs } = recordingFs(new Set(["/gov/org-config.yaml", "/gov/.git"]));
  const r = seed({ board: seedBoard(), vcs, fs, anchor: seedAnchor(), cloneRepo: () => {} }, config, SEED_INPUT);
  return { r, log };
}

/** The line holds iff no remote write names a default branch, every remote write is the project branch, and
 *  nothing is committed or pushed from the resolved workspace itself (whose checkout IS the default branch). */
function expectNoDefaultBranchWrite(log: readonly string[], config: SeedConfig = SEED_CONFIG): void {
  const remoteWrites = log.filter((l) => WRITES_A_REMOTE.test(l));
  for (const def of [config.defaultBranch, config.defaultCodeBranch]) {
    const hit = remoteWrites.filter((l) => l.split(" ").includes(def));
    expect(hit, `no push or remote delete of the default branch '${def}'`).to.deep.equal([]);
  }
  const branches = remoteWrites.map((l) => l.split(" ")[3]);
  expect(branches.every((b) => b === PROJECT_BRANCH), `only the project branch is ever pushed: ${remoteWrites.join(" | ")}`).to.equal(true);
  const fromWorkspace = log.filter((l) => /^(push|pushDelete|commit|addPath) \/gov( |$)/.test(l));
  expect(fromWorkspace, "nothing is committed or pushed from the workspace's default-branch checkout").to.deep.equal([]);
}

describe("seed — starting a project never pushes the default branch (svm-prj-work#393)", () => {
  it("a clean start pushes the project branch, and only the project branch", () => {
    const { r, log } = start();
    expect(r.ok, JSON.stringify(r)).to.equal(true);
    // Not vacuous: the start DID push — the project branch, from the project's own governance worktree.
    expect(log.filter((l) => WRITES_A_REMOTE.test(l)).length, "the start pushed something").to.be.greaterThan(0);
    expect(log.some((l) => l.startsWith(`push ${GOV_WORKTREE} origin ${PROJECT_BRANCH}`)), log.join("\n")).to.equal(true);
    expectNoDefaultBranchWrite(log);
  });

  it("a start whose project branch already sits at the base tip reuses it — still no default-branch write", () => {
    const { r, log } = start({ remoteRefs: [{ name: "dev", sha: "base-sha" }, { name: PROJECT_BRANCH, sha: "base-sha" }] });
    expect(r.ok, JSON.stringify(r)).to.equal(true);
    expectNoDefaultBranchWrite(log);
  });

  it("a start that fails at the push rolls back by deleting the PROJECT branch — never a default branch", () => {
    const { r, log } = start({ throwPushFor: [GOV_WORKTREE] });
    expect(r.ok).to.equal(false);
    expectNoDefaultBranchWrite(log);
  });

  it("the rule follows the org's configured default branch, not the name `main`", () => {
    const config: SeedConfig = { ...SEED_CONFIG, defaultBranch: "trunk" };
    const { r, log } = start({}, config);
    expect(r.ok, JSON.stringify(r)).to.equal(true);
    expectNoDefaultBranchWrite(log, config);
  });
});
