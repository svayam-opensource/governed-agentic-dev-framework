// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE REQUIRED CHECKS `gov repo protect` DERIVES FROM THE RULES — and the tie to the renderer.
 *
 * A required status check is matched BY NAME. If gov required `GOV-FRM-455 · pull_request` and the workflow reported
 * `GOV-FRM-455 (pull_request)`, every pull request would wait for ever on a check that never arrives. So the names are
 * derived through the renderer's own `checkRunName`, and this file renders the real workflow from the shipped rules
 * and reads the job names back out of it: the two cannot drift without a test failing.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { requiredRuleChecks, repoResource } from "../../src/maintain/rule-checks.js";
import { renderWorkflow } from "../../src/rules/checks/render-github.js";
import { parseCatalog, type CheckBinding } from "../../src/rules/model/catalog.js";
import { inForce, parseRuleStore, type RuleRow } from "../../src/rules/model/rule-row.js";
import { RULE_STORE_PATHS } from "../../src/rules/model/store-io.js";
import type { RuleSet } from "../../src/rules/model/contracts.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const read = (rel: string): string => readFileSync(path.join(CONTENT, rel), "utf8");

function shipped(org: readonly RuleRow[] = []): RuleSet {
  return {
    framework: parseRuleStore(read(RULE_STORE_PATHS.frameworkRules)),
    org,
    orgScope: "ACME",
    catalog: parseCatalog(read(RULE_STORE_PATHS.frameworkCatalog)),
    orgVersion: "1.0.0",
  };
}

/** The names of the jobs the rendered workflow runs on a pull request — what GitHub shows as check runs. */
function renderedPullRequestJobs(set: RuleSet, resource: string): string[] {
  const bindings: { id: string; check: CheckBinding }[] = [];
  for (const row of inForce([...set.framework, ...set.org])) {
    for (const check of row.checks ?? []) if (check.on.resource === resource) bindings.push({ id: row.id, check });
  }
  const files = renderWorkflow(bindings, { defaultBranch: "main" });
  if (!files.length) return [];
  const doc = yaml.load(files[0]!.text) as { jobs: Record<string, { name: string; if: string }> };
  return Object.values(doc.jobs).filter((j) => /github\.event_name == 'pull_request'/.test(j.if)).map((j) => j.name).sort();
}

describe("gov-work — the required checks a hard posture derives from the rules", () => {
  it("the governance repo: one per GATE binding on pull_request, named exactly as the shipped workflow names its jobs", () => {
    const set = shipped();
    const derived = requiredRuleChecks(set, "governance").map((c) => c.name);
    expect(derived).to.deep.equal(renderedPullRequestJobs(set, repoResource("governance")));
    // PINNED: the current framework rules. A new gate binding changes this list on purpose, and the reviewer sees it.
    expect(derived).to.deep.equal(["GOV-FRM-455 · pull_request", "GOV-FRM-467 · pull_request", "GOV-FRM-468 · pull_request"]);
  });

  it("a code repo: the framework binds no gate on vcs.code-repo, so nothing is derived — and the renderer agrees", () => {
    const set = shipped();
    expect(requiredRuleChecks(set, "code")).to.deep.equal([]);
    expect(renderedPullRequestJobs(set, repoResource("code"))).to.deep.equal([]);
  });

  it("an org rule's gate on a code repo is required there, and only there; an observe binding never is", () => {
    const org = parseRuleStore([
      "- id: ACME-COD-001",
      '  source: { doc: policies/x.md, section: "1", sha: "abc1234" }',
      '  expectation: "Every pull request passes the build."',
      "  actor: [everyone]",
      "  level: C01",
      "  checks:",
      "    - on: { resource: vcs.code-repo, event: pull_request }",
      "      action: gov-builtin/test-suite",
      "      on_miss: fail",
      "    - on: { resource: vcs.code-repo, event: push }",
      "      action: gov-builtin/test-suite",
      "      on_miss: fail",
      '  start: { version: "1.0.0", date: "2026-10-06" }',
      "  end: null",
    ].join("\n"));
    const set = shipped(org);
    expect(requiredRuleChecks(set, "code")).to.deep.equal([{ id: "ACME-COD-001", name: "ACME-COD-001 · pull_request" }]);
    expect(requiredRuleChecks(set, "code").map((c) => c.name)).to.deep.equal(renderedPullRequestJobs(set, "vcs.code-repo"));
    expect(requiredRuleChecks(set, "governance").map((c) => c.id)).to.not.include("ACME-COD-001");
  });

  it("a rule that has ENDED is not required — its job is no longer rendered", () => {
    const set = shipped();
    const ended = { ...set, framework: set.framework.map((r) => (r.id === "GOV-FRM-455" ? { ...r, end: { version: "1.2.4", date: "2026-10-07" } } : r)) } as RuleSet;
    expect(requiredRuleChecks(ended, "governance").map((c) => c.id)).to.not.include("GOV-FRM-455");
  });
});
