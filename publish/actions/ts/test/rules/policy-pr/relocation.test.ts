// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// PRJ-121 intent 01, spec §3.5 — THE T8 RELOCATION EXEMPTION. A row may change in place only in source.doc,
// source.section, source.sha and path-valued `with:` params, when a declared move or a specification split explains
// the change and the cited section reads the same, heading aside. Pure cases first, then the policy PR gate.
import { expect } from "chai";
import yaml from "js-yaml";
import {
  isRelocation, declaredRelocations, readDocFrom, relocatedSection, SPEC_SPLITS, SPEC_BEFORE_SPLIT, SPEC_BUILD,
  type Relocation, type ReadDoc,
} from "../../../src/rules/policy-pr/relocation.js";
import { judgePolicyPr } from "../../../src/rules/policy-pr/gate.js";
import { policyPrWriter } from "../../../src/rules/policy-pr/write.js";
import { memTree } from "../../../src/rules/policy-pr/tree.js";
import { sectionShas } from "../../../src/rules/checks/sections.js";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";

const OLD = "policies/technology.md";
const NEW = "policies/build/technology.md";
const TEXT = ["# Technology", "", "## 3 Choosing", "", "### 3.1 Approved", "", "Everyone uses only approved technologies.", ""].join("\n");
const sha = (text: string, section: string): string => sectionShas(text).get(section)!;
const MOVE: Relocation = { from: OLD, to: NEW };

const row = (over: Partial<RuleRow> = {}, source: Partial<RuleRow["source"]> = {}): RuleRow => ({
  id: "GOV-SVM-010",
  source: { doc: OLD, section: "3.1", sha: sha(TEXT, "3.1"), ...source },
  expectation: "Everyone uses only approved technologies.",
  actor: ["everyone"],
  level: "C02",
  start: { version: "1.4.0", date: "2026-10-01", pr: 80 },
  end: null,
  ...over,
});
const docs = (was: Record<string, string>, now: Record<string, string>): ReadDoc =>
  (p, side) => (side === "was" ? was : now)[p] ?? null;
const moved = docs({ [OLD]: TEXT }, { [NEW]: TEXT });

describe("PRJ-121 §3.5 isRelocation — the T8 relocation exemption", () => {
  it("accepts a row whose document moved under a declared move, body unchanged", () => {
    expect(isRelocation(row(), row({}, { doc: NEW }), [MOVE], moved)).to.equal(true);
  });

  it("accepts a directory move: every file under it is carried", () => {
    const dir: Relocation = { from: "policies/", to: "policies/build/" };
    expect(isRelocation(row(), row({}, { doc: NEW }), [dir], moved)).to.equal(true);
  });

  it("refuses a body change: the section's text must be the same", () => {
    const edited = TEXT.replace("only approved", "mostly approved");
    const read = docs({ [OLD]: TEXT }, { [NEW]: edited });
    expect(isRelocation(row(), row({}, { doc: NEW, sha: sha(edited, "3.1") }), [MOVE], read)).to.equal(false);
  });

  it("refuses an undeclared path: no move names the pair", () => {
    const read = docs({ [OLD]: TEXT }, { "policies/elsewhere.md": TEXT });
    expect(isRelocation(row(), row({}, { doc: "policies/elsewhere.md" }), [MOVE], read)).to.equal(false);
    expect(isRelocation(row(), row({}, { doc: NEW }), [], moved)).to.equal(false);
  });

  it("refuses any other field changed beside the move", () => {
    expect(isRelocation(row(), row({ expectation: "Everyone uses approved technologies." }, { doc: NEW }), [MOVE], moved)).to.equal(false);
    expect(isRelocation(row(), row({ level: "C03" }, { doc: NEW }), [MOVE], moved)).to.equal(false);
  });

  it("refuses a closed row, a stale sha, and a section renumbered with no split map", () => {
    const end = { version: "1.5.0", date: "2026-10-02", pr: 81 };
    expect(isRelocation(row({ end }), row({ end }, { doc: NEW }), [MOVE], moved)).to.equal(false);
    expect(isRelocation(row(), row({}, { doc: NEW, sha: "0000000" }), [MOVE], moved)).to.equal(false);
    const renum = TEXT.replace("### 3.1 Approved", "### 3.2 Approved");
    expect(isRelocation(row(), row({}, { doc: NEW, section: "3.2", sha: sha(renum, "3.2") }), [MOVE], docs({ [OLD]: TEXT }, { [NEW]: renum }))).to.equal(false);
  });

  it("relocates a `with:` path param that a declared move carried", () => {
    const check = (file: string) => [{ on: { resource: "repo", event: "pr" }, action: "file-exists", with: { path: file, note: "x" }, on_miss: "fail" as const }];
    const was = row({ checks: check("policies/build/approved-technologies.md") });
    const moves: Relocation[] = [{ from: "policies/build/approved-technologies.md", to: "policies/build/tech/approved.md" }];
    expect(isRelocation(was, row({ checks: check("policies/build/tech/approved.md") }), moves, moved)).to.equal(true);
    expect(isRelocation(was, row({ checks: check("policies/other.md") }), moves, moved), "an undeclared param path").to.equal(false);
    const both = [...moves, MOVE];
    expect(isRelocation(was, row({ checks: check("policies/build/tech/approved.md") }, { doc: NEW }), both, moved), "param and doc together").to.equal(true);
  });

  it("ignores the heading line in the byte compare: a split renumbers §4.2 to §1.2", () => {
    const before = ["# Spec", "", "## 4 Build", "", "### 4.2 Branches", "", "A task branch is cut from the project branch.", ""].join("\n");
    const after = ["# Build spec", "", "## 1 Build", "", "### 1.2 Branches and tasks", "", "A task branch is cut from the project branch.", ""].join("\n");
    const was = row({}, { doc: SPEC_BEFORE_SPLIT, section: "4.2", sha: sha(before, "4.2") });
    const now = row({}, { doc: SPEC_BUILD, section: "1.2", sha: sha(after, "1.2") });
    const read = docs({ [SPEC_BEFORE_SPLIT]: before }, { [SPEC_BUILD]: after });
    expect(isRelocation(was, now, SPEC_SPLITS, read)).to.equal(true);
    const wrongNumber = row({}, { doc: SPEC_BUILD, section: "2.2", sha: sha(after.replace("1.2", "2.2"), "2.2") });
    expect(isRelocation(was, wrongNumber, SPEC_SPLITS, docs({ [SPEC_BEFORE_SPLIT]: before }, { [SPEC_BUILD]: after.replace("1.2", "2.2") }))).to.equal(false);
  });

  it("the split map renumbers the build chapters 4, 5, 6, 8 to 1–4 and keeps the minor numbers", () => {
    const build = SPEC_SPLITS.find((m) => m.to === SPEC_BUILD)!;
    expect(["4", "5.3", "6.10", "8.1.2", "7"].map((s) => relocatedSection(s, build))).to.deep.equal(["1", "2.3", "3.10", "4.1.2", null]);
  });

  it("declares the moves the head's move record names, objects and bare strings, beside the splits", () => {
    const head = memTree({ "framework/upgrade-moves.json": JSON.stringify([{ move: `${OLD} → ${NEW}`, version: "2.0.0" }, "policies/version/ → policies/history/"]) });
    const got = declaredRelocations(head);
    expect(got.slice(SPEC_SPLITS.length)).to.deep.equal([{ from: OLD, to: NEW }, { from: "policies/version/", to: "policies/history/" }]);
    expect(declaredRelocations(memTree({}))).to.deep.equal([...SPEC_SPLITS]);
  });
});

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────────────────
const dump = (rows: readonly RuleRow[]): string => yaml.dump(JSON.parse(JSON.stringify(rows)), { lineWidth: -1 });
function base(): Record<string, string> {
  return {
    "org-config.yaml": 'org_slug: "SVM"\n',
    "framework/rules/rules.yaml": "[]\n",
    "framework/rules/checks-catalog.yaml": "resources: []\ntools: []\nactions: []\n",
    "policies/VERSION": "1.4.0\n",
    "policies/CHANGELOG.md": "# Policy changelog\n\n## 1.4.0 — 2026-10-01\n\nOlder entry.\n",
    [OLD]: TEXT,
    "policies/rules/rules.yaml": dump([row()]),
  };
}
/** The upgrade's relocation PR: the file moved, the record names it, the row re-sourced, patch bump, snapshot, entry. */
function relocationPr(record: boolean): { b: ReturnType<typeof memTree>; h: ReturnType<typeof memTree> } {
  const b = memTree(base());
  const files = base();
  delete files[OLD];
  files[NEW] = TEXT;
  if (record) files["framework/upgrade-moves.json"] = JSON.stringify([{ move: `${OLD} → ${NEW}`, version: "2.0.0" }]);
  files["policies/rules/rules.yaml"] = dump([row({}, { doc: NEW })]);
  const h = memTree(files);
  const w = policyPrWriter({ base: b, head: h });
  w.bumpVersion("patch");
  w.writeSnapshot("1.4.0");
  w.stampRows("1.4.1", "2026-10-13", 92);
  files["policies/CHANGELOG.md"] = `${files["policies/CHANGELOG.md"]!.replace("## 1.4.0", "## 1.4.1 — 2026-10-13\n\nrelocated: GOV-SVM-010 → policies/build/technology.md\n\n### Sections reviewed\n\n- policies/build/technology.md §3.1 @ " + sha(TEXT, "3.1") + " — relocated\n\n## 1.4.0")}`;
  return { b, h };
}

describe("PRJ-121 §3.5 the policy PR gate accepts a declared relocation in place", () => {
  it("a relocated row passes append-only, needs only a patch, and keeps its start", () => {
    const { b, h } = relocationPr(true);
    const j = judgePolicyPr({ base: b, head: h, pr: 92, today: "2026-10-13" });
    expect(j.findings.filter((x) => x.check === "append-only" || x.check === "stamp" || x.check === "version")).to.deep.equal([]);
    expect(j.required).to.equal("patch");
    expect(j.changes).to.deep.include({ added: [], revised: [], retired: [], rowsChanged: false, relocated: ["GOV-SVM-010"] });
    expect(h.read("policies/rules/rules.yaml")).to.contain("version: 1.4.0");
  });

  it("the same edit with no declared move is refused as an in-place edit", () => {
    const { b, h } = relocationPr(false);
    const j = judgePolicyPr({ base: b, head: h, pr: 92, today: "2026-10-13" });
    expect(j.findings.filter((x) => x.check === "append-only").map((x) => x.message).join("\n")).to.contain("GOV-SVM-010");
    expect(j.required).to.equal("minor");
    expect(j.verdict).to.equal("fail");
  });

  it("readDocFrom reads the old document from the base and the new one from the head", () => {
    const read = readDocFrom(memTree({ a: "base" }), memTree({ a: "head" }));
    expect([read("a", "was"), read("a", "now")]).to.deep.equal(["base", "head"]);
  });
});
