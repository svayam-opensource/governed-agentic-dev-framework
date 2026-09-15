// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHERE A PROJECT BRANCH MUST LAND (#140) — the chain `close` merges into before it may archive.
 *
 * An ordinary project is cut from `dev` and lands in `dev`. A hotfix is cut from a higher env branch and has
 * two obligations: reach the branch it was cut from (or production is never fixed), and reach every branch
 * below it (or the next ordinary release silently reverts the fix and nothing notices).
 */
import { expect } from "chai";
import { envLadder, mergeChain, baseBranchFor } from "../../src/lifecycle/merge-chain.js";
import { anchorIssueBody, baseBranchFromAnchorBody } from "../../src/lifecycle/anchor.js";
import { repoSlugFromUrl } from "../../src/lifecycle/repo.js";

const CFG = { defaultBranch: "main", defaultCodeBranch: "dev" };

describe("close — the env ladder", () => {
  it("two rungs when nothing else is declared — every adopter's starting point", () => {
    expect(envLadder(CFG)).to.deep.equal(["main", "dev"]);
  });

  it("declared middle rungs sit between, highest first", () => {
    expect(envLadder(CFG, ["uat"])).to.deep.equal(["main", "uat", "dev"]);
    expect(envLadder(CFG, ["uat", "sit"])).to.deep.equal(["main", "uat", "sit", "dev"]);
  });

  it("a repo whose default IS its code branch has ONE rung, not a duplicate", () => {
    // Otherwise close would merge dev→dev and push twice, and the second push would look like a second leg.
    expect(envLadder({ defaultBranch: "main", defaultCodeBranch: "main" })).to.deep.equal(["main"]);
  });

  it("a middle rung that repeats an end is dropped, not duplicated", () => {
    expect(envLadder(CFG, ["dev", "uat"])).to.deep.equal(["main", "uat", "dev"]);
  });
});

describe("close — the merge chain", () => {
  const LADDER = envLadder(CFG, ["uat"]);   // main · uat · dev

  it("an ORDINARY project lands in dev only — identical to the behaviour before #140", () => {
    expect(mergeChain("dev", LADDER)).to.deep.equal(["dev"]);
  });

  it("a hotfix cut from uat lands in uat, THEN dev", () => {
    expect(mergeChain("uat", LADDER)).to.deep.equal(["uat", "dev"]);
  });

  it("a hotfix cut from the release branch lands in main, then uat, then dev", () => {
    expect(mergeChain("main", LADDER)).to.deep.equal(["main", "uat", "dev"]);
  });

  it("SHIP FIRST, THEN PROTECT — the base is always first, dev always last", () => {
    // The order is the whole point: a conflict on a lower leg leaves the fix already delivered and the
    // branch alive to resolve the rest. Reversed, production waits on a merge nobody is asking for.
    for (const base of ["main", "uat", "dev"]) {
      const chain = mergeChain(base, LADDER);
      expect(chain[0], `${base} ships first`).to.equal(base);
      expect(chain[chain.length - 1], `${base} protects dev last`).to.equal("dev");
    }
  });

  it("a base that is not on the ladder lands back where it came from — no guessing", () => {
    expect(mergeChain("release/2.x", LADDER)).to.deep.equal(["release/2.x"]);
  });
});

describe("close — reading the project's base", () => {
  it("nothing recorded → the fallback, and it SAYS it assumed", () => {
    expect(baseBranchFor(null, "dev")).to.deep.equal({ base: "dev", assumed: true });
    expect(baseBranchFor(undefined, "dev")).to.deep.equal({ base: "dev", assumed: true });
  });

  it("a recorded base is used, and is not reported as an assumption", () => {
    expect(baseBranchFor("uat", "dev")).to.deep.equal({ base: "uat", assumed: false });
  });

  it("the fallback is DISTINGUISHABLE from a recorded value that happens to match it", () => {
    // The whole defect this replaces: project.yaml was never written, so the fallback was taken
    // every time and looked exactly like a decision. A recorded "dev" and an assumed "dev" must
    // not be the same value.
    expect(baseBranchFor("dev", "dev").assumed, "recorded").to.equal(false);
    expect(baseBranchFor(null, "dev").assumed, "assumed").to.equal(true);
  });

  it("whitespace is not a recorded base", () => {
    expect(baseBranchFor("   ", "dev")).to.deep.equal({ base: "dev", assumed: true });
  });

  it("round-trips through the anchor body, which is where it is actually stored", () => {
    for (const b of ["dev", "uat", "release/2026.09"]) {
      const body = anchorIssueBody(42, "Invoice API", b);
      expect(baseBranchFromAnchorBody(body), b).to.equal(b);
      expect(body, "the board number stays parseable — find/findAll depend on it").to.include("Project #42");
    }
  });

  it("an anchor seeded BEFORE the base was recorded reads as nothing, not as a wrong branch", () => {
    // Every project that exists today has a body with no base line. It must fall back loudly
    // rather than parse something adjacent out of the prose.
    const legacy = anchorIssueBody(7, "Old project");
    expect(baseBranchFromAnchorBody(legacy)).to.equal(null);
    expect(baseBranchFor(baseBranchFromAnchorBody(legacy), "dev")).to.deep.equal({ base: "dev", assumed: true });
  });

  it("the recorded base drives the chain a hotfix needs", () => {
    // The case merge-chain exists for, end to end: cut from uat, must ship to uat AND protect dev.
    const ladder = envLadder({ defaultBranch: "main", defaultCodeBranch: "dev" }, ["uat"]);
    const recorded = baseBranchFromAnchorBody(anchorIssueBody(9, "Hotfix", "uat"));
    expect(mergeChain(baseBranchFor(recorded, "dev").base, ladder)).to.deep.equal(["uat", "dev"]);
    // and with nothing recorded it would have been dev alone — the leg that was being dropped.
    expect(mergeChain(baseBranchFor(null, "dev").base, ladder)).to.deep.equal(["dev"]);
  });
});

describe("close — addressing a code repo on GitHub", () => {
  it("a PR needs owner/name, which the clone DIRECTORY does not carry", () => {
    expect(repoSlugFromUrl("https://github.com/Svayamtech/911-SVM-LIB-SVC")).to.equal("Svayamtech/911-SVM-LIB-SVC");
    expect(repoSlugFromUrl("git@github.com:Svayamtech/911-SVM-LIB-SVC.git")).to.equal("Svayamtech/911-SVM-LIB-SVC");
    expect(repoSlugFromUrl("https://github.com/O/name/")).to.equal("O/name");
  });

  it("undefined for anything that is not an owner/name GitHub repo — the caller reports it", () => {
    // Guessing an owner would open a PR against someone else's repository.
    for (const bad of ["library/mariadb", "https://gitlab.com/o/n", "", "not-a-url"]) {
      expect(repoSlugFromUrl(bad), bad).to.equal(undefined);
    }
  });
});
