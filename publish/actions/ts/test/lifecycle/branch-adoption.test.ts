// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Recovering from our own failed run (#180).
 *
 * The scenario, verbatim: `seed` failed in Phase C, the branch it had already
 * pushed survived, and every retry died on it — "Branch 'BRNCH-1-workbench-demo'
 * already exists … investigate." The adopter was stuck behind the tool's leftovers
 * and told to investigate them.
 */
import { expect } from "chai";
import { classifyProjectBranch, preconditionFailures, adoptions } from "../../src/lifecycle/branch-adoption.js";

const URL = "https://github.com/genevaers/Workbench";
const BASE = { name: "dev", sha: "aaa111" };

describe("gov-work — is this branch our leftover, or someone's work? (#180)", () => {
  it("no branch → create it, as normal", () => {
    expect(classifyProjectBranch([BASE], "dev", "BRNCH-1-workbench-demo", URL)).to.deep.equal({ kind: "create" });
  });

  it("a branch sitting exactly on the base tip could only be our failed run → adopt", () => {
    // seed creates the branch from the base and pushes it before committing anything
    // to it, so identical shas is the signature of a run that died after that push.
    const refs = [BASE, { name: "BRNCH-1-workbench-demo", sha: "aaa111" }];
    expect(classifyProjectBranch(refs, "dev", "BRNCH-1-workbench-demo", URL)).to.deep.equal({ kind: "adopt", sha: "aaa111" });
  });

  it("a branch with commits of its own is somebody's work → refuse, and say why", () => {
    const refs = [BASE, { name: "BRNCH-1-workbench-demo", sha: "bbb222" }];
    const v = classifyProjectBranch(refs, "dev", "BRNCH-1-workbench-demo", URL);
    expect(v.kind).to.equal("refuse");
    expect((v as { detail: string }).detail).to.contain("has commits of its own");
    expect((v as { detail: string }).detail, "never guess between the two").to.contain("will not reuse it");
  });

  it("a missing base branch says what IS there", () => {
    const v = classifyProjectBranch([{ name: "main", sha: "ccc" }], "dev", "BRNCH-1-x", URL);
    expect(v.kind).to.equal("no-base");
    expect((v as { detail: string }).detail).to.contain("Available: main");
  });

  it("reports every unready repo at once, not one per attempt", () => {
    const checks = [
      { url: "r1", verdict: classifyProjectBranch([BASE, { name: "B", sha: "x" }], "dev", "B", "r1") },
      { url: "r2", verdict: classifyProjectBranch([{ name: "main", sha: "y" }], "dev", "B", "r2") },
      { url: "r3", verdict: classifyProjectBranch([BASE], "dev", "B", "r3") },
    ];
    // Failing on the first means fixing it, re-running, and meeting the second.
    expect(preconditionFailures(checks)).to.have.length(2);
    expect(adoptions(checks)).to.have.length(0);
  });

  it("names the repos whose branch is being reused — it is a decision made for you", () => {
    const checks = [
      { url: URL, verdict: classifyProjectBranch([BASE, { name: "B", sha: "aaa111" }], "dev", "B", URL) },
    ];
    expect(adoptions(checks)).to.deep.equal([URL]);
    expect(preconditionFailures(checks)).to.have.length(0);
  });
});
