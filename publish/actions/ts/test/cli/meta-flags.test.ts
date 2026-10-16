// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { readCliVersion, helpLines, helpCommandNames } from "../../src/cli/main.js";

describe("gov-work — meta flags (--version / --help work without a workspace)", () => {
  it("readCliVersion returns the package version (semver-ish)", () => {
    expect(readCliVersion()).to.match(/^\d+\.\d+\.\d+/);
  });
  it("helpLines() is the overview: usage + commands grouped by who runs them, referencing `gov`", () => {
    const h = helpLines().join("\n");
    expect(h).to.match(/usage: gov <command>/);
    // Grouped by WHO TYPES IT since 2026-08-07, not by domain: four commands are yours, the rest are what
    // your agent runs. A reference that presents 27 verbs as equally yours teaches nothing.
    expect(h).to.match(/Your commands/);
    expect(h).to.match(/Your agent runs these/);
    expect(h.indexOf("work"), "the one command an adopter needs comes first").to.be.lessThan(h.indexOf("seed"));
    expect(h).to.match(/seed\s+start a project from a GitHub Project board/);   // command + its summary
    expect(h).to.match(/manage\s+project access/);
    expect(h).to.not.match(/gov-work/);                         // (b) references `gov`, not `gov-work`
  });
  // The page grew from "description + usage" to the shape the Policy Owner asked for (2026-09-22): what it
  // changes and what its exit codes mean, because gov's commands act on shared branches and boards and agents
  // branch on the codes.
  it("helpLines(command) is a real page: usage, an example, what it changes, and the exit codes", () => {
    const s = helpLines("seed").join("\n");
    expect(s).to.match(/gov seed — start a project from a GitHub Project board/);
    expect(s).to.match(/USAGE\s+gov seed <board-url>/);
    expect(s).to.contain("EXAMPLES").and.contain("CHANGES").and.contain("EXIT");
    expect(s, "and it says it creates the branch and the anchor issue").to.contain("anchor issue");
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
