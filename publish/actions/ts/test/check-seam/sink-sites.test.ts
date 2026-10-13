// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// EVERY SITE EMITS ITS RECORD (spec 02 §3.1, §5). gov produces the records; the module (when installed) signs and
// writes them. A check run emits one `check` record per binding it judged, a gov-verb gate one `gate` record per
// binding, and a governed session one `session` record at start and one at end. Every record, once finalised with
// the org's numeric id, is valid gov-evidence/1.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { checkCommand, type CheckVerbConfig, type CheckVerbDeps } from "../../src/cli/check-verb.js";
import { runBoundChecks } from "../../src/rules/checks/local-gate.js";
import { parseCatalog, type Catalog } from "../../src/rules/model/catalog.js";
import type { RuleSet } from "../../src/rules/model/contracts.js";
import { evidenceDrafts, resetEvidence, withSessionEvidence } from "../../src/check-seam/evidence.js";
import { finalizeRecord } from "../../src/check-seam/record.js";
import { validate } from "../../src/check-seam/validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(here, "../../../../content");
const ORG_ROW = [
  "- id: GOV-ACME-090",
  "  source: { doc: policies/org-policy.md, section: \"4\", sha: abc1234 }",
  "  expectation: Author and approver differ.",
  "  actor: [everyone]",
  "  level: C02",
  "  checks:",
  "    - { on: { resource: vcs.code-repo, event: pull_request }, action: gov-check/segregation, on_miss: fail }",
  "    - { on: { resource: gov.verb, event: close }, action: gov-check/segregation, on_miss: fail }",
  "  start: { version: 1.0.0, date: \"2026-10-06\" }",
  "  end: null",
  "",
].join("\n");
const DEFAULT: Record<string, string> = {
  "org-config.yaml": 'org_slug: "ACME"\n',
  "policies/governance.yaml": 'policy_owner:\n  github: "@polly"\n',
  "framework/rules/rules.yaml": readFileSync(resolve(CONTENT, "framework/rules/rules.yaml"), "utf8"),
  "framework/rules/checks-catalog.yaml": readFileSync(resolve(CONTENT, "framework/rules/checks-catalog.yaml"), "utf8"),
  "policies/org-policy.md": "## 4 Segregation\n\nAuthor and approver differ.\n",
  "policies/VERSION": "1.0.0\n",
  "policies/rules/rules.yaml": ORG_ROW,
  "policies/rules/checks-catalog.yaml": "resources: []\ntools: [{ id: gov-check }]\nactions:\n  - { id: gov-check/segregation, tool: gov-check, reviewed: { by: chuck, pr: 3 } }\n",
};
const git = (files: Record<string, string>) => (_repo: string, args: readonly string[]): string | null => {
  if (args[0] === "rev-parse") return args.includes("origin/main") ? "abc" : null;
  if (args[0] === "ls-tree") {
    const want = args.slice(args.indexOf("--") + 1);
    return Object.keys(files).filter((f) => want.some((p) => f === p || f.startsWith(`${p}/`))).join("\n");
  }
  if (args[0] === "show" && args[1]?.startsWith("origin/main:")) return files[args[1].slice("origin/main:".length)] ?? null;
  return null;
};
const CFG: CheckVerbConfig = { home: "/gov", defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "acme-gov", posture: "hard" };
const CI_ENV = {
  GITHUB_RUN_ID: "9123", GITHUB_RUN_ATTEMPT: "1", GITHUB_REPOSITORY: "acme/app", GITHUB_REPOSITORY_ID: "77",
  GITHUB_REPOSITORY_OWNER_ID: "123456", GITHUB_SHA: "a".repeat(40), GITHUB_ACTOR: "dev1", GITHUB_REF_NAME: "BRNCH-12-x",
};
const deps = (env: Record<string, string> = CI_ENV): CheckVerbDeps => ({
  git: git(DEFAULT), gh: () => null, env, readFile: () => null, writeFile: () => undefined,
});
const ARGS = { resource: "vcs.code-repo", event: "pull_request", "repo-dir": process.cwd() };

describe("evidence sink sites (spec 02 §3.1)", () => {
  beforeEach(() => resetEvidence());

  it("gov check run → one `check` record per judged binding, valid once finalised", () => {
    const r = checkCommand(["run", "GOV-ACME-090"], ARGS, deps(), CFG);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const drafts = evidenceDrafts();
    expect(drafts).to.have.length(1);
    const rec = finalizeRecord(drafts[0]!, 123456);
    expect(rec.kind).to.equal("check");
    expect(rec).to.include({ source: "ci", verdict: "needs-subscription", class: "advisory (needs subscription)" });
    expect(rec.runKey).to.equal("gh:9123:1:GOV-ACME-090:pull_request:gov-check/segregation");
    expect(validate("gov-evidence-1", rec)).to.deep.equal([]);
  });

  it("a gov-verb gate → one `gate` record per binding", () => {
    const catalog: Catalog = parseCatalog(DEFAULT["framework/rules/checks-catalog.yaml"]!);
    const rules: RuleSet = {
      framework: [], orgScope: "ACME", orgVersion: "1.0.0",
      catalog: { ...catalog, tools: [...catalog.tools, { id: "gov-check" }], actions: [...catalog.actions, { id: "gov-check/segregation", tool: "gov-check" }] },
      org: [{ id: "GOV-ACME-090", source: { doc: "policies/org-policy.md", section: "4", sha: "abc1234" }, expectation: "x", actor: ["everyone"], level: "C02",
        checks: [{ on: { resource: "gov.verb", event: "close" }, action: "gov-check/segregation", on_miss: "fail" }], start: { version: "1.0.0", date: "2026-10-06" }, end: null }],
    };
    runBoundChecks(rules, { resource: "gov.verb", event: "close" }, {}, () => null);
    const drafts = evidenceDrafts();
    expect(drafts.map((d) => d.kind)).to.deep.equal(["gate"]);
    const rec = finalizeRecord(drafts[0]!, 123456);
    expect(rec.source).to.equal("local");
    expect(validate("gov-evidence-1", rec)).to.deep.equal([]);
  });

  it("a governed session → `session` start and end records around the agent", async () => {
    let ran = false;
    const launch = withSessionEvidence(async () => { ran = true; return 0; }, { project: "PRJ-121", issue: 186, agent: "claude-code", env: {} });
    expect(await launch()).to.equal(0);
    expect(ran).to.equal(true);
    const drafts = evidenceDrafts();
    expect(drafts.map((d) => [d.kind, (d as { boundary?: string }).boundary])).to.deep.equal([["session", "start"], ["session", "end"]]);
    for (const d of drafts) expect(validate("gov-evidence-1", finalizeRecord(d, 1))).to.deep.equal([]);
  });
});
