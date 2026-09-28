// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE NOTATION (rules-and-cues-design.md §2.2) — the six compiler rules, and the false positives that would
 * otherwise turn ordinary policy prose into governance.
 *
 * What these tests hold to: the ALL-CAPS modal is the level and lowercase prose creates nothing; a clause
 * carrying two levels is an error rather than a guess; `MAY NOT` and `SHOULD` are refused with a pointer; and a
 * clause with no modal is reported, never dropped — the one number a Policy Owner cannot otherwise see.
 */
import { expect } from "chai";
import { formatReport, parseClauses, snippet, headingSection, actorOf, type Clause, type Diagnostic } from "../../src/rules/notation.js";

/** A policy document shaped like the real ones: front matter, a normative table, a stored cue, a fenced sample. */
const DOC = [
  "---",
  "domain: policies",
  "compliance: C01",
  "---",
  "",
  "# Approved technologies",
  "",
  "This document must be read alongside the data classification standard.",
  "",
  "## 4. Technology",
  "",
  "### 4.1 The stack",
  "",
  "Units MUST use the mandated stack for their unit type.",
  "",
  "Introducing a technology that is not listed MAY proceed only with an approved exception.",
  "",
  "| Modal | Level |",
  "|---|---|",
  "| MUST · MUST NOT | C01 |",
  "| MAY | C02 |",
  "",
  "### 4.2 Approved technologies",
  "",
  "Units MUST use the mandated stack and MAY extend it.",
  "",
  "A unit MUST NOT vendor a dependency it has not declared.",
  "",
  "An agent SHOULD prefer the smallest library that does the job.",
  "",
  "A contractor MAY NOT publish to the internal registry.",
  "",
  "Teams CAN keep a local mirror of the registry.",
  "",
  "The list itself is maintained by the Data Architect.",
  "",
  "<!-- gov:cue generated clause-sha=8f2a1c4 — approved in PR #214 -->",
  "> **Always in the agent's context** · POL-210 · C02",
  "> TECHNOLOGY CHOICES ARE NOT YOURS. You MUST NOT pick one yourself.",
  "<!-- gov:check kind=list-membership when=pkg on_miss=fail -->",
  "",
  "~~~ts",
  "// a sample of the notation: a clause MUST carry its modal in ALL CAPS",
  "~~~",
  "",
  "### 4.3 Branches",
  "",
  "- A branch name MUST match the project's board number.",
  "- A team CAN keep a scratch branch outside the convention.",
  "",
].join("\n");

const parsed = parseClauses("policies/approved-technologies.md", DOC);
const at = (section: string, ordinal: number): Clause =>
  parsed.clauses.find((c) => c.section === section && c.ordinal === ordinal)!;

/**
 * Diagnostics in a section, EXCLUDING rule 7's `actor-unnamed`.
 *
 * Rule 7 is a warning about prose style and fires on most real clauses until they are rewritten to name their
 * actor. A test about rule 2 or about skipping tables must not also assert that the fixture's wording is
 * exemplary — that coupling is how one new warning breaks nine unrelated tests.
 */
const errorsIn = (section: string): readonly Diagnostic[] =>
  parsed.diagnostics.filter((d) => d.section === section && d.kind !== "actor-unnamed");

describe("notation — rule 1: the modal is ALL CAPS, or it is not a modal", () => {
  it('a lowercase "must" in ordinary prose creates no rule at all', () => {
    // THE HAZARD this test exists for: a policy document says "must" in prose constantly ("this must be read
    // alongside…"). Case-insensitive matching would give every one of them a level, a POL number, a cue in every
    // agent's resident context and a CI check — the compiler would manufacture governance nobody wrote.
    const lower = parseClauses("d.md", "### 1.1 Scope\n\nThis must be read with the standard.\n");
    expect(lower.clauses).to.have.length(1);
    expect(lower.clauses[0]!.governed, "lowercase prose is not a rule").to.equal(false);
    expect(lower.clauses[0]!.modal).to.equal(undefined);
    expect(lower.diagnostics, "and it is not an error either").to.deep.equal([]);
  });

  it('a capitalised "Must" at the start of a sentence is still prose', () => {
    const one = parseClauses("d.md", "### 1.1 Scope\n\nMust the unit declare it? Yes.\n");
    expect(one.clauses[0]!.governed).to.equal(false);
  });

  it("matches on word boundaries, so a word CONTAINING a modal is not one", () => {
    const one = parseClauses("d.md", "### 1.1 Scope\n\nThe MUSTARD standard and the CANDIDATE list apply.\n");
    expect(one.clauses[0]!.modal, "MUSTARD is not MUST").to.equal(undefined);
    expect(one.clauses[0]!.governed).to.equal(false);
  });

  it("a modal inside `inline code` is a MENTION of the notation, not a use of it", () => {
    // THE HAZARD, found by running this compiler over the framework's own rewritten policy: §1.3 of it IS the
    // list of these rules — "`MAY NOT` is rejected. In English it usually means prohibition…" — and read
    // naively the document that defines the notation reports three errors against itself. The exemplar every
    // adopter copies would be the one document that cannot compile.
    const doc = ["### 1.3 The notation", "",
      "3. **Negation keeps the level.** `MUST NOT` and `SHALL NOT` are C01.",
      "4. **`MAY NOT` is rejected.** Write `MUST NOT`, or \"is not required to\".", ""].join("\n");
    const one = parseClauses("d.md", doc);
    expect(one.diagnostics, "the notation's own definition is not a notation error").to.deep.equal([]);
    expect(one.clauses.map((c) => c.governed)).to.deep.equal([false, false]);
  });

  it("but a modal OUTSIDE the backticks in the same clause still counts", () => {
    const one = parseClauses("d.md", "### 1.1 S\n\nA branch name MUST match `BRNCH-<board#>-<slug>`.\n");
    expect(one.clauses[0]!.level).to.equal("C01");
  });

  it("MUST · SHALL → C01, MAY → C02, CAN → C03", () => {
    expect(parseClauses("d.md", "### 1 S\n\nA unit MUST do it.").clauses[0]!.level).to.equal("C01");
    expect(parseClauses("d.md", "### 1 S\n\nA unit SHALL do it.").clauses[0]!.level).to.equal("C01");
    expect(parseClauses("d.md", "### 1 S\n\nA unit MAY do it.").clauses[0]!.level).to.equal("C02");
    expect(parseClauses("d.md", "### 1 S\n\nA unit CAN do it.").clauses[0]!.level).to.equal("C03");
  });
});

describe("notation — rule 2: one clause, one modal", () => {
  it("two DIFFERENT modals in one clause is a split-clause error", () => {
    const d = parsed.diagnostics.find((x) => x.kind === "split-clause")!;
    expect(d, "the design's own example: MUST use the stack and MAY extend it").to.not.equal(undefined);
    expect(d.section).to.equal("4.2");
    expect(d.message).to.contain("MUST").and.contain("MAY").and.contain("split");
    expect(d.line, "and it says which line to split").to.be.greaterThan(1);
  });

  it("the SAME modal twice is fine — a clause may have two obligations at one level", () => {
    const one = parseClauses("d.md", "### 1.1 S\n\nAn agent MUST declare it and MUST keep it current.\n");
    expect(one.diagnostics).to.deep.equal([]);
    expect(one.clauses[0]!.level).to.equal("C01");
  });

  it("a split clause is still CLASSIFIED (by its first modal), not dropped", () => {
    // Dropping it would make an error also a silent loss of the clause from the report — two failures for one
    // mistake, and the ungoverned count would move for a reason that has nothing to do with levels.
    expect(at("4.2", 1).level).to.equal("C01");
    expect(at("4.2", 1).governed).to.equal(true);
  });

  it("a bullet list is one clause PER ITEM, so an ordinary list of requirements is not a split-clause error", () => {
    // THE HAZARD: policies are written in lists. Joined into one paragraph, a five-bullet list at three levels
    // would report as an error and no bullet could hold a POL number of its own.
    expect(at("4.3", 1).level).to.equal("C01");
    expect(at("4.3", 2).level).to.equal("C03");
    expect(errorsIn("4.3")).to.deep.equal([]);
  });
});

describe("notation — rule 3: negation keeps the level", () => {
  it("MUST NOT is C01, not a level of its own", () => {
    expect(at("4.2", 2).modal).to.equal("MUST NOT");
    expect(at("4.2", 2).level).to.equal("C01");
  });

  it("SHALL NOT is C01", () => {
    const one = parseClauses("d.md", "### 1.1 S\n\nAn agent SHALL NOT let credentials enter a repository.\n");
    expect(one.clauses[0]!.modal).to.equal("SHALL NOT");
    expect(one.clauses[0]!.level).to.equal("C01");
    expect(one.diagnostics, "a prohibition is not two modals").to.deep.equal([]);
  });

  it("a prohibition split over two lines is still one modal", () => {
    // THE HAZARD: clauses are re-wrapped by editors. `MUST\nNOT` read as a bare MUST would turn a prohibition
    // into a requirement to do the thing.
    const one = parseClauses("d.md", "### 1.1 S\n\nAn agent MUST\nNOT vendor a dependency.\n");
    expect(one.clauses[0]!.modal).to.equal("MUST NOT");
    expect(one.diagnostics).to.deep.equal([]);
  });
});

describe("notation — rule 4: MAY NOT is refused", () => {
  it("MAY NOT is an error, and the message names both replacements", () => {
    const d = parsed.diagnostics.find((x) => x.kind === "may-not-ambiguous")!;
    expect(d.section).to.equal("4.2");
    expect(d.message).to.contain("MUST NOT").and.contain("is not required to");
  });

  it("MAY NOT is matched BEFORE plain MAY — it never compiles to a C02 permission", () => {
    // THE HAZARD, and the reason the alternation is ordered: matching MAY first reads "a contractor MAY NOT
    // publish" as PERMISSION TO PUBLISH. The clause would be inverted, at C02, with a cue telling every agent so.
    const one = parseClauses("d.md", "### 1.1 S\n\nA contractor MAY NOT publish to the registry.\n");
    expect(one.clauses[0]!.modal).to.equal("MAY NOT");
    expect(one.clauses[0]!.level, "refused, not C02").to.equal(undefined);
    expect(one.clauses[0]!.governed).to.equal(false);
    expect(one.diagnostics.map((x) => x.kind)).to.deep.equal(["may-not-ambiguous"]);
  });

  it("a refused modal is NOT a split-clause on its own", () => {
    const one = parseClauses("d.md", "### 1.1 S\n\nA contractor MAY NOT publish.\n");
    expect(one.diagnostics.filter((x) => x.kind === "split-clause")).to.deep.equal([]);
  });
});

describe("notation — rule 5: SHOULD is refused with a pointer", () => {
  it("SHOULD is an error that names MAY (C02) and CAN (C03)", () => {
    const d = parsed.diagnostics.find((x) => x.kind === "should-unsupported")!;
    expect(d.section).to.equal("4.2");
    expect(d.message).to.contain("MAY (C02").and.contain("CAN (C03");
  });

  it("SHOULD NOT is refused the same way, and is not read as a bare SHOULD plus a negation", () => {
    const one = parseClauses("d.md", "### 1.1 S\n\nAn agent SHOULD NOT reach for a habit.\n");
    expect(one.clauses[0]!.modal).to.equal("SHOULD NOT");
    expect(one.clauses[0]!.governed).to.equal(false);
    expect(one.diagnostics.map((x) => x.kind)).to.deep.equal(["should-unsupported"]);
  });

  it("a refused modal is reported even when it is not the FIRST modal in the clause", () => {
    const one = parseClauses("d.md", "### 1.1 S\n\nAn agent MUST declare it and SHOULD keep it small.\n");
    // NOT a split-clause: SHOULD carries no level, so the clause states exactly one (C01). Rule 2 fires on
    // distinct LEVELS, not on the count of modals — corrected 2026-09-26 after the first version failed on the
    // framework's own policy, where ten clauses pair an obligation with its prohibition at the same level.
    expect(one.diagnostics.map((x) => x.kind)).to.have.members(["should-unsupported"]);
  });

  it("two modals at the SAME level are one clause, not a split — the corpus case that corrected rule 2", () => {
    const same = parseClauses("d.md", "### 1.1 S\n\ngov MUST issue the id at seed and MUST NOT accept one assigned by hand.\n");
    expect(same.diagnostics, "a prohibition qualifying its own obligation is one rule").to.deep.equal([]);
    expect(same.clauses[0]!.level).to.equal("C01");
  });

  it("two modals at DIFFERENT levels is still a split — neither the POL number nor the cue could say which half", () => {
    const two = parseClauses("d.md", "### 1.1 S\n\nAn agent MAY reassign a project and SHALL NOT reopen a closed one.\n");
    expect(two.diagnostics.map((x) => x.kind)).to.deep.equal(["split-clause"]);
    expect(two.diagnostics[0]!.message).to.contain("two levels in one clause");
  });
});

describe("notation — rule 6: no modal is ungoverned, never silent and never an error", () => {
  it("prose with no modal is kept as a clause, ungoverned", () => {
    const c = at("4.2", 6);
    expect(c.text).to.contain("maintained by the Data Architect");
    expect(c.governed).to.equal(false);
    expect(c.modal, "no modal at all — distinct from a REFUSED one").to.equal(undefined);
  });

  it("and it produces no diagnostic: prose that is not a rule is legitimate", () => {
    const one = parseClauses("d.md", "### 1.1 S\n\nThe Data Architect maintains the list.\n");
    expect(one.diagnostics).to.deep.equal([]);
    expect(one.clauses).to.have.length(1);
  });
});

describe("notation — what is NOT a clause", () => {
  it("front matter is metadata, not the document's first clause", () => {
    expect(parsed.clauses.some((c) => c.text.includes("compliance:")), "front matter parsed as a clause").to.equal(false);
  });

  it("a stored gov:cue block is skipped — the machine's own output is not policy prose", () => {
    // THE HAZARD: a cue is written in ALL-CAPS imperatives and its header line carries "· C02". Read as a
    // clause it compiles the cue into a second rule, at a level nobody authored.
    expect(parsed.clauses.some((c) => c.text.includes("TECHNOLOGY CHOICES")), "the cue became a clause").to.equal(false);
    expect(parsed.clauses.some((c) => c.text.includes("gov:check")), "the check comment became a clause").to.equal(false);
  });

  it("a markdown table is skipped — §2.1's own modal table is REQUIRED in every policy document", () => {
    // THE HAZARD: that table lists MUST · MUST NOT · MAY · CAN with their levels. Read as a clause, the first
    // thing the compiler would report about the exemplar document is a split-clause error in the normative table.
    expect(parsed.clauses.some((c) => c.text.startsWith("|")), "a table row became a clause").to.equal(false);
    expect(errorsIn("4.1"), "and no error from it").to.deep.equal([]);
  });

  it("a fenced block is a sample: a modal inside it is an example OF the notation", () => {
    expect(parsed.clauses.some((c) => c.text.includes("a sample of the notation")), "fenced sample became a clause").to.equal(false);
  });

  it("backtick fences are skipped as well as tilde ones", () => {
    const fenced = ["### 1.1 S", "", "```sh", "gov rules build   # a unit MUST run this", "```", "", "A unit MAY skip it.", ""].join("\n");
    const one = parseClauses("d.md", fenced);
    expect(one.clauses).to.have.length(1);
    expect(one.clauses[0]!.level).to.equal("C02");
  });
});

describe("notation — where a clause is", () => {
  it("the section number comes from the heading, with the typographic dot dropped", () => {
    expect(headingSection("### 4.2 Approved technologies")).to.equal("4.2");
    expect(headingSection("## 7. Data")).to.equal("7");
    expect(headingSection("# Approved technologies")).to.equal(null);
    expect(headingSection("not a heading")).to.equal(null);
  });

  it("clauses carry the document, the section, a 1-based ordinal and the line", () => {
    const c = at("4.1", 1);
    expect(c.doc).to.equal("policies/approved-technologies.md");
    expect(c.ordinal).to.equal(1);
    expect(DOC.split("\n")[c.line - 1], "the line points at the clause").to.contain("mandated stack");
  });

  it("the ordinal restarts per section", () => {
    expect(at("4.2", 1).text).to.contain("and MAY extend it");
    expect(at("4.3", 1).text).to.contain("branch name");
  });

  it("an unnumbered sub-heading does NOT end the numbered section", () => {
    // THE HAZARD: clearing the section on any unnumbered heading silently drops every clause written under a
    // "#### Why" — and rule 6 exists precisely so that nothing is dropped silently.
    const doc = ["### 4.2 Stack", "", "#### Why", "", "A unit MUST use it.", ""].join("\n");
    expect(parseClauses("d.md", doc).clauses[0]!.section).to.equal("4.2");
  });

  it("an unnumbered heading at the same level DOES end it", () => {
    const doc = ["### 4.2 Stack", "", "### Appendix", "", "The stack is listed below.", ""].join("\n");
    expect(parseClauses("d.md", doc).clauses, "prose outside a numbered section is not a clause").to.deep.equal([]);
  });

  it("a REQUIREMENT outside any numbered section is an error, because it can never be numbered or cited", () => {
    const doc = ["# Policy", "", "A unit MUST declare its dependencies.", ""].join("\n");
    const one = parseClauses("d.md", doc);
    expect(one.clauses).to.deep.equal([]);
    expect(one.diagnostics.map((d) => d.kind)).to.deep.equal(["unsectioned-requirement"]);
    expect(one.diagnostics[0]!.message).to.contain("POL number");
  });

  it("but unlevelled prose outside a section is silent — a preamble is not a fault", () => {
    expect(parsed.diagnostics.filter((d) => d.kind === "unsectioned-requirement"), "the lowercase preamble").to.deep.equal([]);
  });
});

describe("notation — the compile report", () => {
  const report = formatReport([parsed]).join("\n");

  it("counts clauses, governed with the level breakdown, and ungoverned — and they add up", () => {
    const governed = parsed.clauses.filter((c) => c.governed).length;
    expect(report).to.contain(`${parsed.clauses.length} clauses, ${governed} governed`);
    expect(report).to.match(/C01 \d+ · C02 \d+ · C03 \d+/);
    expect(report).to.contain(`${parsed.clauses.length - governed} ungoverned`);
  });

  it("names the document, and totals across documents", () => {
    const two = formatReport([parsed, parseClauses("policies/data.md", "### 1.1 S\n\nCredentials MUST NOT be logged.\n")]).join("\n");
    expect(two).to.contain("2 documents");
    expect(two).to.contain("policies/approved-technologies.md").and.contain("policies/data.md");
  });

  it("locates every ERROR by document, section and line, and counts the warnings", () => {
    // Errors in full, warnings counted (2026-09-28). Rule 7 fires on 75 clauses in the framework's own policy,
    // and listing each would bury the handful that must be fixed before anything can be written.
    for (const d of parsed.diagnostics.filter((x) => x.kind !== "actor-unnamed")) {
      expect(report).to.contain(`${d.doc} §${d.section}:${d.line}`);
    }
    expect(report).to.contain("split-clause").and.contain("may-not-ambiguous").and.contain("should-unsupported");
    const warnings = parsed.diagnostics.filter((x) => x.kind === "actor-unnamed").length;
    if (warnings) {
      expect(report, "a warning is counted, with where to find the detail").to.contain(`warnings (${warnings})`);
      expect(report).to.contain("actor column");
    }
  });

  it("lists the ungoverned clauses by section, so a Policy Owner can read the sentences and decide", () => {
    expect(report).to.contain("ungoverned clauses");
    expect(report).to.contain("§4.2:").and.contain("The list itself is maintained by the Data Architect");
  });

  it("does not list a REFUSED modal among the ungoverned — it is already an error above", () => {
    const lines = report.slice(report.indexOf("ungoverned clauses")).split("\n");
    expect(lines.some((l) => l.includes("MAY NOT publish")), "MAY NOT reported twice").to.equal(false);
    expect(lines.some((l) => l.includes("SHOULD prefer")), "SHOULD reported twice").to.equal(false);
  });

  it("restates the level table, because the report is where an author learns the notation", () => {
    expect(report).to.contain("MUST").and.contain("C01").and.contain("MAY").and.contain("C02");
  });

  it("says so when there is nothing to report", () => {
    expect(formatReport([]).join("\n")).to.contain("no policy documents scanned");
  });

  it("snippet flattens and cuts at 60 characters", () => {
    expect(snippet("a\n  b   c")).to.equal("a b c");
    expect(snippet("x".repeat(100))).to.have.length(61).and.to.match(/…$/);
  });
});

describe("notation — rule 7: a rule names its actor", () => {
  // WHY THIS RULE EXISTS, measured: a classifier over the framework's own policy could not place 47% of clauses,
  // because they use a pronoun with the subject in a previous sentence — "It MUST commit nothing, to any branch".
  // If a parser cannot find the actor, neither can a reader skimming for "is this about me?", and neither can an
  // agent deciding whether the rule governs what it is about to do.
  it("finds gov, and gov WINS when an agent is mentioned in the same clause", () => {
    expect(actorOf("gov MUST refuse to launch an agent whose file is empty.")).to.equal("gov");
    expect(actorOf("The framework MUST ship the workflow.")).to.equal("gov");
  });

  it("finds an agent", () => {
    expect(actorOf("An agent MUST hard stop all work immediately.")).to.equal("agent");
    expect(actorOf("Agents MAY be custom-built.")).to.equal("agent");
  });

  it("finds a person, by role", () => {
    expect(actorOf("The Policy Owner MUST approve the change.")).to.equal("person");
    expect(actorOf("The requester MUST raise a pull request.")).to.equal("person");
  });

  it("says UNKNOWN rather than guessing — a wrong actor decides the enforcement class", () => {
    expect(actorOf("It MUST commit nothing, to any branch.")).to.equal("unknown");
    expect(actorOf("A pull request MUST be required before merging.")).to.equal("unknown");
  });

  it("ignores an actor mentioned only inside code, which is a reference and not a subject", () => {
    expect(actorOf("A branch named `gov-managed` MUST match the pattern.")).to.equal("unknown");
  });

  it("reports a RULE with no actor, and never reports unlevelled prose", () => {
    const rule = parseClauses("d.md", "### 1.1 S\n\nIt MUST commit nothing.\n");
    expect(rule.diagnostics.map((d) => d.kind)).to.deep.equal(["actor-unnamed"]);

    const prose = parseClauses("d.md", "### 1.1 S\n\nThis section explains the rules that follow.\n");
    expect(prose.diagnostics, "prose is not a rule, so it has nobody to be about").to.deep.equal([]);
  });

  it("is a WARNING, not an error — the framework's own policy has 90-odd clauses to fix", () => {
    // A hard failure would mean nobody could build until every clause was rewritten, which is how a good rule
    // gets switched off. The build reports it and carries on.
    const r = parseClauses("d.md", "### 1.1 S\n\nIt MUST commit nothing.\n");
    expect(r.clauses[0]!.level, "the clause is still compiled").to.equal("C01");
    expect(r.clauses[0]!.actor).to.equal("unknown");
  });
});
