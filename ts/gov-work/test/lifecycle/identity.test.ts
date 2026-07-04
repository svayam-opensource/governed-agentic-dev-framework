// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import {
  parseBoardUrl,
  slugify,
  projectId,
  deriveBranch,
  branchForId,
  taskBranch,
  deriveProjectIdentity,
} from "../../src/lifecycle/identity.js";

describe("prj-work Phase 2 — project identity (SDD Part B, seed)", () => {
  describe("parseBoardUrl", () => {
    it("parses an org board URL", () => {
      expect(parseBoardUrl("https://github.com/orgs/Svayamtech/projects/43")).to.deep.equal({
        owner: "Svayamtech",
        ownerField: "organization",
        number: 43,
      });
    });
    it("parses a user board URL", () => {
      expect(parseBoardUrl("https://github.com/users/someone/projects/5")).to.deep.equal({
        owner: "someone",
        ownerField: "user",
        number: 5,
      });
    });
    it("returns null when there's no project number or no owner", () => {
      expect(parseBoardUrl("https://github.com/orgs/Svayamtech")).to.equal(null);
      expect(parseBoardUrl("https://github.com/projects/9")).to.equal(null);
    });
  });

  describe("slugify (byte-for-byte lib.sh)", () => {
    it("lowercases, replaces non-alnum, collapses and trims dashes", () => {
      expect(slugify("@Governance Common Project")).to.equal("governance-common-project");
      expect(slugify("  Hello,  World!! ")).to.equal("hello-world");
      expect(slugify("AI Course — Launch")).to.equal("ai-course-launch");
    });
    it("returns empty for a title with no ASCII alphanumerics", () => {
      expect(slugify("——")).to.equal("");
      expect(slugify("…")).to.equal("");
    });
  });

  describe("branch derivation", () => {
    it("derives BRNCH-<rest> from PRJ-<rest>", () => {
      expect(deriveBranch("PRJ-43-governance-common-project")).to.equal(
        "BRNCH-43-governance-common-project",
      );
    });
    it("lowercases a legacy (non-PRJ) id", () => {
      expect(deriveBranch("ACME-001-Foo")).to.equal("acme-001-foo");
    });
    it("honors a frozen legacy branch override before deriving", () => {
      const legacy = { "PRJ-014-knowledge-app-backlog": "PRJ-24-knowledge-app-backlog" };
      expect(branchForId("PRJ-014-knowledge-app-backlog", legacy)).to.equal(
        "PRJ-24-knowledge-app-backlog",
      );
      expect(branchForId("PRJ-43-x", legacy)).to.equal("BRNCH-43-x"); // no override → derive
    });
    it("builds a task sub-branch", () => {
      expect(taskBranch("BRNCH-43-governance-common-project", 91)).to.equal(
        "BRNCH-43-governance-common-project.ISSUE-91",
      );
    });
  });

  describe("deriveProjectIdentity", () => {
    it("derives the real PRJ-43 identity from its board URL + title", () => {
      // Cross-checks the live project.yaml: id + branch + board 43.
      expect(
        deriveProjectIdentity({
          url: "https://github.com/orgs/Svayamtech/projects/43",
          title: "@Governance Common Project",
        }),
      ).to.deep.equal({
        ok: true,
        board: { owner: "Svayamtech", ownerField: "organization", number: 43 },
        projectId: "PRJ-43-governance-common-project",
        branch: "BRNCH-43-governance-common-project",
        slug: "governance-common-project",
      });
    });
    it("rejects an unparseable board URL", () => {
      const r = deriveProjectIdentity({ url: "not-a-url", title: "Whatever" });
      expect(r).to.deep.equal({ ok: false, reason: "bad-url", url: "not-a-url" });
    });
    it("rejects a title that slugifies to empty", () => {
      const r = deriveProjectIdentity({
        url: "https://github.com/orgs/O/projects/1",
        title: "———",
      });
      expect(r).to.include({ ok: false, reason: "empty-slug" });
    });
  });

  it("projectId composes PRJ-<n>-<slug>", () => {
    expect(projectId(7, "sanskriti")).to.equal("PRJ-7-sanskriti");
  });
});
