// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// #191 — A FAILED SEED LEAVES WORKSPACE RESOLUTION EXACTLY AS IT WAS.
//
// The walk that found it: `gov` resolved the workspace; Work ▸ seed failed at Phase C with
// "Branch 'BRNCH-1-…' already exists in <code repo>"; the next `gov` said "no gov workspace resolved" while
// the registry still listed the org. The rollback had run `reset --hard` + `clean` inside the RESOLVED
// workspace, where an uncommitted `org-config.yaml` — the one file that makes a directory a workspace — sat.
//
// The acceptance is a regression test that seeds into a repo whose branch EXISTS and finds the workspace still
// resolving afterwards. A branch can exist three ways, and each gets a case: carrying someone's work (refused
// before the first write), left at the base tip by an earlier attempt (reused, and here the run then fails
// later), and appearing between the preflight and Phase C (the original report's exact failure point).
// "Still resolves" is asserted as what resolution needs: `<govHome>/org-config.yaml` is present, nothing
// removed it, and no undo ran a destructive git command inside `<govHome>`.
import { expect } from "chai";
import { seed } from "../../src/lifecycle/seed.js";
import {
  SEED_CONFIG, SEED_INPUT, PROJECT_BRANCH, GOV_WORKTREE, seedBoard, seedAnchor, recordingVcs, recordingFs, type SeedVcsOptions,
} from "../helpers/seed-world.js";

const ORG_CONFIG = "/gov/org-config.yaml";

function seedWith(opts: SeedVcsOptions) {
  const { vcs, log } = recordingVcs(opts);
  const { fs, removed, existing } = recordingFs(new Set([ORG_CONFIG, "/gov/.git"]));
  const r = seed({ board: seedBoard(), vcs, fs, anchor: seedAnchor(), cloneRepo: () => {} }, SEED_CONFIG, SEED_INPUT);
  return { r, log, removed, existing };
}

/** The workspace resolves iff its org-config.yaml is still there and nothing destructive ran inside it. */
function expectWorkspaceStillResolves(w: ReturnType<typeof seedWith>): void {
  expect(w.existing.has(ORG_CONFIG), "org-config.yaml is still there — the workspace still resolves").to.equal(true);
  expect(w.removed.filter((p) => p === "/gov" || p === ORG_CONFIG), "nothing removed the workspace or its config").to.deep.equal([]);
  const destructive = w.log.filter((l) => /^(resetHard|resetKeepingFiles|cleanUntracked|checkout|checkoutNew) \/gov( |$)/.test(l));
  expect(destructive, "no reset, clean or checkout inside the resolved workspace").to.deep.equal([]);
  expect(w.log.filter((l) => /^(commit|push) \/gov( |$)/.test(l)), "and nothing committed or pushed from it").to.deep.equal([]);
}

describe("seed — a failed seed keeps the workspace resolvable (#191)", () => {
  it("the project branch exists in the code repo WITH someone's work: refused before the first write, workspace untouched", () => {
    const w = seedWith({ remoteRefs: [{ name: "dev", sha: "base-sha" }, { name: PROJECT_BRANCH, sha: "someone-elses-work" }] });
    expect(w.r.ok).to.equal(false);
    if (w.r.ok) return;
    expect(w.r.reason).to.equal("preflight-failed");
    expect(w.log, "nothing was done at all").to.deep.equal([]);
    expectWorkspaceStillResolves(w);
  });

  it("the branch exists at the base tip (an earlier attempt's), is reused, and a LATER failure rolls back without touching the workspace", () => {
    const w = seedWith({
      remoteRefs: [{ name: "dev", sha: "base-sha" }, { name: PROJECT_BRANCH, sha: "base-sha" }],
      throwPushFor: [GOV_WORKTREE],
    });
    expect(w.r.ok).to.equal(false);
    if (w.r.ok) return;
    expect(w.r.reason).to.equal("seed-failed");
    expect(w.log, "the undo removed the project's own worktree").to.include(`worktreeRemove /gov ${GOV_WORKTREE}`);
    expectWorkspaceStillResolves(w);
  });

  it("the branch appears between the preflight and Phase C — the original report's failure point — and the workspace still resolves", () => {
    const w = seedWith({
      failWhen: (line) => (/^worktree(Add|AddExisting) \/awr\/\.bases\/app /.test(line)
        ? `fatal: a branch named '${PROJECT_BRANCH}' already exists`
        : null),
    });
    expect(w.r.ok).to.equal(false);
    if (w.r.ok) return;
    expect(w.r.reason).to.equal("seed-failed");
    expect(w.r.message).to.contain("already exists");
    expectWorkspaceStillResolves(w);
  });

  it("a local branch left by a failed run is reported as leftover state — nothing is mutated, the workspace resolves", () => {
    const w = seedWith({ leftoverLocalBranch: true });
    expect(w.r.ok).to.equal(false);
    if (w.r.ok) return;
    expect(w.r.reason).to.equal("leftover-state");
    expect(w.log, "detection only").to.deep.equal([]);
    expectWorkspaceStillResolves(w);
  });
});
