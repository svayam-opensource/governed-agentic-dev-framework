// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ROWS `gov doctor` PRINTS ABOUT THE RULES.
 *
 * They exist because a Policy Owner cannot tell, by reading their own policy, how much of it is enforced — the
 * document reads as though every clause binds equally. In this framework's own policy, 3 of 107 rules are
 * checked, 8 are resident in an agent's context, and 92 are enforced by nothing. What these tests hold is that
 * each row says something a person can act on, and that the two rows about governance being TRUE (a stale build,
 * a stale cue) fail rather than warn.
 */
import { expect } from "chai";
import { rulesRows, approxTokens, type RulesFacts } from "../../src/maintain/rules-health.js";
import type { MappedClause, EnforcementClass } from "../../src/rules/rules-build.js";
import type { Diagnostic } from "../../src/rules/notation.js";

/**
 * A mapped clause. `level` takes the string "none" rather than `undefined`, because passing `undefined` to a
 * parameter WITH A DEFAULT silently uses the default — so `clause("ungoverned", undefined)` produced a C01
 * clause, and the test asserting "no rules at all" was quietly testing the opposite.
 */
const clause = (klass: EnforcementClass, level: "C01" | "C02" | "C03" | "none" = "C01"): MappedClause =>
  ({ pol: "POL-001", doc: "policies/p.md", section: "1.1", ...(level === "none" ? {} : { level }), klass, gist: "x" });

const facts = (over: Partial<RulesFacts> = {}): RulesFacts => ({
  map: [clause("checked"), clause("cued"), clause("implemented"), clause("advisory")],
  diagnostics: [],
  stale: [],
  residentChars: 4000,
  ...over,
});

const row = (rows: readonly { name: string; status: string; detail: string }[], name: string) =>
  rows.find((r) => r.name === name);

describe("doctor — the rules rows", () => {
  it("says nothing at all when doctor gathered nothing", () => {
    expect(rulesRows(undefined)).to.deep.equal([]);
  });

  it("names how many rules there are and what holds each up", () => {
    const r = row(rulesRows(facts()), "rules")!;
    expect(r.detail).to.contain("4 rules");
    expect(r.detail).to.contain("1 checked").and.contain("1 cued").and.contain("1 implemented").and.contain("1 advisory");
    expect(r.status).to.equal("ok");
  });

  it("WARNS when most rules are enforced by nothing — that is the finding, not an incidental", () => {
    const mostly = facts({ map: [clause("checked"), clause("advisory"), clause("advisory"), clause("advisory")] });
    const r = row(rulesRows(mostly), "rules")!;
    expect(r.status).to.equal("warn");
    expect(r.detail, "and it says so in words a person can act on").to.contain("enforced by nothing");
  });

  it("warns when a policy states no rules at all, and says what makes one", () => {
    const none = facts({ map: [clause("ungoverned", "none")] });
    const r = row(rulesRows(none), "rules")!;
    expect(r.status).to.equal("warn");
    expect(r.detail).to.contain("MUST");
  });

  it("reports the resident cost against the budget, because a cue is paid for on every turn", () => {
    expect(row(rulesRows(facts({ residentChars: 4000 })), "resident rules")!.detail).to.contain("~1000 tokens");
    const over = row(rulesRows(facts({ residentChars: 12000 })), "resident rules")!;
    expect(over.status).to.equal("warn");
    expect(over.detail).to.contain("belongs in the policy");
  });

  it("a stale generated file FAILS — the policy and what agents carry disagree, and the agent is acting", () => {
    const r = row(rulesRows(facts({ stale: ["agent/harness/CLAUDE.md", "agent/harness/AGENTS.md"] })), "rules build")!;
    expect(r.status).to.equal("fail");
    expect(r.detail).to.contain("gov rules build");
    expect(r.detail).to.contain("CLAUDE.md");
  });

  it("a stale CUE fails too, and names the way out", () => {
    const d: Diagnostic = { kind: "stale-cue", doc: "policies/p.md", section: "1.1", line: 9, message: "…" };
    const r = row(rulesRows(facts({ diagnostics: [d] })), "cues")!;
    expect(r.status).to.equal("fail");
    expect(r.detail).to.contain("told the old text");
    expect(r.detail).to.contain("--restamp");
  });

  it("an unnamed actor WARNS and explains what it costs, rather than reading as a style nit", () => {
    const d: Diagnostic = { kind: "actor-unnamed", doc: "policies/p.md", section: "1.1", line: 3, message: "…" };
    const r = row(rulesRows(facts({ diagnostics: [d] })), "clause actors")!;
    expect(r.status).to.equal("warn");
    expect(r.detail).to.contain("under-reports");
  });

  it("counts tokens approximately on purpose — the number is for watching growth", () => {
    expect(approxTokens(4000)).to.equal(1000);
    expect(approxTokens(0)).to.equal(0);
  });
});
