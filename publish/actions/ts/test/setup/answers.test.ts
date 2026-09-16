// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Answer validation (#192) — every rejection is about the VALUE, not the field. */
import { expect } from "chai";
import { nonEmpty, orgSlug, emailShape, isoDate, orgRepoTarget, branchChoice, parseBranchChoice, branchName } from "../../src/setup/answers.js";

describe("gov-work — answer validation (#192)", () => {
  it("accepts a good org slug and says what is wrong with a bad one", () => {
    expect(orgSlug("ACME")).to.equal(null);
    expect(orgSlug("A")).to.contain("1 character");
    expect(orgSlug("TOOLONGSLUG")).to.contain("11 character");
    expect(orgSlug("GENEVA-1"), "names the actual problem").to.contain("other than letters and digits");
    expect(orgSlug(""), "and why it matters").to.contain("~/.gov/<slug>/");
  });

  it("tells a clone URL apart from a name to create — they need different answers", () => {
    expect(orgRepoTarget("acme-corp/acme-governance")).to.equal(null);
    const pasted = orgRepoTarget("git@github.com:acme/acme-gov.git");
    expect(pasted).to.contain("is a clone URL");
    expect(pasted, "and points at the other path").to.contain("choose B");
    expect(orgRepoTarget("acme-governance")).to.contain("<organization>/<name>");
  });

  it("takes 1 or 2 for the default branch, and the branch name itself", () => {
    expect(parseBranchChoice("1")).to.equal("main");
    expect(parseBranchChoice("2")).to.equal("master");
    expect(parseBranchChoice("main"), "typing the answer is not a mistake").to.equal("main");
    expect(parseBranchChoice("trunk")).to.equal(null);
    expect(branchChoice("trunk")).to.contain("1 for main or 2 for master");
  });

  it("refuses branch names git itself would refuse", () => {
    expect(branchName("dev")).to.equal(null);
    expect(branchName("feature/x")).to.equal(null);
    expect(branchName("has space")).to.contain("not a valid git branch name");
    expect(branchName("a..b")).to.contain("not a valid git branch name");
  });

  it("checks an email's shape, and quotes back what was typed", () => {
    expect(emailShape("rk@svayam.ai")).to.equal(null);
    expect(emailShape("rk@svayam")).to.contain("'rk@svayam'");
    expect(emailShape("")).to.contain("cannot be empty");
  });

  it("checks dates are real, not merely date-shaped", () => {
    expect(isoDate("2026-05-15")).to.equal(null);
    expect(isoDate("15-05-2026")).to.contain("YYYY-MM-DD");
    expect(isoDate("2026-13-01")).to.contain("not a real date");
  });

  it("nonEmpty names the thing that was left blank", () => {
    expect(nonEmpty("An organization name")("")).to.equal("An organization name cannot be empty.");
    expect(nonEmpty("An organization name")("Acme")).to.equal(null);
  });
});
