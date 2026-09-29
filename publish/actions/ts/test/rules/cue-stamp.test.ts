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
import { parseCueBlocks, clauseSha, staleCues, declaredPols } from "../../src/rules/cue-block.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

  /**
   * OWNERSHIP IS BY CITATION, NOT BY POSITION (changed 2026-09-29, and the change found ten live defects).
   *
   * It used to be "the nearest clause above", which reads sensible and is wrong for the way people write policy:
   * the rule, then a paragraph explaining why it is a rule, then the cue. The cue anchored to the RATIONALE. In
   * the framework's own policy TEN OF TEN cues were in that state — POL-143's was hashed against "what else your
   * organization classifies … is yours" — so editing POL-143 itself left its cue reporting fresh, while reflowing
   * the paragraph below it reported stale. A guard watching the wrong text is worse than no guard, because it
   * reports green.
   */
  it("anchors a cue to the clause it CITES, even with a rationale paragraph in between", () => {
    const withRationale = `### 2.1 Levels

A rule SHALL NOT be waived. **(POL-015)**

**Why this is absolute.** A level that can be waived is a level nobody plans around, which is the failure this
clause exists to prevent.

<!-- gov:cue generated clause-sha=TBD -->
> **Always in the agent's context** · POL-015 · C01
> C01 MEANS STOP.
`;
    const { clauses } = parseClauses("d.md", withRationale);
    const { blocks } = parseCueBlocks("d.md", withRationale);
    expect(
      ownerOf(clauses, blocks[0]!)!.text,
      "the clause it names, not the paragraph that happens to sit above it",
    ).to.contain("SHALL NOT be waived");
  });

  it("falls back to the nearest clause above when the citation matches no clause", () => {
    // A cue citing a number no clause declares is itself a defect, reported elsewhere. Anchoring it to something
    // is still better than anchoring it to nothing: a hash that exists can at least be compared.
    const uncited = `### 2.1 Levels

A rule SHALL NOT be waived. **(POL-015)**

<!-- gov:cue generated clause-sha=TBD -->
> **Always in the agent's context** · POL-999 · C01
> C01 MEANS STOP.
`;
    const { clauses } = parseClauses("d.md", uncited);
    const { blocks } = parseCueBlocks("d.md", uncited);
    expect(ownerOf(clauses, blocks[0]!)!.text).to.contain("SHALL NOT be waived");
  });

  it("reads only the clause's OWN declaration, not the numbers its body cites", () => {
    // POL-113's steps name POL-114 and POL-116. Treating those as declarations would let one clause answer for
    // three cues, and the first cue to ask would win.
    const citesOthers = `### 9.4 Session start

An agent MUST complete these in order — authorization (POL-114), then the layers (POL-116). **(POL-113)**

A rule SHALL NOT be waived. **(POL-116)**

<!-- gov:cue generated clause-sha=TBD -->
> **Always in the agent's context** · POL-116 · C01
> LOAD THEM FRESH.
`;
    const { clauses } = parseClauses("d.md", citesOthers);
    const { blocks } = parseCueBlocks("d.md", citesOthers);
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

/**
 * THE SHIPPED POLICIES' OWN CUES. Two properties, and they catch different things — which I know because I ran
 * each against the pre-2026-09-29 policy to see which one fired.
 *
 * `no cue is stale` is the regression on the ownership defect: against the old document it reports ten stale
 * cues, one per cue in the file, because every one of them was hashed against the explanatory paragraph between
 * the rule and the cue rather than against the rule.
 *
 * `cites a number a clause declares` is NOT that regression, and it would be dishonest to name it as one: since
 * ownership resolves by citation, the owner is correct by construction and the assertion passes on the broken
 * document too. It earns its place for a different reason — it fails when a cue cites a POL number that no clause
 * in the document declares, which is how a cue survives the deletion of its clause and goes on telling every
 * agent about a rule that is no longer there.
 */
describe("the framework's shipped cues", () => {
  const CONTENT = (() => {
    let d = fileURLToPath(new URL(".", import.meta.url));
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(d, "publish", "content", "MANIFEST.yaml"))) return join(d, "publish", "content");
      d = dirname(d);
    }
    throw new Error("could not locate publish/content");
  })();

  for (const rel of ["framework/policies/framework-policy.md", "policies/org-policy.md"]) {
    it(`${rel}: every cue cites a POL number some clause in the document declares`, () => {
      const text = readFileSync(join(CONTENT, rel), "utf8");
      const { clauses } = parseClauses(rel, text);
      const { blocks } = parseCueBlocks(rel, text);
      expect(blocks.length, "a policy with no cues would pass this vacuously").to.be.greaterThan(0);
      const dangling = blocks
        .filter((b) => !declaredPols(ownerOf(clauses, b)?.text ?? "").includes(b.pol))
        .map((b) => `${b.pol} @line ${b.line}`);
      expect(
        dangling,
        "a cue citing a number no clause declares is resident text in every agent's context for a rule that is "
          + "not in the document — which is what deleting a clause and leaving its cue behind produces.",
      ).to.deep.equal([]);
    });

    it(`${rel}: no cue is stale — the regression on the anchoring defect`, () => {
      const text = readFileSync(join(CONTENT, rel), "utf8");
      const { clauses } = parseClauses(rel, text);
      const { blocks } = parseCueBlocks(rel, text);
      expect(staleCues(clauses, blocks).map((d) => d.message)).to.deep.equal([]);
    });
  }
});
