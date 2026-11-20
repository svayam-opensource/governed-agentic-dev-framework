// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// F127 G3 — ONE WEB EDIT, WRITTEN AS A POLICY PULL REQUEST THE GATE PASSES. Each case prepares a head from a base
// with applyPolicyEdit and judges it with the same gate the gov repo's CI runs.
import { expect } from "chai";
import yaml from "js-yaml";
import { applyPolicyEdit, writeStatementInto, judgePolicyPr, memTree, parseRuleStore, inForce, type PolicyEdit, type RuleRow } from "../../../src/rules/policy-pr/public.js";
import { sectionShas } from "../../../src/rules/checks/sections.js";

const DOC = "policies/org-policy.md";
const TODAY = "2026-11-20";
const PR = 120;
const POLICY = ["# Org policy", "", "## 3 Technology", "", "### 3.1 Approved", "", "Everyone uses only approved technologies.", "",
  "### 3.2 Secrets", "", "Nobody commits a secret.", ""].join("\n");
const sha = (text: string, s: string): string => sectionShas(text).get(s)!;
const row = (id: string, section: string, over: Partial<RuleRow> = {}): RuleRow => ({
  id, source: { doc: DOC, section, sha: sha(POLICY, section) }, expectation: `Everyone obeys ${section}.`,
  actor: ["everyone"], level: "C02", start: { version: "1.4.0", date: "2026-10-01", pr: 80 }, end: null, ...over,
});
const dump = (rows: readonly RuleRow[]): string => yaml.dump(JSON.parse(JSON.stringify(rows)), { lineWidth: -1 });

function baseFiles(rows: RuleRow[] = [row("GOV-SVM-001", "3.1"), row("GOV-SVM-002", "3.2")]): Record<string, string> {
  return {
    "org-config.yaml": 'org_slug: "SVM"\n',
    "framework/rules/rules.yaml": "[]\n",
    "framework/rules/checks-catalog.yaml": "resources: []\ntools: []\nactions: []\n",
    "policies/VERSION": "1.4.0\n",
    "policies/CHANGELOG.md": "# Policy changelog\n\n## 1.4.0 — 2026-10-01\n\nOlder entry.\n",
    [DOC]: POLICY,
    "policies/rules/rules.yaml": dump(rows),
  };
}

function run(edit: PolicyEdit, rows?: RuleRow[]) {
  const base = memTree(baseFiles(rows));
  const files = baseFiles(rows);
  const head = memTree(files);
  const r = applyPolicyEdit({ base, head, edit, today: TODAY, scope: "SVM", author: "alice", pr: PR });
  const j = judgePolicyPr({ base, head, pr: PR, today: TODAY });
  return { r, j, files, rows: parseRuleStore(files["policies/rules/rules.yaml"]!) };
}

describe("applyPolicyEdit — a web edit the policy PR gate passes (F127 G3)", () => {
  it("add: issues the next id, writes the statement into the section, and the gate passes as a minor", () => {
    const { r, j, files, rows } = run({ kind: "add", doc: DOC, section: "3.2", statement: "Staff must never share a password.", chapter: 6, level: "C02", actor: ["everyone"], expectation: "Everyone shares no password." });
    expect(r.ok, r.lines.join("\n")).to.equal(true);
    expect(r.id).to.equal("GOV-SVM-003");
    expect(r.needsDraft).to.equal(false);
    expect(files[DOC]).to.contain("Staff must never share a password.");
    expect(j.findings).to.deep.equal([]);
    expect(j).to.deep.include({ verdict: "pass", required: "minor", headVersion: "1.5.0" });
    const added = rows.find((x) => x.id === "GOV-SVM-003")!;
    expect(added).to.deep.include({ statement: "Staff must never share a password.", chapter: 6, start: { version: "1.5.0", date: TODAY, pr: PR } });
    // the other rule in §3.2 was refreshed in place, not revised
    expect(rows.filter((x) => x.id === "GOV-SVM-002")).to.have.length(1);
    expect(j.changes).to.deep.include({ added: ["GOV-SVM-003"], revised: [], retired: [] });
  });

  it("add without an expectation: the statement stands in, needsDraft is set, the gate still passes", () => {
    const { r, j, rows } = run({ kind: "add", doc: DOC, section: "3.3", sectionTitle: "Passwords", statement: "Staff must never share a password.", chapter: 6, level: "C02", actor: ["everyone"] });
    expect(r.needsDraft).to.equal(true);
    expect(rows.find((x) => x.id === "GOV-SVM-003")!.expectation).to.equal("Staff must never share a password.");
    expect(j.findings).to.deep.equal([]);
  });

  it("add with a later effective date: approved now, not in force until then", () => {
    const { j, rows } = run({ kind: "add", doc: DOC, section: "3.2", statement: "Staff must rotate keys.", chapter: 6, level: "C02", actor: ["everyone"], expectation: "Everyone rotates keys.", effectiveFrom: "2027-01-01" });
    expect(j.findings).to.deep.equal([]);
    const added = rows.find((x) => x.id === "GOV-SVM-003")!;
    expect(added.start).to.deep.equal({ version: "1.5.0", date: "2027-01-01", pr: PR });
    expect(inForce(rows, TODAY).map((x) => x.id)).to.not.include("GOV-SVM-003");
  });

  it("revise: closes the open row and opens its successor with the new statement; the prose is reworded", () => {
    const rows0 = [row("GOV-SVM-001", "3.1"), row("GOV-SVM-002", "3.2", { statement: "Nobody commits a secret." })];
    const { j, rows, files } = run({ kind: "revise", id: "GOV-SVM-002", statement: "Nobody may ever commit a secret.", expectation: "Everyone commits no secret, ever." }, rows0);
    expect(j.findings).to.deep.equal([]);
    expect(j.changes.revised).to.deep.equal(["GOV-SVM-002"]);
    expect(files[DOC]).to.contain("Nobody may ever commit a secret.").and.not.contain("Nobody commits a secret.");
    expect(rows.filter((x) => x.id === "GOV-SVM-002").map((x) => x.end === null)).to.deep.equal([false, true]);
  });

  it("close (Stop): the open row ends at the new version, today, this PR — retired, the gate passes", () => {
    const { j, rows } = run({ kind: "close", id: "GOV-SVM-001" });
    expect(j.findings).to.deep.equal([]);
    expect(j.changes.retired).to.deep.equal(["GOV-SVM-001"]);
    expect(rows.find((x) => x.id === "GOV-SVM-001")!.end).to.deep.equal({ version: "1.5.0", date: TODAY, pr: PR });
  });

  it("enforce-now: the future-dated row ends and the same rule opens starting today", () => {
    const rows0 = [row("GOV-SVM-001", "3.1"), row("GOV-SVM-002", "3.2", { start: { version: "1.4.0", date: "2027-03-01", pr: 80 } })];
    const { j, rows } = run({ kind: "enforce-now", id: "GOV-SVM-002" }, rows0);
    expect(j.findings).to.deep.equal([]);
    const chain = rows.filter((x) => x.id === "GOV-SVM-002");
    expect(chain.map((x) => [x.start.date, x.end?.date ?? null])).to.deep.equal([["2027-03-01", TODAY], [TODAY, null]]);
    expect(inForce(rows, TODAY).map((x) => x.id)).to.include("GOV-SVM-002");
  });

  it("enforce-now refuses a rule already in force", () => {
    expect(run({ kind: "enforce-now", id: "GOV-SVM-001" }).r).to.deep.include({ ok: false });
  });

  it("annotate: statement and chapter filled in place — a patch", () => {
    const { j } = run({ kind: "annotate", id: "GOV-SVM-001", statement: "Staff must use only approved technology.", chapter: 3 });
    expect(j.findings).to.deep.equal([]);
    expect(j).to.deep.include({ verdict: "pass", required: "patch" });
  });

  it("refuses an unknown id, a chapter outside 1-8 and an add outside policies/", () => {
    expect(run({ kind: "close", id: "GOV-SVM-099" }).r.ok).to.equal(false);
    expect(run({ kind: "annotate", id: "GOV-SVM-001", chapter: 9 as never }).r.ok).to.equal(false);
    expect(run({ kind: "add", doc: "framework/x.md", section: "1", statement: "x", chapter: 1, level: "C02", actor: ["everyone"] }).r.ok).to.equal(false);
  });

  it("is idempotent: the same edit run again on the prepared head writes nothing more", () => {
    const base = memTree(baseFiles());
    const files = baseFiles();
    const head = memTree(files);
    applyPolicyEdit({ base, head, edit: { kind: "close", id: "GOV-SVM-001" }, today: TODAY, scope: "SVM", author: "alice", pr: PR });
    const before = JSON.stringify(files);
    applyPolicyEdit({ base, head, edit: { kind: "annotate", id: "GOV-SVM-002" }, today: TODAY, scope: "SVM", author: "alice", pr: PR });
    expect(JSON.stringify(files)).to.equal(before);
  });

  it("writeStatementInto: appends to a section, rewords in place, creates a missing one in number order", () => {
    expect(writeStatementInto(POLICY, "3.1", "And more.")).to.contain("Everyone uses only approved technologies.\n\nAnd more.");
    expect(writeStatementInto(POLICY, "3.2", "Nobody ever.", "Nobody commits a secret.")).to.contain("Nobody ever.").and.not.contain("Nobody commits");
    const made = writeStatementInto(POLICY, "3.15", "New.", undefined, "Keys");
    expect(made).to.contain("### 3.15 Keys\n\nNew.");
  });
});
