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
    // Grouped by WHO TYPES IT since 2026-08-07, not by domain: four commands are yours, the rest are what
    // your agent runs. A reference that presents 27 verbs as equally yours teaches nothing.
    expect(h).to.match(/Your commands/);
    expect(h).to.match(/Your agent runs these/);
    expect(h.indexOf("work"), "the one command an adopter needs comes first").to.be.lessThan(h.indexOf("seed"));
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
  it("helpCommandNames lists every command in the reference — and only gov-work's own", () => {
    const names = helpCommandNames();
    expect(names).to.include.members(["seed", "manage", "upgrade"]);
    // `deploy` and friends were listed under an "Enterprise (plugin)" group while gov delegated them.
    // They belong to gov-cicd now (adr-three-clients, PRJ-43); advertising a verb this binary does not
    // run is how a help reference starts lying.
    expect(names, "moved verbs must not be advertised as gov commands")
      .to.not.include.members(["deploy", "promote", "catalog", "rollback", "drift", "auth", "creds"]);
  });
});
