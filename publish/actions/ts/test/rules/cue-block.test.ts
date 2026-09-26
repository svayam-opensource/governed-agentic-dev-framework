// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE STORED CUE BLOCK (rules-and-cues-design.md §2.3–§2.5, §4.1).
 *
 * What these tests hold to: the cue is stored beside its clause and round-trips BYTE FOR BYTE (a cue that is not
 * byte-stable makes `--check` meaningless and a ratified render indistinguishable from a drifted one); a cue whose
 * clause has been reworded is an ERROR, not a warning; the predicate vocabulary is exactly six kinds; and an
 * unknown kind is reported rather than thrown, so one typo cannot abort the compile of every other document.
 */
import { expect } from "chai";
import {
  CHECK_KINDS, CUE_HEADER, clauseSha, identityOf, parseCheck, parseCueBlocks, renderCueBlock, staleCues,
  type Check,
} from "../../src/rules/cue-block.js";
import { parseClauses } from "../../src/rules/notation.js";

const CLAUSE = "Units MUST use the mandated stack for their unit type.";
const SHA = clauseSha(CLAUSE);

/** A policy document with one clause and its approved cue, as §2.3 shows it. */
const doc = (sha: string): string => [
  "### 4.2 Approved technologies",
  "",
  CLAUSE,
  "",
  `<!-- gov:cue generated clause-sha=${sha} — approved in PR #214 -->`,
  `> ${CUE_HEADER} · POL-210 · C02`,
  "> TECHNOLOGY CHOICES ARE NOT YOURS. Before adding a dependency, run",
  "> gov knowledge search \"approved <thing>\". Not named? STOP and ask.",
  "<!-- gov:check kind=list-membership when=pkg.json,go.mod list=policies/approved.md on_miss=fail -->",
  "",
].join("\n");

describe("cue blocks — parsing what is stored beside the clause", () => {
  const { blocks, diagnostics } = parseCueBlocks("policies/approved.md", doc(SHA));

  it("reads the POL number, the level, the clause hash and where it was approved", () => {
    expect(diagnostics).to.deep.equal([]);
    expect(blocks).to.have.length(1);
    const b = blocks[0]!;
    expect(b.pol).to.equal("POL-210");
    expect(b.level).to.equal("C02");
    expect(b.clauseSha).to.equal(SHA);
    expect(b.approvedIn).to.equal("PR #214");
    expect(b.doc).to.equal("policies/approved.md");
    expect(b.section, "so a message can name the section").to.equal("4.2");
    expect(b.line, "the line of the gov:cue comment").to.equal(5);
  });

  it("the cue itself is the blockquote below the header, markers stripped — that IS the resident text", () => {
    expect(blocks[0]!.cue.split("\n")).to.have.length(2);
    expect(blocks[0]!.cue).to.contain("TECHNOLOGY CHOICES ARE NOT YOURS").and.contain("STOP and ask");
    expect(blocks[0]!.cue, "the header line is not part of the cue").to.not.contain(CUE_HEADER);
  });

  it("reads the check that travels with it", () => {
    const c = blocks[0]!.check!;
    expect(c.kind).to.equal("list-membership");
    expect(c.when).to.deep.equal(["pkg.json", "go.mod"]);
    expect(c.attrs).to.deep.equal({ list: "policies/approved.md" });
    expect(c.onMiss).to.equal("fail");
  });

  it("accepts a check comment wrapped over two lines, as the design writes it", () => {
    const wrapped = [
      "### 4.2 S", "", CLAUSE, "",
      `<!-- gov:cue generated clause-sha=${SHA} -->`,
      `> ${CUE_HEADER} · POL-210 · C02`,
      "> STOP and ask.",
      "<!-- gov:check kind=list-membership when=pkg.json",
      "     list=policies/approved.md on_miss=fail -->",
      "",
    ].join("\n");
    const r = parseCueBlocks("d.md", wrapped);
    expect(r.diagnostics).to.deep.equal([]);
    expect(r.blocks[0]!.check!.attrs["list"]).to.equal("policies/approved.md");
  });

  it("is lenient about a blank line a person left between the comment and the cue", () => {
    // A parser that only accepts what it writes turns a harmless hand-edit into "no cue here", which reads as
    // THIS CLAUSE HAS NO CUE — the one conclusion that must never be reached by accident.
    const spaced = doc(SHA).replace(`> ${CUE_HEADER}`, `\n> ${CUE_HEADER}`);
    expect(parseCueBlocks("d.md", spaced).blocks).to.have.length(1);
  });

  it("a cue comment with no blockquote is malformed, and says what is missing", () => {
    const r = parseCueBlocks("d.md", `### 1.1 S\n\n${CLAUSE}\n\n<!-- gov:cue generated clause-sha=${SHA} -->\n\nMore prose.\n`);
    expect(r.blocks).to.deep.equal([]);
    expect(r.diagnostics.map((d) => d.kind)).to.deep.equal(["malformed-cue"]);
    expect(r.diagnostics[0]!.message).to.contain("blockquote");
  });

  it("a cue header with no POL number or no level is malformed — it cannot be cited or levelled", () => {
    const noPol = parseCueBlocks("d.md", `### 1.1 S\n\n${CLAUSE}\n\n<!-- gov:cue generated -->\n> ${CUE_HEADER} · C02\n> STOP.\n`);
    expect(noPol.diagnostics.map((d) => d.kind)).to.deep.equal(["malformed-cue"]);
    const noLevel = parseCueBlocks("d.md", `### 1.1 S\n\n${CLAUSE}\n\n<!-- gov:cue generated -->\n> ${CUE_HEADER} · POL-210\n> STOP.\n`);
    expect(noLevel.diagnostics.map((d) => d.kind)).to.deep.equal(["malformed-cue"]);
  });

  it("finds every block in a document, not just the first", () => {
    const two = `${doc(SHA)}\n### 4.3 Branches\n\nA branch MUST be named for its board.\n\n<!-- gov:cue generated clause-sha=abc1234 -->\n> ${CUE_HEADER} · POL-211 · C01\n> NAME THE BRANCH FOR THE BOARD.\n`;
    expect(parseCueBlocks("d.md", two).blocks.map((b) => b.pol)).to.deep.equal(["POL-210", "POL-211"]);
  });
});

describe("cue blocks — clauseSha", () => {
  it("is short, stable and hex", () => {
    expect(SHA).to.match(/^[0-9a-f]{7}$/);
    expect(clauseSha(CLAUSE)).to.equal(SHA);
  });

  it("ignores re-wrapping and trailing whitespace — a reflow is not a policy change", () => {
    // THE HAZARD: if formatting counted, every editor that re-wraps a paragraph at 100 columns would report a
    // stale cue, and a report that cries wolf on whitespace is a report whose real stale lines get skimmed past.
    expect(clauseSha("Units MUST use\n  the mandated stack   for their unit type.  ")).to.equal(clauseSha(CLAUSE));
  });

  it("changes when a WORD changes — that is the whole point", () => {
    expect(clauseSha(CLAUSE.replace("MUST", "MAY"))).to.not.equal(SHA);
  });

  it("identityOf composes a clause into what the lockfile keys on", () => {
    const clause = parseClauses("policies/approved.md", `### 4.2 S\n\n${CLAUSE}\n`).clauses[0]!;
    expect(identityOf(clause)).to.deep.equal({ doc: "policies/approved.md", section: "4.2", clauseSha: SHA });
  });
});

describe("cue blocks — staleness is a POLICY ERROR (§2.5)", () => {
  const clausesOf = (text: string) => parseClauses("policies/approved.md", text).clauses;

  it("a matching hash is silent", () => {
    const text = doc(SHA);
    expect(staleCues(clausesOf(text), parseCueBlocks("policies/approved.md", text).blocks)).to.deep.equal([]);
  });

  it("a reworded clause with an unchanged cue is reported, naming the section and the POL number", () => {
    // THE HAZARD this exists for: the cue is approved once and stored; the clause is then reworded and nothing
    // notices. Every agent keeps obeying the old text, in the one block guaranteed to be in context every turn.
    const text = doc(SHA).replace(CLAUSE, "Units MUST use the mandated stack, or an approved alternative.");
    const d = staleCues(clausesOf(text), parseCueBlocks("policies/approved.md", text).blocks);
    expect(d).to.have.length(1);
    expect(d[0]!.kind).to.equal("stale-cue");
    expect(d[0]!.section).to.equal("4.2");
    expect(d[0]!.message).to.contain("POL-210").and.contain("stale");
    expect(d[0]!.line, "the cue's line, which is what must be re-drafted").to.equal(5);
  });

  it("a cue with NO clause-sha is reported too: drift cannot be detected at all", () => {
    const text = doc(SHA).replace(`clause-sha=${SHA} `, "");
    const d = staleCues(clausesOf(text), parseCueBlocks("policies/approved.md", text).blocks);
    expect(d.map((x) => x.kind)).to.deep.equal(["stale-cue"]);
    expect(d[0]!.message).to.contain("no clause-sha");
  });

  it("a cue with no clause above it is an orphan — resident text nobody ratified", () => {
    const text = [`<!-- gov:cue generated clause-sha=${SHA} -->`, `> ${CUE_HEADER} · POL-210 · C02`, "> STOP.", ""].join("\n");
    const d = staleCues([], parseCueBlocks("policies/approved.md", text).blocks);
    expect(d.map((x) => x.kind)).to.deep.equal(["orphan-cue"]);
  });

  it("the owning clause is the one DIRECTLY above, not the first in the section", () => {
    const text = [
      "### 4.2 S", "", "Prose that is not a rule.", "", CLAUSE, "",
      `<!-- gov:cue generated clause-sha=${SHA} -->`, `> ${CUE_HEADER} · POL-210 · C02`, "> STOP.", "",
    ].join("\n");
    expect(staleCues(clausesOf(text), parseCueBlocks("policies/approved.md", text).blocks)).to.deep.equal([]);
  });
});

describe("cue blocks — parseCheck: six predicates, no seventh", () => {
  it("the vocabulary is exactly the six of §4.1", () => {
    expect([...CHECK_KINDS]).to.deep.equal([
      "naming", "path-scope", "list-membership", "content-forbidden", "file-required", "frontmatter-required",
    ]);
  });

  it("every one of the six parses", () => {
    for (const kind of CHECK_KINDS) {
      const r = parseCheck(`kind=${kind} when=x on_miss=fail`);
      expect(r.problems, kind).to.deep.equal([]);
      expect(r.check!.kind).to.equal(kind);
    }
  });

  it("an unknown kind is a DIAGNOSTIC, never a throw", () => {
    // THE HAZARD: a throw would abort the compile of every other policy document because of one typo, and the
    // author would see a stack trace instead of the line to fix.
    const r = parseCheck("kind=regex-match when=x");
    expect(r.check).to.equal(undefined);
    expect(r.problems.map((p) => p.kind)).to.deep.equal(["unknown-check-kind"]);
    expect(r.problems[0]!.message).to.contain("regex-match").and.contain("list-membership");
  });

  it("a check with no kind at all is reported, and lists what is available", () => {
    const r = parseCheck("when=x on_miss=fail");
    expect(r.problems.map((p) => p.kind)).to.deep.equal(["malformed-check"]);
    expect(r.problems[0]!.message).to.contain("naming");
  });

  it("on_miss DEFAULTS TO fail — absence of a rule must not read as permission (§2.4)", () => {
    expect(parseCheck("kind=naming when=x").check!.onMiss).to.equal("fail");
    expect(parseCheck("kind=naming when=x on_miss=warn").check!.onMiss).to.equal("warn");
  });

  it("an on_miss nobody recognises is reported AND read as fail, not silently obeyed", () => {
    const r = parseCheck("kind=naming when=x on_miss=ignore");
    expect(r.problems.map((p) => p.kind)).to.deep.equal(["malformed-check"]);
    expect(r.check!.onMiss, "a check that reads as enforced and is not, is the §10.5 failure").to.equal("fail");
  });

  it("when= is a comma list and may be absent; other attributes are kept as written", () => {
    expect(parseCheck("kind=path-scope when=a,b,c").check!.when).to.deep.equal(["a", "b", "c"]);
    // An unquoted value ends at the first space, so a list written with spaces must be quoted — and then the
    // spaces around each glob are trimmed rather than becoming part of a path that will never match.
    expect(parseCheck('kind=path-scope when="a, b ,c"').check!.when).to.deep.equal(["a", "b", "c"]);
    expect(parseCheck("kind=file-required path=knowledge/todo.md").check!.when).to.deep.equal([]);
    expect(parseCheck('kind=naming pattern="^BRNCH-[0-9]+" ').check!.attrs).to.deep.equal({ pattern: "^BRNCH-[0-9]+" });
  });

  it("an unknown kind inside a document becomes a located diagnostic, and the block still parses out", () => {
    const text = doc(SHA).replace("kind=list-membership", "kind=regex-match");
    const r = parseCueBlocks("policies/approved.md", text);
    expect(r.diagnostics.map((d) => d.kind)).to.deep.equal(["unknown-check-kind"]);
    expect(r.diagnostics[0]!.message).to.contain("POL-210");
    expect(r.diagnostics[0]!.section).to.equal("4.2");
    expect(r.blocks[0]!.check, "the cue survives a bad check: the resident text is still ratified").to.equal(undefined);
    expect(r.blocks[0]!.cue).to.contain("TECHNOLOGY CHOICES");
  });
});

describe("cue blocks — renderCueBlock emits ONE canonical form", () => {
  const block = {
    pol: "POL-210", level: "C02" as const, clauseSha: SHA, approvedIn: "PR #214",
    cue: "TECHNOLOGY CHOICES ARE NOT YOURS.\nNot named? STOP and ask.",
    check: { kind: "list-membership", when: ["pkg.json", "go.mod"], attrs: { list: "policies/approved.md" }, onMiss: "fail" } as Check,
  };

  it("renders the block exactly as the design shows it", () => {
    expect(renderCueBlock(block).split("\n")).to.deep.equal([
      `<!-- gov:cue generated clause-sha=${SHA} — approved in PR #214 -->`,
      "> **Always in the agent's context** · POL-210 · C02",
      "> TECHNOLOGY CHOICES ARE NOT YOURS.",
      "> Not named? STOP and ask.",
      "<!-- gov:check kind=list-membership when=pkg.json,go.mod list=policies/approved.md on_miss=fail -->",
    ]);
  });

  it("is IDEMPOTENT: render → parse → render is the same bytes", () => {
    // THE HAZARD, and the reason render-time cue generation was rejected: if the bytes moved, `--check` could
    // never pass twice and nothing could tell a ratified render from a drifted one.
    const once = renderCueBlock(block);
    const reparsed = parseCueBlocks("d.md", `### 4.2 S\n\n${CLAUSE}\n\n${once}\n`).blocks[0]!;
    expect(renderCueBlock(reparsed)).to.equal(once);
    expect(renderCueBlock(parseCueBlocks("d.md", `### 4.2 S\n\n${CLAUSE}\n\n${renderCueBlock(reparsed)}\n`).blocks[0]!)).to.equal(once);
  });

  it("orders check attributes canonically, so typing order cannot change the bytes", () => {
    const a = renderCueBlock({ ...block, check: { ...block.check, attrs: { zed: "1", list: "x" } } });
    const b = renderCueBlock({ ...block, check: { ...block.check, attrs: { list: "x", zed: "1" } } });
    expect(a).to.equal(b);
    expect(a).to.contain("kind=list-membership when=pkg.json,go.mod list=x zed=1 on_miss=fail");
  });

  it("omits what it was not given, and stays parseable", () => {
    const bare = renderCueBlock({ pol: "POL-211", level: "C01", cue: "STOP." });
    expect(bare.split("\n")).to.deep.equal([
      "<!-- gov:cue generated -->",
      "> **Always in the agent's context** · POL-211 · C01",
      "> STOP.",
    ]);
    const r = parseCueBlocks("d.md", `### 1.1 S\n\n${CLAUSE}\n\n${bare}\n`);
    expect(r.blocks[0]!.clauseSha).to.equal(undefined);
    expect(renderCueBlock(r.blocks[0]!)).to.equal(bare);
  });

  it("trims blank cue lines off the ends and keeps the ones inside", () => {
    const r = renderCueBlock({ ...block, cue: "\n\nONE\n\nTWO\n\n", check: undefined });
    expect(r.split("\n").slice(1)).to.deep.equal([
      "> **Always in the agent's context** · POL-210 · C02", "> ONE", ">", "> TWO",
    ]);
    // A blank cue line round-trips as ">" — otherwise the second render would drop it and the bytes would move.
    expect(renderCueBlock(parseCueBlocks("d.md", `### 1.1 S\n\n${CLAUSE}\n\n${r}\n`).blocks[0]!)).to.equal(r);
  });

  it("quotes a value that would otherwise break the attribute list", () => {
    const r = renderCueBlock({ ...block, check: { kind: "naming", when: [], attrs: { pattern: "two words" }, onMiss: "warn" } });
    expect(r).to.contain('pattern="two words" on_miss=warn');
    expect(parseCueBlocks("d.md", `### 1.1 S\n\n${CLAUSE}\n\n${r}\n`).blocks[0]!.check!.attrs["pattern"]).to.equal("two words");
  });
});
