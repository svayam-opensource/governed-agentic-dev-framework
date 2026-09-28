// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * STAMPING A CUE WITH ITS CLAUSE'S HASH.
 *
 * The staleness guard (§2.5) compares a stored hash against the clause the cue sits under. Every cue I authored
 * carried `clause-sha=TBD` until a throwaway script filled them in — so the guard's input was maintained by a
 * file in nobody's repository, which is a guard that stops working the first week nobody runs the script. These
 * tests hold the two properties that make the fill path safe to run automatically: it is idempotent, and it never
 * overwrites a hash that is already there.
 */
import { expect } from "chai";
import { stampCues, ownerOf } from "../../src/rules/cue-stamp.js";
import { parseClauses } from "../../src/rules/notation.js";
import { parseCueBlocks, clauseSha, staleCues } from "../../src/rules/cue-block.js";

const DOC = `### 4.2 Approved technologies

An agent MUST use only an approved dependency. **(POL-210)**

<!-- gov:cue generated clause-sha=TBD — approved in PR #214 -->
> **Always in the agent's context** · POL-210 · C02
> TECHNOLOGY CHOICES ARE NOT YOURS.
`;

describe("cue stamping — filling in the hash the guard compares", () => {
  it("stamps a TBD with the hash of the clause above it", () => {
    const r = stampCues("policies/p.md", DOC);
    const { clauses } = parseClauses("policies/p.md", DOC);
    const want = clauseSha(clauses[0]!.text);
    expect(r.text).to.contain(`clause-sha=${want}`);
    expect(r.text).to.not.contain("TBD");
    expect(r.stamped).to.deep.equal(["POL-210 §4.2"]);
  });

  it("keeps the author's own note — the one part of that comment a person wrote", () => {
    expect(stampCues("policies/p.md", DOC).text).to.contain("approved in PR #214");
  });

  it("is IDEMPOTENT: stamping twice changes nothing", () => {
    const once = stampCues("policies/p.md", DOC).text;
    const twice = stampCues("policies/p.md", once);
    expect(twice.text).to.equal(once);
    expect(twice.stamped, "and it says it did nothing").to.deep.equal([]);
  });

  it("does NOT overwrite a hash that is already there — that is what would defeat the guard", () => {
    // A clause edited without its cue being re-approved must keep reporting `stale-cue`. If the automatic build
    // re-stamped it, the build would silently approve exactly the change the guard exists to catch.
    const stamped = stampCues("policies/p.md", DOC).text;
    const edited = stamped.replace("An agent MUST use only an approved dependency.", "An agent MUST use only a vetted dependency.");
    const again = stampCues("policies/p.md", edited);
    expect(again.text, "left alone").to.equal(edited);
    expect(again.kept).to.deep.equal(["POL-210 §4.2"]);

    const { clauses } = parseClauses("policies/p.md", edited);
    const { blocks } = parseCueBlocks("policies/p.md", edited);
    expect(staleCues(clauses, blocks).map((d) => d.kind), "so the guard still fires").to.deep.equal(["stale-cue"]);
  });

  it("restamp is the explicit 'I re-read it and it still holds' action", () => {
    const stamped = stampCues("policies/p.md", DOC).text;
    const edited = stamped.replace("approved dependency", "vetted dependency");
    const forced = stampCues("policies/p.md", edited, "restamp");
    expect(forced.stamped).to.deep.equal(["POL-210 §4.2"]);
    const { clauses } = parseClauses("policies/p.md", forced.text);
    const { blocks } = parseCueBlocks("policies/p.md", forced.text);
    expect(staleCues(clauses, blocks), "and the guard is satisfied again").to.deep.equal([]);
  });

  it("adds the attribute when a cue has none at all, rather than leaving it unverifiable", () => {
    const bare = DOC.replace(" clause-sha=TBD", "");
    const r = stampCues("policies/p.md", bare);
    expect(r.text).to.match(/gov:cue generated clause-sha=[0-9a-f]{7}/);
  });

  it("the owner of a cue is the nearest clause ABOVE it, not the section's first", () => {
    const two = `### 2.1 Levels

An agent MUST stop. **(POL-011)**

A rule SHALL NOT be waived. **(POL-015)**

<!-- gov:cue generated clause-sha=TBD -->
> **Always in the agent's context** · POL-011…POL-015 · C01
> C01 MEANS STOP.
`;
    const { clauses } = parseClauses("d.md", two);
    const { blocks } = parseCueBlocks("d.md", two);
    expect(ownerOf(clauses, blocks[0]!)!.text).to.contain("SHALL NOT be waived");
  });

  it("leaves a cue with no clause above it alone — an orphan is the parser's diagnostic, not a stamp", () => {
    const orphan = `<!-- gov:cue generated clause-sha=TBD -->
> **Always in the agent's context** · POL-900 · C01
> DO THE THING.
`;
    expect(stampCues("d.md", orphan).stamped).to.deep.equal([]);
  });
});
