// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { readCliVersion, helpLines, helpCommandNames } from "../../src/cli/main.js";

describe("gov-work — meta flags (--version / --help work without a workspace)", () => {
  it("readCliVersion returns the package version (semver-ish)", () => {
    expect(readCliVersion()).to.match(/^\d+\.\d+\.\d+/);
  });
  it("helpLines() is a git-help-style reference: usage + grouped commands WITH descriptions, referencing `gov`", () => {
    const h = helpLines().join("\n");
    expect(h).to.match(/usage: gov <command>/);
    expect(h).to.match(/Lifecycle/);
    expect(h).to.match(/seed\s+Seed a new project/);            // command + its description
    expect(h).to.match(/manage\s+Project access/);
    expect(h).to.not.match(/gov-work/);                         // (b) references `gov`, not `gov-work`
  });
  it("helpLines(command) gives REAL per-command help (description + usage), not a `--help` pointer", () => {
    const s = helpLines("seed").join("\n");
    expect(s).to.match(/gov seed — Seed a new project/);
    expect(s).to.match(/usage: gov seed <board-url>/);
    expect(s).to.not.match(/--help/);
  });
  it("helpCommandNames lists every command in the reference", () => {
    const names = helpCommandNames();
    expect(names).to.include.members(["seed", "manage", "deploy", "upgrade"]);
  });
});
