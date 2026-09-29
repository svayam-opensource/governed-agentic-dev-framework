// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE COMPILER, END TO END — and the three defects that only appeared by running it.
 *
 * Each of these tests exists because the first working version was wrong in a way no amount of reading found:
 *   · a cue was attributed to every clause in its section, so 8 cued clauses reported as 75;
 *   · unlevelled prose was counted as "advisory", burying the rules that genuinely have nothing behind them
 *     under 237 ordinary paragraphs;
 *   · identity was (doc, section, sha), so a section with four clauses asked "is this a rewording?" about each
 *     in turn, forever — a build that succeeded was followed by a check that asked again.
 */
import { expect } from "chai";
import { build, classify, classSummary, orphanCues, renderRuleMap, frameworkFirst, type PolicyDoc } from "../../src/rules/rules-build.js";
import { parseClauses } from "../../src/rules/notation.js";
import { clauseSha, parseCueBlocks, cueOwner } from "../../src/rules/cue-block.js";
import { emptyLock, FRAMEWORK_POL_START, type PolLock } from "../../src/rules/pol-lock.js";
import { parseLock, renderLock, writeLock, parseLegacyYamlLock, LOCK_FILE } from "../../src/rules/pol-lock-io.js";

const doc = (path: string, text: string): PolicyDoc => ({ path, text });

/** `build` takes one lock per tree now: the framework's numbers and an organization's never mix. */
const twoLocks = (framework = emptyLock(FRAMEWORK_POL_START), org = emptyLock(200)): { framework: PolLock; org: PolLock } => ({ framework, org });


/**
 * FOUR CLAUSES A CUE CITES, AND A FIFTH IT DOES NOT — in one section, on purpose.
 *
 * The fifth is what makes the test discriminating. Matching on the SECTION would credit all five as cued, which
 * is the defect this fixture was built for. Crediting only the cue's ANCHOR would report one, which is the
 * opposite defect and the one that was live until 2026-09-29: a range in the header means what it says, so the
 * cue's own text ("stop, commit nothing, tell the human") genuinely covers POL-011 through POL-014.
 */
const FOUR_CITED_ONE_NOT = `### 2.1 Levels

An agent MUST hard stop. **(POL-011)**

It MUST commit nothing. **(POL-012)**

It MUST tell the human. **(POL-013)**

A C01 rule SHALL NOT be waived. **(POL-014)**

<!-- gov:cue generated clause-sha=PLACEHOLDER -->
> **Always in the agent's context** · POL-011…POL-014 · C01
> C01 MEANS STOP.

An agent MUST also file a report afterwards. **(POL-019)**
`;

/**
 * The cue's hash has to be right or every assertion below is about a stale-cue diagnostic instead.
 *
 * It resolves the owner with `cueOwner`, the SAME function `build` and `staleCues` use, rather than re-deriving
 * "the nearest clause above" here. It did re-derive it, and when ownership changed to by-citation on 2026-09-29
 * this helper kept computing the old answer — so the fixture it built was stale by construction and the test it
 * supported asserted against a diagnostic it had manufactured itself.
 */
function withRealSha(text: string): string {
  const { clauses } = parseClauses("d.md", text);
  const { blocks } = parseCueBlocks("d.md", text);
  return text.replace("PLACEHOLDER", clauseSha(cueOwner(clauses, blocks[0]!)!.text));
}

describe("rules build — enforcement classes, counted honestly", () => {
  const docs = [doc("framework/policies/framework-policy.md", withRealSha(FOUR_CITED_ONE_NOT))];

  it("counts a clause as cued when the cue CITES it, and not merely for sharing its section", () => {
    const r = build(docs, twoLocks(emptyLock(FRAMEWORK_POL_START)));
    const cued = r.map.filter((m) => m.klass === "cued").map((m) => m.pol);
    expect(cued, "the four in the range, and nothing else").to.have.members(["POL-011", "POL-012", "POL-013", "POL-014"]);
    expect(cued, "POL-019 sits in §2.1 and is not cited — section-matching reported five").to.not.include("POL-019");
    expect(r.map.find((m) => m.pol === "POL-019")!.klass, "so it is honestly advisory").to.equal("advisory");
  });

  it("never calls unlevelled prose 'advisory' — it is not a rule at all", () => {
    const r = build([doc("policies/p.md", "### 1.1 Intro\n\nThis document explains the policy.\n")], twoLocks(undefined, emptyLock(200)));
    expect(r.map[0]!.klass).to.equal("ungoverned");
    expect(classSummary(r.map).join(" ")).to.contain("1 are prose (no modal verb");
  });

  it("classifies a clause about gov itself as IMPLEMENTED — editing that prose changes nothing", () => {
    const [c] = parseClauses("d.md", "### 1.1 S\n\ngov MUST refuse to launch an agent whose file is empty.\n").clauses;
    expect(classify(c!, undefined)).to.equal("implemented");
  });

  it("a clause with a CHECK outranks one with only a cue", () => {
    const text = "### 1.1 S\n\nA dependency MAY be approved. **(POL-210)**\n\n<!-- gov:cue generated clause-sha=x -->\n> **Always in the agent's context** · POL-210 · C02\n> CHECK THE LIST.\n\n<!-- gov:check kind=list-membership when=**/package.json list=policies/a.md on_miss=fail -->\n";
    const r = build([doc("policies/p.md", text)], twoLocks(undefined, emptyLock(200)));
    expect(r.map.find((m) => m.level)!.klass).to.equal("checked");
  });

  it("counts cues that sit on a clause with NO level — resident text nobody assigned a level to", () => {
    const text = "### 1.1 S\n\nThis section explains things.\n\n<!-- gov:cue generated clause-sha=x -->\n> **Always in the agent's context** · POL-900 · C01\n> DO THE THING.\n";
    expect(orphanCues(build([doc("policies/p.md", text)], twoLocks(undefined, emptyLock(200))).map)).to.equal(1);
  });
});

describe("rules build — numbering converges", () => {
  const docs = [doc("framework/policies/framework-policy.md", withRealSha(FOUR_CITED_ONE_NOT))];

  it("a first build over an empty lock allocates every clause and asks nothing", () => {
    const r = build(docs, twoLocks(emptyLock(FRAMEWORK_POL_START)));
    expect(r.asks).to.deep.equal([]);
    expect(r.locks.framework.entries, "one entry per clause in the fixture, cited or not").to.have.length(5);
  });

  it("a SECOND build over the lock it produced asks nothing and changes nothing", () => {
    const first = build(docs, twoLocks(emptyLock(FRAMEWORK_POL_START)));
    const second = build(docs, first.locks);
    expect(second.asks, "this is the test that failed before `ordinal` was part of identity").to.deep.equal([]);
    expect(renderLock(second.locks.framework)).to.equal(renderLock(first.locks.framework));
  });

  it("five clauses in ONE section get five distinct numbers — none mistaken for a rewording of another", () => {
    const r = build(docs, twoLocks(emptyLock(FRAMEWORK_POL_START)));
    const pols = r.locks.framework.entries.map((e) => e.pol);
    expect(new Set(pols).size).to.equal(5);
    expect(r.locks.framework.entries.map((e) => e.ordinal).sort()).to.deep.equal([1, 2, 3, 4, 5]);
  });

  it("an EDITED clause asks, and carries the candidate so the caller can offer the command that answers it", () => {
    const first = build(docs, twoLocks(emptyLock(FRAMEWORK_POL_START)));
    const edited = docs.map((d) => doc(d.path, d.text.replace("It MUST commit nothing.", "It MUST commit absolutely nothing.")));
    const second = build(edited, first.locks);
    expect(second.asks).to.have.length(1);
    expect(second.asks[0]!.message).to.contain("reworded");
    expect(second.asks[0]!.candidate, "without this there is no command to print").to.match(/^POL-\d{3}/);
  });

  it("confirming it keeps the number and moves the old text into history", () => {
    const first = build(docs, twoLocks(emptyLock(FRAMEWORK_POL_START)));
    const edited = docs.map((d) => doc(d.path, d.text.replace("It MUST commit nothing.", "It MUST commit absolutely nothing.")));
    const pol = build(edited, first.locks).asks[0]!.candidate!;
    const confirmed = build(edited, first.locks, [pol]);
    expect(confirmed.asks).to.deep.equal([]);
    const entry = confirmed.locks.framework.entries.find((e) => e.pol === pol)!;
    expect(entry.history, "the sha that was approved must survive the rewording").to.have.length(1);
  });

  it("an ASK leaves the lock exactly as it was — a caller that ignores asks still cannot write a guess", () => {
    const first = build(docs, twoLocks(emptyLock(FRAMEWORK_POL_START)));
    const edited = docs.map((d) => doc(d.path, d.text.replace("It MUST commit nothing.", "Something else entirely MUST happen.")));
    const second = build(edited, first.locks);
    expect(second.asks.length).to.be.greaterThan(0);
    expect(renderLock(second.locks.framework)).to.equal(renderLock(first.locks.framework));
  });

  it("backfills the ordinal a legacy lock has none of, instead of asking once per clause", () => {
    const first = build(docs, twoLocks(emptyLock(FRAMEWORK_POL_START)));
    // A lock as the hand-seeding produced it: right shas, no ordinals.
    const legacy: PolLock = { start: first.locks.framework.start, entries: first.locks.framework.entries.map(({ ordinal: _drop, ...e }) => e) };
    const again = build(docs, twoLocks(legacy));
    expect(again.asks, "each confirmation used to shift the collision to the next clause").to.deep.equal([]);
    expect(again.locks.framework.entries.every((e) => e.ordinal !== undefined)).to.equal(true);
  });
});

describe("rules build — the framework's documents are read first", () => {
  it("orders framework before the organization, whatever order they arrive in", () => {
    const ordered = frameworkFirst([doc("policies/a.md", ""), doc("framework/policies/z.md", "")]);
    expect(ordered.map((d) => d.path)).to.deep.equal(["framework/policies/z.md", "policies/a.md"]);
  });
});

describe("rule-map.md — the audit index", () => {
  it("has one row per clause, with the class, and escapes a pipe so the table cannot break", () => {
    const r = build([doc("policies/p.md", "### 1.1 S\n\nA thing MUST hold | always. **(POL-201)**\n")], twoLocks(undefined, emptyLock(200)));
    const md = renderRuleMap(r.map);
    expect(md).to.contain("| POL-201 |");
    expect(md).to.contain("\\|");
    expect(md).to.contain("GENERATED by `gov rules build`");
  });
});

describe("the lock on disk", () => {
  it("a missing lock is an EMPTY lock, not an error — the first build in a workspace has nothing to read", () => {
    expect(parseLock(null, 174).lock).to.deep.equal({ start: 174, entries: [] });
  });

  it("a corrupt lock IS an error — allocating on top of numbers we cannot see is worse", () => {
    expect(parseLock("{ not json", 1).error).to.contain(LOCK_FILE);
  });

  it("refuses a write that would DROP an entry, whatever the caller intended", () => {
    const before: PolLock = { start: 5, entries: [{ pol: "POL-001", doc: "d", section: "1", clauseSha: "a" }] };
    const after: PolLock = { start: 5, entries: [] };
    expect(writeLock(before, after).error).to.contain("would drop POL-001");
  });

  it("refuses a start that moves backwards, which would re-issue numbers already handed out", () => {
    const before: PolLock = { start: 10, entries: [] };
    expect(writeLock(before, { start: 4, entries: [] }).error).to.contain("start would move backwards");
  });

  it("round-trips, sorted, so a diff shows the change and not a reshuffle", () => {
    const lock: PolLock = { start: 3, entries: [
      { pol: "POL-002", doc: "d", section: "2", clauseSha: "b" },
      { pol: "POL-001", doc: "d", section: "1", clauseSha: "a" },
    ] };
    const text = renderLock(lock);
    expect(text.indexOf("POL-001")).to.be.lessThan(text.indexOf("POL-002"));
    expect(parseLock(text, 1).lock!.entries.map((e) => e.pol)).to.deep.equal(["POL-001", "POL-002"]);
  });

  it("reads the interim YAML lock the framework already shipped, rather than discarding its numbers", () => {
    const yaml = 'start: 174\nentries:\n  - pol: "POL-001", doc: "framework/policies/framework-policy.md", section: "1.1", clauseSha: "abc1234", level: "C01"\n';
    const got = parseLegacyYamlLock(yaml);
    expect(got.lock!.start).to.equal(174);
    expect(got.lock!.entries[0]!.pol).to.equal("POL-001");
  });
});
