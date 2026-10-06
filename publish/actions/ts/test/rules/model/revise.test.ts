// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// W1 — OPENING AND CLOSING REVISIONS (rule-model-design.md Q5, Q17). The proposer (W4) decides keep / revise /
// retire / add; this is the code that turns those verdicts into rows, so the append-only history and the id
// issuance are one implementation rather than one per caller.
import { expect } from "chai";
import { applyVerdicts } from "../../../src/rules/model/revise.js";
import { createIdIssuer } from "../../../src/rules/model/store-io.js";
import { validateRuleStore, inForce, type RuleRow, type Stamp } from "../../../src/rules/model/rule-row.js";

const base = (id: string, over: Partial<RuleRow> = {}): RuleRow => ({
  id,
  source: { doc: "policies/org-policy.md", section: "3.1", sha: "a1b2c3" },
  expectation: "Everyone uses only approved technologies.",
  actor: ["everyone"],
  level: "C02",
  start: { version: "1.4.0", date: "2026-10-01", pr: 80 },
  end: null,
  ...over,
});
const body = (expectation: string) => ({
  source: { doc: "policies/org-policy.md", section: "3.1", sha: "d4e5f6" },
  expectation, actor: ["everyone"] as const, level: "C02" as const,
});
const AT: Stamp = { version: "1.5.0", date: "2026-10-06", pr: 91 };

describe("rule model — W1 revisions", () => {
  const store = [base("GOV-SVM-001"), base("GOV-SVM-002"), base("GOV-SVM-003", { end: { version: "1.4.0", date: "2026-10-01" }, start: { version: "1.0.0", date: "2026-01-01" } })];

  it("keep changes nothing; revise closes the open row and opens its successor at the SAME version", () => {
    const r = applyVerdicts(store, [{ kind: "keep", id: "GOV-SVM-001" }, { kind: "revise", id: "GOV-SVM-002", row: body("Everyone uses only listed technologies.") }], AT, createIdIssuer([]), "SVM");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.rows).to.have.length(4);
    expect(r.rows[1]!.end).to.deep.equal(AT);
    expect(r.rows[3]).to.deep.include({ id: "GOV-SVM-002", expectation: "Everyone uses only listed technologies.", start: AT, end: null });
    expect(validateRuleStore(r.rows, { scope: "SVM" }), "the chain meets").to.deep.equal([]);
    expect(store[1]!.end, "the input is not mutated").to.equal(null);
  });

  it("retire closes with no successor; the id stays in the store", () => {
    const r = applyVerdicts(store, [{ kind: "retire", id: "GOV-SVM-001" }], AT, createIdIssuer([]), "SVM");
    expect(r.ok && inForce(r.rows).map((x) => x.id)).to.deep.equal(["GOV-SVM-002"]);
    expect(r.ok && r.rows.filter((x) => x.id === "GOV-SVM-001")).to.have.length(1);
  });

  it("add gets an id from gov's issuer — past every id ever issued, the retired GOV-SVM-003 included", () => {
    const ids = store.map((x) => x.id);
    const r = applyVerdicts(store, [{ kind: "add", row: body("A") }, { kind: "add", row: body("B") }], AT, createIdIssuer(ids), "SVM");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.issued).to.deep.equal(["GOV-SVM-004", "GOV-SVM-005"]);
    expect(r.rows.slice(3).map((x) => [x.id, x.start, x.end])).to.deep.equal([["GOV-SVM-004", AT, null], ["GOV-SVM-005", AT, null]]);
  });

  it("a verdict on an id that is not in force refuses the WHOLE batch — no half-applied proposal", () => {
    const r = applyVerdicts(store, [{ kind: "retire", id: "GOV-SVM-001" }, { kind: "revise", id: "GOV-SVM-003", row: body("x") }, { kind: "keep", id: "GOV-SVM-404" }], AT, createIdIssuer([]), "SVM");
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.problems).to.have.length(2);
  });

  it("two verdicts on one id are refused — keep-and-retire has no meaning", () => {
    const r = applyVerdicts(store, [{ kind: "keep", id: "GOV-SVM-001" }, { kind: "retire", id: "GOV-SVM-001" }], AT, createIdIssuer([]), "SVM");
    expect(r.ok).to.equal(false);
  });
});
