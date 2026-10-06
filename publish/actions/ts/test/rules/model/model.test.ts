// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE P1 CONTRACTS of the rule model (rule-model-design.md, 2026-10-06): the id grammar and issuer, the rule row
// and its revision history, the catalog, and the class a row falls in. Every parallel workstream builds on these,
// so what they accept and refuse is pinned here before any of them starts.
import { expect } from "chai";
import { parseGovId, issueId, FRAMEWORK_SCOPE } from "../../../src/rules/model/gov-id.js";
import { parseRuleStore, validateRuleStore, inForce, type RuleRow } from "../../../src/rules/model/rule-row.js";
import { parseCatalog, validateBindings, classifyRow, type Catalog } from "../../../src/rules/model/catalog.js";

const row = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: "GOV-SVM-012",
  source: { doc: "policies/org-policy.md", section: "3.1", sha: "a1b2c3" },
  expectation: "Everyone MUST use only technologies listed in approved-technologies.md.",
  actor: ["everyone"],
  level: "C02",
  start: { version: "1.4.0", date: "2026-10-06", pr: 87 },
  end: null,
  ...over,
});
const org = { scope: "SVM" };
const kinds = (rows: RuleRow[], store = org) => validateRuleStore(rows, store).map((d) => d.kind);

describe("rule model — GOV ids", () => {
  it("parses GOV-FRM-061 and GOV-<slug>-NNN; refuses anything else", () => {
    expect(parseGovId("GOV-FRM-061")).to.deep.equal({ scope: "FRM", n: 61 });
    expect(parseGovId("GOV-SVM-1203")).to.deep.equal({ scope: "SVM", n: 1203 });
    for (const bad of ["POL-012", "GOV-SVM-12", "GOV-svm-012", "GOV-TOOLONG1-001", "GOV-S-001"]) expect(parseGovId(bad)).to.equal(null);
  });

  it("issues the next number after the highest EVER issued in the scope — a retired number is never reused", () => {
    expect(issueId(["GOV-SVM-001", "GOV-SVM-007", "GOV-FRM-900"], "SVM")).to.equal("GOV-SVM-008");
    expect(issueId([], "SVM")).to.equal("GOV-SVM-001");
    expect(issueId(["GOV-FRM-099"], FRAMEWORK_SCOPE)).to.equal("GOV-FRM-100");
  });

  it("refuses to issue in a malformed scope (keeping FRM from an org is gov setup's guard, W1)", () => {
    expect(() => issueId([], "frm")).to.throw(/scope/);
    expect(() => issueId([], "TOOLONGX")).to.throw(/scope/);
  });
});

describe("rule model — the store and its revision history", () => {
  it("parses YAML rows", () => {
    const rows = parseRuleStore(`
- id: GOV-SVM-012
  source: { doc: policies/org-policy.md, section: "3.1", sha: a1b2c3 }
  expectation: Everyone MUST use only approved technologies.
  actor: [everyone]
  level: C02
  start: { version: 1.4.0, date: 2026-10-06, pr: 87 }
  end: null
`);
    expect(rows).to.have.lengthOf(1);
    expect(rows[0].start).to.deep.equal({ version: "1.4.0", date: "2026-10-06", pr: 87 });
  });

  it("a valid single row has no diagnostics", () => {
    expect(validateRuleStore([row()], org)).to.deep.equal([]);
  });

  it("an id from another scope is refused — the framework's numbers and an org's never mix", () => {
    expect(kinds([row({ id: "GOV-FRM-012" })])).to.include("wrong-scope");
    expect(kinds([row()], { scope: FRAMEWORK_SCOPE })).to.include("wrong-scope");
  });

  it("an org id issued under a FORMER slug stays valid after a rename — ids are frozen at issue (Q7)", () => {
    expect(validateRuleStore([row({ id: "GOV-OLD-003" })], org)).to.deep.equal([]);
  });

  it("a revision chain must hand over at one version: the old row ends where the new one starts", () => {
    const old = row({ end: { version: "1.4.0", date: "2026-10-06", pr: 87 }, start: { version: "1.2.0", date: "2026-08-01", pr: 40 } });
    expect(validateRuleStore([old, row()], org)).to.deep.equal([]);
    const gap = row({ start: { version: "1.5.0", date: "2026-10-09", pr: 90 } });
    expect(kinds([old, gap])).to.include("broken-chain");
  });

  it("at most one row of an id is in force, and it is the latest", () => {
    expect(kinds([row(), row()])).to.include("two-in-force");
  });

  it("retired = the last row closed with no successor — valid, and not in force", () => {
    const retired = row({ end: { version: "1.5.0", date: "2026-10-09", pr: 90 } });
    expect(validateRuleStore([retired], org)).to.deep.equal([]);
    expect(inForce([retired])).to.deep.equal([]);
  });

  it("only the framework makes promises about gov: actor gov-client is refused in an org store", () => {
    expect(kinds([row({ actor: ["gov-client"] })])).to.include("gov-client-in-org");
    expect(validateRuleStore([row({ id: "GOV-FRM-061", actor: ["gov-client"], level: "C01" })], { scope: FRAMEWORK_SCOPE })).to.deep.equal([]);
  });

  it("a framework rule is C01 or C03 — C02's exception route does not exist for it (W2-Q1)", () => {
    const frm = (level: "C01" | "C02" | "C03") => validateRuleStore([row({ id: "GOV-FRM-117", actor: ["agent"], level })], { scope: FRAMEWORK_SCOPE }).map((d) => d.kind);
    expect(frm("C02")).to.include("c02-in-framework");
    expect(frm("C01")).to.deep.equal([]);
    expect(frm("C03")).to.deep.equal([]);
    expect(kinds([row({ level: "C02" })])).to.not.include("c02-in-framework"); // an org rule may be C02
  });

  it("`everyone` already means agent and human — it combines only with gov-client (W2-Q10)", () => {
    expect(kinds([row({ actor: ["everyone", "agent"] })])).to.include("bad-actor");
    expect(validateRuleStore([row({ id: "GOV-FRM-466", actor: ["gov-client", "everyone"], level: "C01" })], { scope: FRAMEWORK_SCOPE })).to.deep.equal([]);
    expect(kinds([row({ actor: [] })])).to.include("bad-actor");
  });

  it("a resident cue is only for a C01 rule an agent must follow (Q19)", () => {
    expect(kinds([row({ cue: { tier: "resident", text: "x" } })])).to.include("resident-cue-not-c01");
    expect(kinds([row({ level: "C01", actor: ["human"], cue: { tier: "resident", text: "x" } })])).to.include("resident-cue-no-agent");
    expect(validateRuleStore([row({ level: "C01", cue: { tier: "resident", text: "x" } })], org)).to.deep.equal([]);
  });

  it("level, dates and the source section are checked", () => {
    expect(kinds([row({ level: "C04" as never })])).to.include("bad-level");
    expect(kinds([row({ start: { version: "1.4", date: "06-10-2026" } })])).to.include("bad-stamp");
    expect(kinds([row({ source: { doc: "", section: "3.1", sha: "x" } })])).to.include("bad-source");
  });
});

const CATALOG: Catalog = parseCatalog(`
resources:
  - id: vcs.code-repo
    renderer: github-actions
    events:
      - { name: pull_request, mode: gate }
      - { name: push, mode: observe }
  - id: pms.project
    events:
      - { name: item_moved, mode: observe }
tools:
  - { id: gov-builtin }
  - { id: llm }
actions:
  - { id: gov-builtin/list-membership, tool: gov-builtin }
  - { id: llm/judge, tool: llm }
`);
const check = (resource: string, event: string, action: string) => ({ on: { resource, event }, action, on_miss: "fail" as const });

// Orchestrator, 2026-10-06 (PROTECT's gap): a pull-request gate blocks only where branch protection is installed —
// hard posture. Under soft (the default, W2-Q6) the same check runs and reports, so the honest class is `detected`.
// A gov-verb gate is gov refusing, and a framework-repo gate runs in the framework's own protected CI: both prevent
// whatever the organization's posture.
describe("rule model — the class follows the posture", () => {
  const CAT: Catalog = parseCatalog(`
resources:
  - { id: vcs.gov-repo, renderer: github-actions, events: [{ name: pull_request, mode: gate }] }
  - { id: vcs.framework-repo, renderer: github-actions, events: [{ name: pull_request, mode: gate }] }
  - { id: gov.verb, renderer: gov-verb, events: [{ name: close, mode: gate }] }
tools: [{ id: gov-builtin }]
actions: [{ id: gov-builtin/x, tool: gov-builtin }]
`);
  const on = (resource: string, event: string) => row({ checks: [{ on: { resource, event }, action: "gov-builtin/x", on_miss: "fail" }] });

  it("a pull-request gate is prevented under hard, detected under soft, and soft when no posture is given", () => {
    expect(classifyRow(on("vcs.gov-repo", "pull_request"), CAT, "hard")).to.equal("prevented");
    expect(classifyRow(on("vcs.gov-repo", "pull_request"), CAT, "soft")).to.equal("detected");
    expect(classifyRow(on("vcs.gov-repo", "pull_request"), CAT)).to.equal("detected");
  });

  it("a gov-verb gate and a framework-repo gate prevent under either posture", () => {
    for (const p of ["hard", "soft"] as const) {
      expect(classifyRow(on("gov.verb", "close"), CAT, p)).to.equal("prevented");
      expect(classifyRow(on("vcs.framework-repo", "pull_request"), CAT, p)).to.equal("prevented");
    }
  });
});

describe("rule model — catalog, bindings and class", () => {
  it("a binding must name a resource, an event of it, and an action the catalog has", () => {
    const r = row({ checks: [check("vcs.nope", "pull_request", "gov-builtin/list-membership"), check("vcs.code-repo", "merge", "x/y")] });
    expect(validateBindings(r, CATALOG).map((d) => d.kind)).to.include.members(["unknown-resource", "unknown-event", "unknown-action"]);
  });

  it("an LLM judge never gates: an llm action bound to a gate event is refused (Q22)", () => {
    expect(validateBindings(row({ checks: [check("vcs.code-repo", "pull_request", "llm/judge")] }), CATALOG).map((d) => d.kind)).to.include("llm-on-gate");
  });

  it("class: prevented > detected > judged > cued > advisory, and cannot-tell when nothing can listen", () => {
    expect(classifyRow(row({ checks: [check("vcs.code-repo", "pull_request", "gov-builtin/list-membership")] }), CATALOG, "hard")).to.equal("prevented");
    expect(classifyRow(row({ checks: [check("vcs.code-repo", "push", "gov-builtin/list-membership")] }), CATALOG)).to.equal("detected");
    expect(classifyRow(row({ checks: [check("vcs.code-repo", "push", "llm/judge")] }), CATALOG)).to.equal("judged");
    expect(classifyRow(row({ cue: { tier: "on-demand", text: "x" } }), CATALOG)).to.equal("cued");
    expect(classifyRow(row(), CATALOG)).to.equal("advisory");
    expect(classifyRow(row({ checks: [check("pms.project", "item_moved", "gov-builtin/list-membership")] }), CATALOG)).to.equal("cannot-tell");
  });
});
