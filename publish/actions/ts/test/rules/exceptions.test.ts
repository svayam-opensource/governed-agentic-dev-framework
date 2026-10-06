// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * APPROVED EXCEPTIONS REACHING THE AGENT.
 *
 * The case these exist for: a cue says "not on the approved list? STOP and ask", the organization approves an
 * exception for one repository, and the agent stops anyway because nobody told it. The work halts for no reason
 * and people learn that cues are obstacles to be talked around — which is worse than having no cue.
 *
 * The other half is expiry. An expiry field nobody checks is a permanent exemption with a date printed on it, so
 * these tests hold that a lapsed exception simply stops being compiled, and that an unparseable date is refused
 * rather than read as "not yet expired".
 */
import { expect } from "chai";
import { parseException, applies, exceptionLines, lapsed, exceptionRefusal, type Exception, type ExceptionRules } from "../../src/rules/exceptions.js";
import type { RuleRow, Level } from "../../src/rules/model/rule-row.js";

const doc = (fm: string, path = "policies/exceptions/policy/EX-14.md") =>
  ({ path, text: `---\n${fm}\n---\n\n# Exception\n\nprose\n` });

const GOOD = [
  "id: EX-14",
  "clause: POL-210",
  "expires: 2026-12-31",
  "approved_by: policy-owner",
  "scope: 910-GOV-CICD",
  "reason: redis for the job queue",
].join("\n");

const ex = (over: Partial<Exception> = {}): Exception => ({
  path: "p", id: "EX-1", clause: "POL-210", expires: "2026-12-31", approvedBy: "policy-owner",
  scope: [], why: "a documented deviation", ...over,
});

describe("exceptions — reading one", () => {
  it("reads the four facts that make it citable", () => {
    const { exception } = parseException(doc(GOOD));
    expect(exception!.id).to.equal("EX-14");
    expect(exception!.clause).to.equal("POL-210");
    expect(exception!.expires).to.equal("2026-12-31");
    expect(exception!.approvedBy).to.equal("policy-owner");
    expect(exception!.scope).to.deep.equal(["910-GOV-CICD"]);
  });

  it("reads a GOV id as the clause (W2 contradiction 4: the regex accepted only POL numbers)", () => {
    const { exception } = parseException(doc(GOOD.replace(/^clause: .*$/m, "clause: GOV-SVM-012")));
    expect(exception!.clause).to.equal("GOV-SVM-012");
  });

  it("falls back to the file name for an id, because a citable name matters more than a field", () => {
    const { exception } = parseException(doc(GOOD.replace("id: EX-14\n", "")));
    expect(exception!.id).to.equal("EX-14");
  });

  it("refuses one with no front matter — its terms cannot be prose", () => {
    const { problem } = parseException({ path: "p.md", text: "# Exception\n\nWe decided it was fine.\n" });
    expect(problem!.why).to.contain("no front matter");
  });

  it("names every missing field at once, rather than one per run", () => {
    const { problem } = parseException(doc("id: EX-9"));
    expect(problem!.why).to.contain("clause").and.contain("expires").and.contain("approved_by");
  });

  it("REFUSES a date it cannot read, because an unreadable expiry never lapses", () => {
    // `Date.parse("soon")` is NaN and every comparison against it is false, so "soon" would read as "not yet
    // expired" — a permanent exemption produced by a typo.
    const { problem } = parseException(doc(GOOD.replace("2026-12-31", "soon")));
    expect(problem!.why).to.contain("not a date gov can read");
  });
});

describe("exceptions — when one is in force", () => {
  it("is in force before it expires and gone after, with no other action", () => {
    expect(applies(ex(), "2026-06-01")).to.equal(true);
    expect(applies(ex(), "2027-01-01"), "lapsed, so the rule speaks again").to.equal(false);
  });

  it("an exception naming no scope covers the organization", () => {
    expect(applies(ex({ scope: [] }), "2026-06-01", "PRJ-7-billing")).to.equal(true);
  });

  it("a scoped exception covers only what it names", () => {
    const scoped = ex({ scope: ["910-GOV-CICD"] });
    expect(applies(scoped, "2026-06-01", "910-GOV-CICD")).to.equal(true);
    expect(applies(scoped, "2026-06-01", "PRJ-7-billing"), "another project is not covered").to.equal(false);
  });

  it("lists what has lapsed, because the clause it suspended is in force again", () => {
    const old = ex({ id: "EX-2", expires: "2026-01-01" });
    expect(lapsed([ex(), old], "2026-06-01").map((e) => e.id)).to.deep.equal(["EX-2"]);
  });
});

describe("exceptions — what the agent is told", () => {
  it("names the clause, the permission, the scope, the date and the approver — all four or none", () => {
    const line = exceptionLines([ex({ id: "EX-14", scope: ["910-GOV-CICD"], why: "redis for the job queue" })], "2026-06-01").join("\n");
    expect(line).to.contain("POL-210");
    expect(line).to.contain("EXCEPTION EX-14");
    expect(line).to.contain("redis for the job queue");
    expect(line).to.contain("910-GOV-CICD");
    expect(line).to.contain("until 2026-12-31");
    expect(line).to.contain("approved: policy-owner");
  });

  it("says nothing at all when nothing is in force — silence is the normal state", () => {
    expect(exceptionLines([], "2026-06-01")).to.deep.equal([]);
    expect(exceptionLines([ex({ expires: "2026-01-01" })], "2026-06-01"), "a lapsed one is not mentioned").to.deep.equal([]);
  });

  it("explains that a lapse needs no action, which is the part people get wrong", () => {
    const out = exceptionLines([ex()], "2026-06-01").join("\n");
    expect(out).to.contain("the rule speaks again");
  });
});

// ── what cannot be excepted (spec §10.5) ───────────────────────────────────────────────────────────────────────

const orgRow = (id: string, level: Level, end: RuleRow["end"] = null): RuleRow => ({
  id, source: { doc: "policies/org-policy.md", section: "2.1", sha: "abc1234" },
  expectation: `Everyone does what ${id} asks.`, actor: ["everyone"], level,
  start: { version: "0.1.0", date: "2026-10-06" }, end,
});
const RULES: ExceptionRules = {
  framework: [{ ...orgRow("GOV-FRM-040", "C01"), source: { doc: "framework/docs/specs/framework-specification.md", section: "7.1", sha: "abc1234" } }],
  org: [
    orgRow("GOV-SVM-210", "C02"),
    orgRow("GOV-SVM-011", "C01"),
    orgRow("GOV-SVM-300", "C03"),
    orgRow("GOV-SVM-400", "C02", { version: "0.2.0", date: "2026-10-07" }),   // retired
  ],
};
const naming = (clause: string) => doc(GOOD.replace(/^clause: .*$/m, `clause: ${clause}`));

describe("exceptions — what cannot be excepted (spec §10.5)", () => {
  it("GOV-FRM-465: refuses an exception that names a framework rule, and says to report it upstream instead", () => {
    // With no rule set too: the id alone says it is the framework's, so no caller can skip the refusal.
    for (const rules of [undefined, RULES]) {
      const { exception, problem } = parseException(naming("GOV-FRM-040"), rules);
      expect(exception, "never compiled into the resident rules").to.equal(undefined);
      expect(problem!.why).to.contain("framework rule").and.contain("admit no exception").and.contain("upstream");
    }
  });

  it("GOV-FRM-465: the refusal holds for a framework rule the store does not even carry", () => {
    expect(exceptionRefusal("GOV-FRM-999", RULES)).to.contain("framework rule");
  });

  it("GOV-FRM-011: refuses an exception that names a C01 organization rule — nobody, the Policy Owner included, can grant one", () => {
    const { exception, problem } = parseException(naming("GOV-SVM-011"), RULES);
    expect(exception).to.equal(undefined);
    expect(problem!.why).to.contain("C01 rule").and.contain("not even the Policy Owner").and.contain("policy pull request");
  });

  it("accepts an exception that names an in-force C02 organization rule", () => {
    const { exception, problem } = parseException(naming("GOV-SVM-210"), RULES);
    expect(problem).to.equal(undefined);
    expect(exception!.clause).to.equal("GOV-SVM-210");
  });

  it("refuses one naming a C03 rule, a retired rule, a rule nobody wrote, or an old POL number it cannot judge", () => {
    expect(exceptionRefusal("GOV-SVM-300", RULES)).to.contain("Only C02 rules have an exception route");
    expect(exceptionRefusal("GOV-SVM-400", RULES), "retired").to.contain("not a rule in force");
    expect(exceptionRefusal("GOV-SVM-777", RULES)).to.contain("not a rule in force");
    expect(exceptionRefusal("POL-210", RULES)).to.contain("gov rules show POL-210");
  });

  it("without the rules, an org id cannot be judged and is read as before", () => {
    expect(exceptionRefusal("GOV-SVM-011")).to.equal(null);
    expect(exceptionRefusal("POL-210")).to.equal(null);
  });
});
