// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `needs-subscription` (spec 02 X15 ruling). A binding to a DECLARED-PAID action (tool `gov-check`, or `paid: true`
// in the catalog) in an org without the paid module is captured, not run: its outcome folds like cannot-tell, is
// never a pass, its Class is "advisory (needs subscription)" — and it does not block, even under hard posture. The
// MIT runner's `tool: llm` branch stays cannot-tell. An unknown action that is not declared paid stays cannot-tell.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { classifyRow, parseCatalog, type Catalog, type CheckBinding } from "../../src/rules/model/catalog.js";
import type { RuleRow } from "../../src/rules/model/rule-row.js";
import type { EventContext, RuleSet } from "../../src/rules/model/contracts.js";
import { createCheckRunner, paidKey } from "../../src/rules/checks/runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = parseCatalog(readFileSync(resolve(here, "../../../../content/framework/rules/checks-catalog.yaml"), "utf8"));
const CATALOG: Catalog = {
  ...FRAMEWORK,
  tools: [...FRAMEWORK.tools, { id: "gov-check" }],
  actions: [
    ...FRAMEWORK.actions,
    { id: "gov-check/segregation", tool: "gov-check" },
    { id: "bash/paid-lint", tool: "bash", paid: true },
    { id: "llm/judge-design", tool: "llm" },
  ],
};
const row = (checks: CheckBinding[]): RuleRow => ({
  id: "GOV-ACME-090",
  source: { doc: "policies/org-policy.md", section: "3", sha: "a1b2c3" },
  expectation: "Author and approver differ.",
  actor: ["everyone"],
  level: "C02",
  checks,
  start: { version: "1.0.0", date: "2026-10-06" },
  end: null,
});
const bind = (action: string, on_miss: "fail" | "warn" = "fail"): CheckBinding => ({ on: { resource: "vcs.code-repo", event: "pull_request" }, action, on_miss });
const set = (checks: CheckBinding[]): RuleSet => ({ framework: [], org: [row(checks)], orgScope: "ACME", catalog: CATALOG, orgVersion: "1.0.0" });
const PR: EventContext = { resource: "vcs.code-repo", event: "pull_request", payload: { branch: "main", changed: [] } };
const run = (checks: CheckBinding[], extra: Parameters<typeof createCheckRunner>[0] extends infer D ? Partial<D> : never = {}) =>
  createCheckRunner({ rules: set(checks), readDefault: () => null, ...extra }).run("GOV-ACME-090", PR);

describe("needs-subscription (X15)", () => {
  it("a declared-paid action without the module → needs-subscription, never a pass", () => {
    for (const a of ["gov-check/segregation", "bash/paid-lint"]) {
      const v = run([bind(a)]);
      expect(v.verdict, a).to.equal("needs-subscription");
      expect(v.findings.join("\n")).to.match(/needs a subscription/);
    }
  });

  it("folds like cannot-tell: a real fail still fails; a cannot-tell outranks it; it outranks a pass", () => {
    expect(run([bind("gov-check/segregation"), bind("gov-builtin/no-such")]).verdict).to.equal("cannot-tell");
    expect(run([bind("gov-check/segregation"), bind("llm/judge-design")]).verdict).to.equal("cannot-tell");
  });

  it("the MIT runner's tool: llm branch stays cannot-tell (ruling X15)", () => {
    expect(run([bind("llm/judge-design")]).verdict).to.equal("cannot-tell");
  });

  it("an unknown action that is not declared paid stays cannot-tell", () => {
    expect(run([bind("gov-builtin/no-such")]).verdict).to.equal("cannot-tell");
  });

  it("with the module, its outcome is used — and an observe-only judgement never moves the verdict", () => {
    const paid = new Map([[paidKey("GOV-ACME-090", "gov-check/segregation"), { verdict: "fail" as const, findings: ["author approved own change"] }]]);
    expect(run([bind("gov-check/segregation")], { paidOutcomes: paid }).verdict).to.equal("fail");
    const judged = new Map([[paidKey("GOV-ACME-090", "llm/judge-design"), { verdict: "fail" as const, findings: ["design looks risky"], observeOnly: true }]]);
    const v = run([bind("llm/judge-design")], { paidOutcomes: judged });
    expect(v.verdict).to.equal("pass");
    expect(v.findings.join("\n")).to.contain("observe-only");
  });

  it("reports each binding's own outcome (one evidence record per binding)", () => {
    const v = run([bind("gov-check/segregation"), bind("llm/judge-design")]);
    expect(v.bindings).to.deep.equal([
      { action: "gov-check/segregation", verdict: "needs-subscription" },
      { action: "llm/judge-design", verdict: "cannot-tell" },
    ]);
  });

  it("Class: every live binding paid and no module → advisory (needs subscription); with the module → as before", () => {
    const r = row([bind("gov-check/segregation")]);
    expect(classifyRow(r, CATALOG)).to.equal("advisory (needs subscription)");
    expect(classifyRow(r, CATALOG, "soft", { paidModule: true })).to.equal("detected");
    expect(classifyRow(row([bind("gov-check/segregation"), bind("gov-builtin/list-membership")]), CATALOG)).to.not.equal("advisory (needs subscription)");
  });
});
