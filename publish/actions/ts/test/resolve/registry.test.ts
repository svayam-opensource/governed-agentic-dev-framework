// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import {
  parseGovWorkspaces,
  formatGovWorkspaces,
  upsertHome,
  homeForOrg,
} from "../../src/resolve/registry.js";

describe("prj-work Phase 1 — registry model (SDD-041/042)", () => {
  it("parses <org>\\t<home> lines, ignoring blanks and comments", () => {
    const text = [
      "# my gov homes",
      "Svayamtech\t/Users/rk/.svm/gov_repo",
      "",
      "AcmeOrg\t/home/rk/acme/gov",
    ].join("\n");
    expect(parseGovWorkspaces(text)).to.deep.equal([
      { org: "Svayamtech", home: "/Users/rk/.svm/gov_repo" },
      { org: "AcmeOrg", home: "/home/rk/acme/gov" },
    ]);
  });

  it("tolerates CRLF and last-write-wins on duplicate org", () => {
    const text = "Org\t/old\r\nOrg\t/new\r\n";
    expect(parseGovWorkspaces(text)).to.deep.equal([{ org: "Org", home: "/new" }]);
  });

  it("skips malformed (tab-less) lines rather than crashing", () => {
    expect(parseGovWorkspaces("no-tab-here\nOrg\t/h")).to.deep.equal([
      { org: "Org", home: "/h" },
    ]);
  });

  it("preserves a home path containing spaces (splits on first tab only)", () => {
    expect(parseGovWorkspaces("Org\t/path with spaces/gov")).to.deep.equal([
      { org: "Org", home: "/path with spaces/gov" },
    ]);
  });

  it("round-trips through format → parse", () => {
    const homes = [
      { org: "A", home: "/a" },
      { org: "B", home: "/b" },
    ];
    expect(parseGovWorkspaces(formatGovWorkspaces(homes))).to.deep.equal(homes);
  });

  it("formats empty homes to empty string (no stray newline)", () => {
    expect(formatGovWorkspaces([])).to.equal("");
  });

  it("upsertHome appends a new org and replaces an existing one (pure)", () => {
    const base = [{ org: "A", home: "/a" }];
    expect(upsertHome(base, "B", "/b")).to.deep.equal([
      { org: "A", home: "/a" },
      { org: "B", home: "/b" },
    ]);
    expect(upsertHome(base, "A", "/moved")).to.deep.equal([{ org: "A", home: "/moved" }]);
    expect(base).to.deep.equal([{ org: "A", home: "/a" }]); // input untouched
  });

  it("homeForOrg looks up a home or returns null", () => {
    const homes = [{ org: "A", home: "/a" }];
    expect(homeForOrg(homes, "A")).to.equal("/a");
    expect(homeForOrg(homes, "Z")).to.equal(null);
  });
});
