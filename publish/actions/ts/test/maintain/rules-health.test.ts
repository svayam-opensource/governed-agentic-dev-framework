// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ROWS `gov doctor` PRINTS ABOUT THE RULES — from the rule stores, by the rule map's own class derivation.
 *
 * They exist because a Policy Owner cannot tell, by reading their own policy, how much of it is enforced. What
 * these tests hold is that each row says something a person can act on, and that the row about governance being
 * TRUE (a stale generated file, a store in error) fails rather than warns.
 */
import { expect } from "chai";
import { rulesRows, approxTokens, type RulesFacts } from "../../src/maintain/rules-health.js";

const counts = (over: Partial<RulesFacts["counts"]> = {}): RulesFacts["counts"] =>
  ({ prevented: 1, detected: 1, judged: 0, cued: 1, advisory: 1, "cannot-tell": 0, ...over });

const facts = (over: Partial<RulesFacts> = {}): RulesFacts => ({
  counts: counts(), resident: 3, residentChars: 4000, staleFiles: [], staleRows: [], errors: [], ...over,
});

const row = (rows: readonly { name: string; status: string; detail: string }[], name: string) =>
  rows.find((r) => r.name === name);

describe("doctor — the rules rows", () => {
  it("says nothing at all when doctor gathered nothing", () => {
    expect(rulesRows(undefined)).to.deep.equal([]);
  });

  it("names how many rules are in force and the class of each — the rule map's six", () => {
    const r = row(rulesRows(facts()), "rules")!;
    expect(r.detail).to.contain("4 rules");
    expect(r.detail).to.contain("1 prevented").and.contain("1 detected").and.contain("1 cued").and.contain("1 advisory")
      .and.contain("0 judged").and.contain("0 cannot-tell");
    expect(r.status).to.equal("ok");
  });

  it("WARNS when most rules are verified by nothing — that is the finding, not an incidental", () => {
    const r = row(rulesRows(facts({ counts: counts({ prevented: 0, detected: 1, advisory: 3 }) })), "rules")!;
    expect(r.status).to.equal("warn");
    expect(r.detail, "and it says so in words a person can act on").to.contain("verified by nothing");
  });

  it("warns when no rule is in force at all", () => {
    const zero = counts({ prevented: 0, detected: 0, cued: 0, advisory: 0 });
    expect(row(rulesRows(facts({ counts: zero })), "rules")!.status).to.equal("warn");
  });

  it("states the resident cost in tokens, and warns past the budget", () => {
    expect(row(rulesRows(facts()), "resident rules")!.detail).to.contain("3 cue(s), ~1000 tokens");
    expect(row(rulesRows(facts({ residentChars: 20000 })), "resident rules")!.status).to.equal("warn");
  });

  it("FAILS on a stale generated file — the agent is acting on rules the branch no longer says", () => {
    const r = row(rulesRows(facts({ staleFiles: ["agent/harness/CLAUDE.md"] })), "rules build")!;
    expect(r.status).to.equal("fail");
    expect(r.detail).to.contain("gov rules build");
  });

  it("names rows pending re-review — a source section changed since approval", () => {
    const r = row(rulesRows(facts({ staleRows: ["GOV-SVM-210"] })), "rule rows")!;
    expect(r.status).to.equal("warn");
    expect(r.detail).to.contain("GOV-SVM-210").and.contain("gov rules propose");
  });

  it("FAILS on errors in the rule stores", () => {
    expect(row(rulesRows(facts({ errors: ["org GOV-SVM-1 bad"] })), "rule stores")!.status).to.equal("fail");
  });

  it("approximates tokens at four characters each", () => {
    expect(approxTokens(4000)).to.equal(1000);
  });
});
