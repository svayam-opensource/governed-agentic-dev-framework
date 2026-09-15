// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Reversing a failed seed (#230). The planner is pure apart from read-only probes, so every verdict
 * is asserted against injected evidence rather than a real repository.
 *
 * The assertions worth reading are the pessimistic ones: an unreadable ref must become consent and
 * never "safe", and a work root with uncommitted changes must be REFUSED rather than offered with a
 * warning — a confirmation is not a substitute for not destroying unpushed work.
 */
import { expect } from "chai";
import { seedPathsFor, type LeftoverArtifact } from "../../src/lifecycle/leftover.js";
import { classify, planCleanup, inReversalOrder, hasRefusals, reverse, planLines, type CleanupEnv, type CleanupConfig } from "../../src/lifecycle/cleanup.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";

const CFG: CleanupConfig = { defaultBranch: "main", remote: "origin", workspaceRepo: "svm-prj-work" };
const PATHS = seedPathsFor({ govHome: "/gov", agentWorkRoot: "/awr", projectId: "PRJ-9-x", branch: "BRNCH-9-x" });

/** A Vcs whose probes answer from a fixture; every write records itself. */
function vcs(over: Partial<Vcs> = {}): { v: Vcs; calls: string[] } {
  const calls: string[] = [];
  const noop = () => {};
  const v = {
    refExists: () => true, isAncestor: () => true, isClean: () => true,
    localBranchExists: () => false, remoteBranchExists: () => false, headSha: () => "h",
    lsRemoteHeads: () => [], lsRemoteRefs: () => [], defaultBranch: () => null, revParse: () => null,
    currentBranch: () => null, remoteBranchesMatching: () => [],
    addPath: (d: string, p: string) => { calls.push(`addPath ${d} ${p}`); },
    commit: (d: string) => { calls.push(`commit ${d}`); },
    push: (d: string, r: string, b: string) => { calls.push(`push ${r} ${b}`); },
    pushDelete: (_d: string, r: string, b: string) => { calls.push(`pushDelete ${r}/${b}`); },
    branchDelete: (_d: string, b: string) => { calls.push(`branchDelete ${b}`); },
    worktreeRemove: (base: string, p: string) => { calls.push(`worktreeRemove ${base} ${p}`); },
    resetHard: noop, resetKeepingFiles: noop, cleanUntracked: noop, worktreeAdd: noop,
    worktreeAddExisting: noop, clone: noop, fetch: noop, setIdentity: noop, checkout: noop,
    checkoutNew: noop, mergeNoEdit: () => "merged" as const, tag: noop,
    ...over,
  } as unknown as Vcs;
  return { v, calls };
}

function env(over: Partial<CleanupEnv> = {}, vo: Partial<Vcs> = {}): { e: CleanupEnv; calls: string[]; removed: string[] } {
  const { v, calls } = vcs(vo);
  const removed: string[] = [];
  return {
    e: { vcs: v, fs: { pathExists: () => true }, readdir: () => [], rm: (t) => { removed.push(t); }, ...over },
    calls, removed,
  };
}

const A = {
  localBranch: { kind: "local-branch", detail: "d", branch: "BRNCH-9-x", repoDir: "/gov" } as LeftoverArtifact,
  remoteBranch: { kind: "remote-branch", detail: "d", branch: "BRNCH-9-x", repoDir: "/gov", remote: "origin" } as LeftoverArtifact,
  workspaceDir: { kind: "workspace-dir", detail: "d", path: "/awr/PRJ-9-x" } as LeftoverArtifact,
  homeStub: { kind: "home-stub", detail: "d", path: "/gov/projects/PRJ-9-x" } as LeftoverArtifact,
};

describe("#230 — reversing a failed seed: what gov will and will not do", () => {
  it("a clean work root is reversible; nothing unpushed is at risk", () => {
    const { e } = env();
    const s = classify(e, CFG, A.workspaceDir, PATHS);
    expect(s.verdict.kind).to.equal("reversible");
  });

  it("a work root with UNCOMMITTED changes is REFUSED, not offered with a warning", () => {
    // The distinction the issue turns on: a confirmation cannot make destroying unpushed edits
    // correct, so gov must not present one. It names the repos so the operator can go and commit.
    const { e } = env(
      { readdir: () => ["svm-prj-work", "app"], fs: { pathExists: () => true } },
      { isClean: (d: string) => !d.endsWith("app") },
    );
    const s = classify(e, CFG, A.workspaceDir, PATHS);
    expect(s.verdict.kind).to.equal("refused");
    expect(s.verdict.why).to.include("app");
    expect(s.verdict.why, "say what to do instead").to.match(/Commit or discard/);
  });

  it("a refused step is never executed, even if a caller asks", () => {
    const { e, calls } = env({ readdir: () => ["app"] }, { isClean: () => false });
    const s = classify(e, CFG, A.workspaceDir, PATHS);
    const r = reverse(e, CFG, s, PATHS);
    expect(r.ok).to.equal(false);
    expect(calls, "nothing was touched").to.deep.equal([]);
  });

  it("a merged branch is reversible; an unmerged one asks first", () => {
    const merged = classify(env({}, { isAncestor: () => true }).e, CFG, A.localBranch, PATHS);
    expect(merged.verdict.kind).to.equal("reversible");
    const unmerged = classify(env({}, { isAncestor: () => false }).e, CFG, A.localBranch, PATHS);
    expect(unmerged.verdict.kind).to.equal("needs-consent");
  });

  it("an UNREADABLE ref is treated as 'might carry work', never as safe", () => {
    // The conservative direction matters more than the happy path: a false "contained" deletes work.
    const { e } = env({}, { refExists: () => false, isAncestor: () => true });
    for (const a of [A.localBranch, A.remoteBranch]) {
      const s = classify(e, CFG, a, PATHS);
      expect(s.verdict.kind, a.kind).to.equal("needs-consent");
      expect(s.verdict.why).to.include("could not read the refs");
    }
  });

  it("an unmerged REMOTE branch warns that it may be the only copy — a local one does not", () => {
    const { e } = env({}, { isAncestor: () => false });
    const remote = classify(e, CFG, A.remoteBranch, PATHS);
    const local = classify(e, CFG, A.localBranch, PATHS);
    if (remote.verdict.kind !== "needs-consent" || local.verdict.kind !== "needs-consent") throw new Error("both should ask");
    expect(remote.verdict.atStake).to.match(/ONLY copy/);
    expect(local.verdict.atStake, "a local branch is in the reflog, so the warning differs").to.match(/reflog/);
  });

  it("the home stub always asks, because the commit lands on a shared branch", () => {
    const s = classify(env().e, CFG, A.homeStub, PATHS);
    expect(s.verdict.kind).to.equal("needs-consent");
    expect(s.verdict.why).to.include("main");
    if (s.verdict.kind === "needs-consent") expect(s.verdict.atStake, "be clear nothing of THEIRS is lost").to.match(/nothing of yours/);
  });

  it("reversal order is not detection order — the worktree goes before its branch", () => {
    // git refuses to delete a branch checked out in a worktree, so this ordering is load-bearing
    // rather than cosmetic.
    const detected = [A.localBranch, A.remoteBranch, A.workspaceDir, A.homeStub];
    expect(inReversalOrder(detected).map((a) => a.kind)).to.deep.equal(["workspace-dir", "local-branch", "remote-branch", "home-stub"]);
  });

  it("each artifact is judged on ITS OWN evidence — a dirty work root does not save a merged branch", () => {
    // The all-or-nothing failure the issue calls out, in reverse: one refusal must not silently
    // downgrade the others, and must not authorise them either.
    const { e } = env({ readdir: () => ["app"] }, { isClean: () => false, isAncestor: () => true });
    const plan = planCleanup(e, CFG, [A.workspaceDir, A.localBranch, A.homeStub], PATHS);
    expect(plan.map((s) => s.verdict.kind)).to.deep.equal(["refused", "reversible", "needs-consent"]);
    expect(hasRefusals(plan)).to.equal(true);
  });

  it("reversing the home stub removes, commits and pushes the SAME branch seed pushed", () => {
    const { e, calls, removed } = env();
    const s = classify(e, CFG, A.homeStub, PATHS);
    expect(reverse(e, CFG, s, PATHS).ok).to.equal(true);
    expect(removed).to.deep.equal(["/gov/projects/PRJ-9-x"]);
    expect(calls).to.deep.equal(["addPath /gov projects/PRJ-9-x", "commit /gov", "push origin main"]);
  });

  it("reversing a work root detaches worktrees through git before removing it", () => {
    // An rm -rf of a worktree leaves the parent repo registering a worktree that is not there, and
    // the next seed then fails about a worktree the cleanup invented.
    const { e, calls } = env({ readdir: () => ["svm-prj-work"] });
    const s = classify(e, CFG, A.workspaceDir, PATHS);
    expect(reverse(e, CFG, s, PATHS).ok).to.equal(true);
    expect(calls[0], "the governance worktree is detached from govHome, its parent").to.equal("worktreeRemove /gov /awr/PRJ-9-x/svm-prj-work");
    expect(calls).to.include("worktreeRemove /gov /awr/PRJ-9-x");
  });

  it("branch reversals use the recorded data rather than recomputing it", () => {
    const { e, calls } = env({}, { isAncestor: () => true });
    expect(reverse(e, CFG, classify(e, CFG, A.localBranch, PATHS), PATHS).ok).to.equal(true);
    expect(reverse(e, CFG, classify(e, CFG, A.remoteBranch, PATHS), PATHS).ok).to.equal(true);
    expect(calls).to.deep.equal(["branchDelete BRNCH-9-x", "pushDelete origin/BRNCH-9-x"]);
  });

  it("a failing git command is reported, not thrown", () => {
    const { e } = env({}, { isAncestor: () => true, branchDelete: () => { throw new Error("branch is checked out"); } });
    const r = reverse(e, CFG, classify(e, CFG, A.localBranch, PATHS), PATHS);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.why).to.include("checked out");
  });

  it("the plan reads as a plan — every line says what and why, and refusals are called out", () => {
    const { e } = env({ readdir: () => ["app"] }, { isClean: () => false, isAncestor: () => false });
    const text = planLines(planCleanup(e, CFG, [A.workspaceDir, A.remoteBranch], PATHS)).join("\n");
    expect(text).to.include("[REFUSE]");
    expect(text).to.include("[ask   ]");
    expect(text).to.include("at stake:");
    expect(text).to.match(/gov will not offer to destroy it/);
  });

  it("nothing detected → nothing claimed", () => {
    expect(planCleanup(env().e, CFG, [], PATHS)).to.deep.equal([]);
    expect(planLines([])).to.deep.equal(["Nothing to reverse."]);
  });
});
