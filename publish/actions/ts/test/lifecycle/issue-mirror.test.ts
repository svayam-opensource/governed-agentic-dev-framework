// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Mirroring an upstream issue into the repo you can write (#194, option E). */
import { expect } from "chai";
import { parseIssueUrl, mirrorTitle, mirrorBody, mirrorPrecheck } from "../../src/lifecycle/issue-mirror.js";

const UP = {
  repo: "genevaers/Workbench",
  number: 278,
  title: "release.md update",
  body: "The release notes are stale.\nSecond line.",
  url: "https://github.com/genevaers/Workbench/issues/278",
  state: "OPEN",
  author: "someone",
};

describe("gov-work — mirroring an upstream issue (#194)", () => {
  it("reads owner/repo#number out of an issue URL", () => {
    expect(parseIssueUrl(UP.url)).to.deep.equal({ repo: "genevaers/Workbench", number: 278 });
    expect(parseIssueUrl("https://github.com/genevaers/Workbench/pull/9"), "a PR is not an issue").to.equal(null);
    expect(parseIssueUrl("not a url")).to.equal(null);
  });

  it("keeps the original identifiable in a board column", () => {
    expect(mirrorTitle(UP)).to.equal("release.md update  (genevaers/Workbench#278)");
  });

  it("attributes before it quotes — nobody should mistake this for their own report", () => {
    const body = mirrorBody(UP);
    expect(body.split("\n")[0]).to.contain("Mirrored from **https://github.com/genevaers/Workbench/issues/278**");
    expect(body).to.contain("reported by @someone");
    expect(body, "and says why a second issue exists at all").to.contain("owned, assigned and closed here");
    expect(body).to.contain("> The release notes are stale.");
    expect(body).to.contain("> Second line.");
  });

  it("quotes a long body only as far as is useful, and says where the rest is", () => {
    const body = mirrorBody({ ...UP, body: "x".repeat(5000) }, { maxQuote: 100 });
    expect(body).to.contain("Quote truncated");
    expect(body).to.contain(UP.url);
    expect(body.length, "not a second full copy of the record").to.be.lessThan(1200);
  });

  it("survives an upstream issue with no description", () => {
    expect(mirrorBody({ ...UP, body: "" })).to.contain("(the upstream issue has no description)");
  });

  it("refuses to mirror an issue that is already yours", () => {
    expect(mirrorPrecheck({ repo: "svm-geneva/Workbench" }, "svm-geneva")).to.contain("already in your organization");
    expect(mirrorPrecheck({ repo: "genevaers/Workbench" }, "svm-geneva")).to.equal(null);
  });
});
