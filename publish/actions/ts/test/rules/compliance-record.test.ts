// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE TWO HALVES OF `compliance.md`.
 *
 * The file is unreliable today because the whole of it is hand-written: the half that is verifiable is also the
 * half nobody enjoys writing, so it is the half that goes missing. gov can derive that half from its own run log.
 *
 * The property everything depends on: regenerating the derived half can NEVER touch what a person wrote. If it
 * could, nobody would let gov near the file and we would be back to hand-writing both halves.
 */
import { expect } from "chai";
import {
  renderDerived, judgedTemplate, composeCompliance, DERIVED_BEGIN, DERIVED_END, type ComplianceEvent,
} from "../../src/rules/compliance-record.js";

const ev = (over: Partial<ComplianceEvent> = {}): ComplianceEvent =>
  ({ at: "2026-09-28T10:00:00Z", kind: "refused", what: "close blocked: knowledge/ does not exist", command: "close", ...over });

describe("compliance — the half gov derives", () => {
  it("groups by what happened, because the question is 'was anything refused?' not 'what happened at 14:02'", () => {
    const out = renderDerived([
      ev(),
      ev({ kind: "check-failed", pol: "POL-210", what: "`redis` is not on the approved list" }),
    ]);
    expect(out).to.contain("### Refusals gov issued");
    expect(out).to.contain("### Checks that failed and were fixed");
    expect(out).to.contain("POL-210");
  });

  it("says None explicitly — an absent section reads as 'nobody looked'", () => {
    const out = renderDerived([]);
    expect(out).to.contain("None. gov refused nothing in this project.");
  });

  it("keeps the timestamp and the command on each line, for the reader who wants the sequence", () => {
    expect(renderDerived([ev()])).to.contain("`2026-09-28T10:00:00Z`").and.contain("`gov close`");
  });
});

describe("compliance — the half a person writes", () => {
  it("offers headings and what belongs under each, and invents no content", () => {
    const t = judgedTemplate();
    expect(t).to.contain("### C01 events").and.contain("### C02 exceptions exercised").and.contain("### C03 deviations");
    expect(t, "it says what gov cannot do, so the division is visible").to.contain("gov cannot write this half");
  });
});

describe("compliance — composing the two", () => {
  it("creates both halves when there is no file", () => {
    const out = composeCompliance(null, [ev()]);
    expect(out).to.contain(DERIVED_BEGIN).and.contain(DERIVED_END);
    expect(out).to.contain("### C01 events");
  });

  it("GOV-FRM-463 replaces ONLY the fence, leaving a person's prose exactly as it was", () => {
    const first = composeCompliance(null, [ev()]);
    const edited = first.replace("### C01 events\n", "### C01 events\n\nWe caught a leaked token in review on the 12th.\n");
    const again = composeCompliance(edited, [ev({ what: "merge blocked: unmerged sub-branches" })]);
    expect(again, "the human sentence survives regeneration").to.contain("We caught a leaked token in review on the 12th.");
    expect(again).to.contain("unmerged sub-branches");
    expect(again, "and the old derived line is gone, not duplicated").to.not.contain("knowledge/ does not exist");
  });

  it("is IDEMPOTENT — it runs on every close, and a file that grew each time would be its own defect", () => {
    const once = composeCompliance(null, [ev()]);
    const twice = composeCompliance(once, [ev()]);
    expect(twice).to.equal(once);
  });

  it("GOV-FRM-463 a hand-written file with no fence keeps every word, with the derived half on top", () => {
    // Guessing where the generated section "should" go inside somebody's prose is the one way to lose it.
    const theirs = "# Compliance\n\nWe had one C02 exception, EX-3, for the legacy queue.\n";
    const out = composeCompliance(theirs, [ev()]);
    expect(out).to.contain("We had one C02 exception, EX-3, for the legacy queue.");
    expect(out.indexOf(DERIVED_BEGIN)).to.be.lessThan(out.indexOf("EX-3"));
  });
});
