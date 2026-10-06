// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// KNOWLEDGE FRONT MATTER IS THE ORGANIZATION'S CHOICE (Policy Owner, 2026-10-06; rule-model-design.md "front
// matter" row). The framework mandates nothing about it. An org that wants it checked says so in its own policy,
// and `gov rules propose` binds that clause to `gov-builtin/frontmatter-required` with the org's fields and allowed
// values as params. These tests pin both halves: a bound rule checks EXACTLY what the org listed, and with no rule
// bound nothing is checked at all.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { parseCatalog, type Catalog, type CheckBinding } from "../../../src/rules/model/catalog.js";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";
import type { RuleSet, EventContext } from "../../../src/rules/model/contracts.js";
import { validateParams } from "../../../src/rules/checks/params.js";
import { createCheckRunner } from "../../../src/rules/checks/runner.js";
import type { ChangedFile } from "../../../src/rules/diff-check.js";
import type { WorkspaceView } from "../../../src/rules/verb-gate.js";
import { runSuite } from "../../../src/governance/suite.js";
import type { Fs } from "../../../src/lifecycle/fs-io.js";

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG: Catalog = parseCatalog(readFileSync(resolve(here, "../../../../../content/framework/rules/catalog.yaml"), "utf8"));
const ACTION = "gov-builtin/frontmatter-required";

/** The org's choice, as propose would extract it from a kept §4: three fields with value lists, owner any value. */
const ORG_PARAMS = {
  paths: ["knowledge/**/*.md"],
  exclude: ["**/README.md"],
  fields: { domain: ["support", "legal"], layer: ["spec", "mandate"], status: ["current", "draft"], owner: null },
};

const row = (checks: CheckBinding[]): RuleRow => ({
  id: "GOV-SVM-101",
  source: { doc: "policies/knowledge-organization-standard.md", section: "4", sha: "a1b2c3" },
  expectation: "Everyone opens every knowledge document with the organization's front matter.",
  actor: ["everyone"],
  level: "C02",
  checks,
  start: { version: "1.0.0", date: "2026-10-06" },
  end: null,
});
const ruleset = (org: RuleRow[]): RuleSet => ({ framework: [], org, orgScope: "SVM", catalog: CATALOG, orgVersion: "1.0.0" });
const bound = (w: Record<string, unknown>, resource = "vcs.gov-repo", event = "pull_request"): RuleSet =>
  ruleset([row([{ on: { resource, event }, action: ACTION, with: w, on_miss: "fail" }])]);
const file = (path: string, text: string): ChangedFile => ({ path, status: "added", addedLines: text.split("\n"), text });
const pr = (changed: ChangedFile[]): EventContext => ({ resource: "vcs.gov-repo", event: "pull_request", payload: { changed } });
const fm = (o: Record<string, string>): string => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n# Doc\n`;
const run = (rules: RuleSet, ctx: EventContext) => createCheckRunner({ rules, readDefault: () => null }).run("GOV-SVM-101", ctx);

const GOOD = fm({ domain: "support", layer: "spec", status: "current", owner: "support-owner" });

describe("frontmatter-required — the org's fields and values, as params", () => {
  it("the catalog's params schema accepts paths, exclude and fields (keys no longer required)", () => {
    const schema = CATALOG.actions.find((a) => a.id === ACTION)?.params;
    expect(validateParams(schema, ORG_PARAMS)).to.deep.equal([]);
    expect(validateParams(schema, { when: "**/*.md", keys: ["owner"] }), "the old keys= form still fits").to.deep.equal([]);
  });

  it("a document carrying the org's fields with allowed values passes", () => {
    expect(run(bound(ORG_PARAMS), pr([file("knowledge/support/specs/a.md", GOOD)])).verdict).to.equal("pass");
  });

  it("a value outside the org's list is a miss that names the field and the allowed values", () => {
    const v = run(bound(ORG_PARAMS), pr([file("knowledge/support/specs/a.md", GOOD.replace("domain: support", "domain: testing"))]));
    expect(v.verdict).to.equal("fail");
    expect(v.findings.join("\n")).to.match(/domain='testing'/).and.to.match(/support, legal/);
  });

  it("a field with no value list means present, any value: missing fails, any value passes", () => {
    const missing = run(bound(ORG_PARAMS), pr([file("knowledge/support/a.md", GOOD.replace("owner: support-owner\n", ""))]));
    expect(missing.verdict).to.equal("fail");
    expect(missing.findings.join()).to.match(/owner/);
    expect(run(bound(ORG_PARAMS), pr([file("knowledge/support/a.md", GOOD.replace("support-owner", "anybody at all"))])).verdict).to.equal("pass");
  });

  it("checks exactly what the org listed: a field it did not list is never judged", () => {
    // `compliance` was the framework's old fifth field. The org above did not list it, so it is neither required
    // nor restricted — a doc without it passes, and a doc with a value the old set refused passes too.
    const v = run(bound(ORG_PARAMS), pr([file("knowledge/support/a.md", `${GOOD.replace("---\n# Doc", "compliance: whatever\n---\n# Doc")}`)]));
    expect(v.verdict, v.findings.join()).to.equal("pass");
  });

  it("a quoted value is compared unquoted", () => {
    expect(run(bound(ORG_PARAMS), pr([file("knowledge/x.md", GOOD.replace("domain: support", 'domain: "support"'))])).verdict).to.equal("pass");
  });

  it("no front matter at all is a miss naming every listed field", () => {
    const v = run(bound(ORG_PARAMS), pr([file("knowledge/x.md", "# no front matter\n")]));
    expect(v.verdict).to.equal("fail");
    expect(v.findings.join()).to.match(/domain/).and.to.match(/owner/);
  });

  it("exclude and paths narrow what is judged", () => {
    const changed = [file("knowledge/support/README.md", "# index\n"), file("docs/other.md", "# outside the paths\n")];
    expect(run(bound(ORG_PARAMS), pr(changed)).verdict).to.equal("pass");
  });

  it("runs at a gov verb against the workspace, with the same params", () => {
    const files: Record<string, string> = { "knowledge/a.md": GOOD.replace("layer: spec", "layer: pattern"), "knowledge/README.md": "# index\n" };
    const ws: WorkspaceView = { exists: (p) => p in files, read: (p) => files[p] ?? null, paths: () => Object.keys(files) };
    const ctx: EventContext = { resource: "gov.verb", event: "close", payload: { workspace: ws } };
    const v = run(bound(ORG_PARAMS, "gov.verb", "close"), ctx);
    expect(v.verdict).to.equal("fail");
    expect(v.findings.join()).to.match(/knowledge\/a\.md/).and.to.match(/layer='pattern'/);
  });

  it("a fields value that is not a list (or empty for any value) is cannot-tell, never a pass", () => {
    const v = run(bound({ paths: ["knowledge/**"], fields: { domain: 7 } }), pr([file("knowledge/a.md", GOOD)]));
    expect(v.verdict).to.equal("cannot-tell");
  });
});

describe("frontmatter-required — with no rule bound, nothing is checked", () => {
  it("the runner checks nothing for a rule that binds no front-matter check", () => {
    const v = run(ruleset([row([])]), pr([file("knowledge/x.md", "# no front matter\n")]));
    expect(v.verdict).to.equal("cannot-tell");
    expect(v.findings.join()).to.match(/binds no check/);
  });

  it("gov validate's built-in suite judges no knowledge front matter — org tree or project tree", () => {
    const files: Record<string, string> = {
      "knowledge/README.md": "# Knowledge\n\n- [a](support/a.md)\n",
      "knowledge/support/a.md": "# A doc with no front matter at all\n",
      "knowledge/support/b.md": `${fm({ domain: "not-a-framework-domain", layer: "whatever" })}\n[a](a.md)\n`,
      "projects/PRJ-1-x/knowledge/notes.md": "# no front matter\n",
    };
    const all = new Set<string>(["/repo/knowledge", "/repo/knowledge/support", "/repo/projects"]);
    for (const k of Object.keys(files)) all.add(`/repo/${k}`);
    const nodeFs: Fs = {
      pathExists: (p) => all.has(p.replace(/\\/g, "/")),
      readFile: (p) => files[p.replace(/\\/g, "/").replace(/^\/repo\//, "")] ?? null,
      mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [],
    };
    const r = runSuite({ fs: nodeFs, repoRoot: "/repo", files: Object.keys(files) });
    const fmFailures = r.failures.filter((f) => /front.?matter/i.test(f));
    expect(fmFailures, fmFailures.join("\n")).to.deep.equal([]);
  });
});
