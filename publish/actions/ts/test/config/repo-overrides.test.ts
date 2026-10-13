// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Where the work happens, when that is not where the issue lives (#194).
 *
 * The board linked an upstream issue; seed tried to branch upstream; the adopter
 * had a fork with exactly the branch gov wanted and no way to say so.
 */
import { expect } from "chai";
import { parseRepoOverrides, resolveWorkRepo, appliedOverrides, repoSlugFromUrl, withRepoOverrides } from "../../src/config/repo-overrides.js";

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

  it("no path resolves a fork without a mapping — declared, never inferred", () => {
    const urls = [
      "https://github.com/genevaers/Workbench",
      "git@github.com:genevaers/Workbench.git",
      "https://github.com/svm-geneva/Workbench",
    ];
    // No mapping at all: every URL is the work repo, unchanged, and nothing is reported as redirected.
    for (const u of urls) expect(resolveWorkRepo(u, {}), u).to.equal(u);
    expect(appliedOverrides(urls, {})).to.deep.equal([]);
    // A mapping applies to its exact slug only — a near name or another owner's same-named repo is not a match.
    const o = parseRepoOverrides(CFG);
    for (const u of ["https://github.com/genevaers/Workbench-extra", "https://github.com/someone/Workbench"]) {
      expect(resolveWorkRepo(u, o), u).to.equal(u);
    }
  });

  it("reports which redirects were used — a decision made on your behalf is said out loud", () => {
    const o = parseRepoOverrides(CFG);
    const used = appliedOverrides(["https://github.com/genevaers/Workbench", "https://github.com/svm-geneva/mine"], o);
    expect(used).to.deep.equal([{ from: "https://github.com/genevaers/Workbench", to: "https://github.com/svm-geneva/Workbench" }]);
  });
});

describe("gov-work — recording a fork mapping (#194)", () => {
  it("creates the block, with the reason, when there is none", () => {
    const out = withRepoOverrides('org_name: "Svayam Geneva"\n', [{ from: "genevaers/Workbench", to: "svm-geneva/Workbench" }]);
    expect(out).to.be.a("string");
    expect(out!).to.contain("repo_overrides:");
    expect(out!).to.contain("  genevaers/Workbench: svm-geneva/Workbench");
    // Whoever reads this file later did not run the command that wrote it.
    expect(out!, "and says why the block exists").to.contain("not where the issue lives");
    expect(parseRepoOverrides(out!)["genevaers/Workbench"]).to.equal("svm-geneva/Workbench");
  });

  it("adds to an existing block rather than starting a second one", () => {
    const start = 'repo_overrides:\n  a/one: mine/one\n\ndefault_branch: "main"\n';
    const out = withRepoOverrides(start, [{ from: "b/two", to: "mine/two" }])!;
    expect(out.match(/repo_overrides:/g), "one block").to.have.length(1);
    const parsed = parseRepoOverrides(out);
    expect(parsed).to.deep.equal({ "a/one": "mine/one", "b/two": "mine/two" });
    expect(out, "untouched keys stay where they were").to.contain('default_branch: "main"');
  });

  it("returns null when the mapping is already recorded — nothing to write twice", () => {
    const start = "repo_overrides:\n  a/one: mine/one\n";
    expect(withRepoOverrides(start, [{ from: "a/one", to: "mine/one" }])).to.equal(null);
  });

  it("rewrites a mapping that points somewhere else", () => {
    const start = "repo_overrides:\n  a/one: mine/old\n";
    const out = withRepoOverrides(start, [{ from: "a/one", to: "mine/new" }]);
    expect(out).to.be.a("string");
  });
});
