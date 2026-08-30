// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Where the work happens, when that is not where the issue lives (#194).
 *
 * The board linked an upstream issue; seed tried to branch upstream; the adopter
 * had a fork with exactly the branch gov wanted and no way to say so.
 */
import { expect } from "chai";
import { parseRepoOverrides, resolveWorkRepo, appliedOverrides, repoSlugFromUrl } from "../../src/config/repo-overrides.js";

const CFG = `
org_name: "Svayam Geneva"

repo_overrides:
  genevaers/Workbench: svm-geneva/Workbench
  "upstream/other": "svm-geneva/other"      # quoted, with a comment

default_branch: "main"
`;

describe("gov-work — repo_overrides (#194)", () => {
  it("reads the block, and stops at the first dedent", () => {
    const o = parseRepoOverrides(CFG);
    expect(o["genevaers/Workbench"]).to.equal("svm-geneva/Workbench");
    expect(o["upstream/other"]).to.equal("svm-geneva/other");
    expect(Object.keys(o), "default_branch is not an override").to.have.length(2);
  });

  it("is empty for the orgs that do not work from forks — the common case", () => {
    expect(parseRepoOverrides('org_name: "Acme"')).to.deep.equal({});
  });

  it("recognises a repo in any of the URL forms a board can produce", () => {
    for (const u of [
      "https://github.com/genevaers/Workbench",
      "https://github.com/genevaers/Workbench.git",
      "git@github.com:genevaers/Workbench.git",
      "https://github.com/genevaers/Workbench/",
    ]) expect(repoSlugFromUrl(u), u).to.equal("genevaers/Workbench");
  });

  it("redirects a mapped repo and leaves everything else alone", () => {
    const o = parseRepoOverrides(CFG);
    expect(resolveWorkRepo("git@github.com:genevaers/Workbench.git", o)).to.equal("https://github.com/svm-geneva/Workbench");
    expect(resolveWorkRepo("https://github.com/svm-geneva/other-repo", o),
      "no surprises for the unmapped").to.equal("https://github.com/svm-geneva/other-repo");
  });

  it("reports which redirects were used — a decision made on your behalf is said out loud", () => {
    const o = parseRepoOverrides(CFG);
    const used = appliedOverrides(["https://github.com/genevaers/Workbench", "https://github.com/svm-geneva/mine"], o);
    expect(used).to.deep.equal([{ from: "https://github.com/genevaers/Workbench", to: "https://github.com/svm-geneva/Workbench" }]);
  });
});
