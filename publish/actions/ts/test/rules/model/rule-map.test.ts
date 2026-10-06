// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE RULE MAP (rule-model-design.md Q5, Q8, Q15, Q22): the one generated view over both stores — every revision of
// every rule, its owner, its cue and checks, and the class that holds it up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import { renderRuleMap, summariseRuleSet, RULE_CLASS_LEGEND } from "../../../src/rules/model/rule-map.js";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";
import type { Catalog } from "../../../src/rules/model/catalog.js";
import type { RuleSet } from "../../../src/rules/model/contracts.js";

const catalog: Catalog = {
  resources: [
    { id: "vcs.code-repo", renderer: "github-actions", events: [{ name: "pull_request", mode: "gate" }, { name: "push", mode: "observe" }] },
    { id: "pms.issue", events: [{ name: "closed", mode: "observe" }] }, // no renderer: nothing can listen
  ],
  tools: [{ id: "gov-builtin" }, { id: "llm" }],
  actions: [{ id: "gov-builtin/list-membership", tool: "gov-builtin" }, { id: "llm/judge", tool: "llm" }],
};

const gate = { on: { resource: "vcs.code-repo", event: "pull_request" }, action: "gov-builtin/list-membership", on_miss: "fail" as const };
const observe = { on: { resource: "vcs.code-repo", event: "push" }, action: "gov-builtin/list-membership", on_miss: "warn" as const };
const judge = { on: { resource: "vcs.code-repo", event: "push" }, action: "llm/judge", on_miss: "warn" as const };
const deaf = { on: { resource: "pms.issue", event: "closed" }, action: "gov-builtin/list-membership", on_miss: "fail" as const };

const row = (id: string, over: Partial<RuleRow> = {}): RuleRow => ({
  id,
  source: id.startsWith("GOV-FRM-")
    ? { doc: "framework/docs/specs/framework-specification.md", section: "2.1", sha: "f00" }
    : { doc: "policies/org-policy.md", section: "3.1", sha: "a1b" },
  expectation: `Expectation of ${id}.`,
  actor: ["agent"],
  level: "C02",
  start: { version: "1.0.0", date: "2026-01-01", pr: 1 },
  end: null,
  ...over,
});

const set = (framework: RuleRow[], org: RuleRow[]): RuleSet => ({ framework, org, orgScope: "SVM", catalog, orgVersion: "1.4.0" });
const tableRows = (md: string): string[] => md.split("\n").filter((l) => l.startsWith("| GOV-"));
const cells = (line: string): string[] => line.slice(2, -2).split(/ (?<!\\)\| /);

describe("rule map — the merged view (rule-model-design.md Q8)", () => {
  it("has the Policy Owner's columns, in order", () => {
    const md = renderRuleMap(set([], []));
    expect(md).to.include(
      "| Gov Rule | Document | Document Type | Section | Owner | Level | Expectation | Actor | Cue | Check | Class | Start | End |",
    );
  });

  it("puts framework rows first, then by id numerically, then by start version", () => {
    const md = renderRuleMap(set(
      [row("GOV-FRM-010"), row("GOV-FRM-002")],
      [
        row("GOV-SVM-100"),
        row("GOV-SVM-009", { start: { version: "1.2.0", date: "2026-03-01", pr: 9 } }),
        row("GOV-SVM-009", { start: { version: "1.0.0", date: "2026-01-01", pr: 3 }, end: { version: "1.2.0", date: "2026-03-01", pr: 9 } }),
      ],
    ));
    expect(tableRows(md).map((l) => `${cells(l)[0]}@${cells(l)[11]}`)).to.deep.equal([
      "GOV-FRM-002@1.0.0 (2026-01-01) #1",
      "GOV-FRM-010@1.0.0 (2026-01-01) #1",
      "GOV-SVM-009@1.0.0 (2026-01-01) #3",
      "GOV-SVM-009@1.2.0 (2026-03-01) #9",
      "GOV-SVM-100@1.0.0 (2026-01-01) #1",
    ]);
  });

  it("derives Owner and Document Type from the id: FRM → Specification/framework, org → Policy/organization", () => {
    const [f, o] = tableRows(renderRuleMap(set([row("GOV-FRM-001")], [row("GOV-SVM-001")]))).map(cells);
    expect([f[1], f[2], f[3], f[4]]).to.deep.equal(["framework/docs/specs/framework-specification.md", "Specification", "§2.1", "framework"]);
    expect([o[1], o[2], o[3], o[4]]).to.deep.equal(["policies/org-policy.md", "Policy", "§3.1", "organization"]);
  });

  it("shows one row per revision; Start/End as `version (date) #PR`; End empty while in force", () => {
    const md = renderRuleMap(set([
      row("GOV-FRM-001", { start: { version: "2.2.4", date: "2026-05-01" }, end: { version: "2.2.6", date: "2026-07-01", pr: 40 } }),
      row("GOV-FRM-001", { start: { version: "2.2.6", date: "2026-07-01", pr: 40 }, expectation: "Revised." }),
    ], []));
    const [a, b] = tableRows(md).map(cells);
    expect([a[11], a[12]]).to.deep.equal(["2.2.4 (2026-05-01)", "2.2.6 (2026-07-01) #40"]);
    expect([b[6], b[11], b[12]]).to.deep.equal(["Revised.", "2.2.6 (2026-07-01) #40", ""]);
  });

  it("renders the cue as tier + first ~60 chars, and each check as `resource·event → action` joined by <br>", () => {
    const long = "TECHNOLOGY CHOICES ARE NOT YOURS. Check approved-technologies.md before adding any dependency.";
    const [c] = tableRows(renderRuleMap(set([], [row("GOV-SVM-001", { cue: { tier: "on-demand", text: long }, checks: [gate, observe] })]))).map(cells);
    expect(c[8]).to.equal(`on-demand: ${long.slice(0, 60)}…`);
    expect(c[9]).to.equal("vcs.code-repo·pull_request → gov-builtin/list-membership<br>vcs.code-repo·push → gov-builtin/list-membership");
    const [short] = tableRows(renderRuleMap(set([], [row("GOV-SVM-001", { cue: { tier: "resident", text: "Stop." } })]))).map(cells);
    expect(short[8]).to.equal("resident: Stop.");
    expect(short[9]).to.equal("");
  });

  it("escapes | and flattens newlines in every cell, so a row stays one table row", () => {
    const md = renderRuleMap(set([], [row("GOV-SVM-001", { expectation: "Agent uses a | b\nand c.", cue: { tier: "on-demand", text: "x | y" } })]));
    const lines = tableRows(md);
    expect(lines).to.have.lengthOf(1);
    expect(lines[0]).to.include("Agent uses a \\| b and c.");
    expect(lines[0]).to.include("on-demand: x \\| y");
    expect(cells(lines[0])).to.have.lengthOf(13);
  });

  it("classifies each revision via classifyRow — closed ones too", () => {
    const md = renderRuleMap(set([], [
      row("GOV-SVM-001", { checks: [observe], end: { version: "1.2.0", date: "2026-03-01", pr: 9 } }),
      row("GOV-SVM-001", { checks: [gate], start: { version: "1.2.0", date: "2026-03-01", pr: 9 } }),
    ]));
    expect(tableRows(md).map((l) => cells(l)[10])).to.deep.equal(["detected", "prevented"]);
  });

  it("is byte-stable: the same set renders the same bytes regardless of input order", () => {
    const rows = [row("GOV-SVM-003"), row("GOV-SVM-001"), row("GOV-SVM-002")];
    expect(renderRuleMap(set([], rows))).to.equal(renderRuleMap(set([], [...rows].reverse())));
    expect(renderRuleMap(set([], rows)).endsWith("\n")).to.equal(true);
  });

  it("opens with a GENERATED do-not-edit comment", () => {
    expect(renderRuleMap(set([], [])).split("\n")[0]).to.match(/^<!-- GENERATED .*do not edit.* -->$/);
  });
});

describe("rule map — legend and counts", () => {
  it("the legend lists EVERY RuleClass — fails when catalog.ts gains a class the legend lacks", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../src/rules/model/catalog.ts", import.meta.url)), "utf8");
    const decl = /export type RuleClass\s*=([^;]+);/.exec(src);
    expect(decl, "RuleClass declaration not found in catalog.ts").to.not.equal(null);
    const declared = [...decl![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(Object.keys(RULE_CLASS_LEGEND).sort()).to.deep.equal(declared);
    const md = renderRuleMap(set([], []));
    for (const [k, meaning] of Object.entries(RULE_CLASS_LEGEND)) expect(md).to.include(`**${k}** — ${meaning}`);
  });

  it("every class classifyRow can produce appears in the legend", () => {
    const rs = set([], [
      row("GOV-SVM-001", { checks: [gate] }),
      row("GOV-SVM-002", { checks: [observe] }),
      row("GOV-SVM-003", { checks: [judge] }),
      row("GOV-SVM-004", { cue: { tier: "on-demand", text: "x" } }),
      row("GOV-SVM-005"),
      row("GOV-SVM-006", { checks: [deaf] }),
    ]);
    const counts = summariseRuleSet(rs);
    expect(counts).to.deep.equal({ prevented: 1, detected: 1, judged: 1, cued: 1, advisory: 1, "cannot-tell": 1 });
    for (const k of Object.keys(counts)) expect(RULE_CLASS_LEGEND).to.have.property(k);
  });

  it("counts IN-FORCE rows only — closed revisions and retired rules do not count", () => {
    const rs = set(
      [row("GOV-FRM-001", { checks: [gate] })],
      [
        row("GOV-SVM-001", { checks: [gate], end: { version: "1.2.0", date: "2026-03-01", pr: 9 } }), // superseded
        row("GOV-SVM-001", { start: { version: "1.2.0", date: "2026-03-01", pr: 9 } }), // in force: advisory
        row("GOV-SVM-002", { checks: [observe], end: { version: "1.3.0", date: "2026-04-01", pr: 12 } }), // retired
      ],
    );
    expect(summariseRuleSet(rs)).to.deep.equal({ prevented: 1, detected: 0, judged: 0, cued: 0, advisory: 1, "cannot-tell": 0 });
    const md = renderRuleMap(rs);
    expect(md).to.include("In force: 2 rules — prevented 1 · detected 0 · judged 0 · cued 0 · advisory 1 · cannot-tell 0.");
    expect(tableRows(md)).to.have.lengthOf(4);
  });
});
