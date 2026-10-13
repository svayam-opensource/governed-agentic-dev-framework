// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// PRJ-121 intent 01, spec §3.5 — THE UPGRADE CARRIES THE ORG'S RULES WITH THE FILES IT MOVES (T8). The pure core is
// run over two in-memory trees, and what it writes is judged by the REAL policy PR gate: a relocated row passes
// append-only, needs only a patch, keeps its start, and a row whose cited text changed is left alone and named.
import { expect } from "chai";
import yaml from "js-yaml";
import { relocateRows, appliedMoves } from "../../src/maintain/upgrade-relocate.js";
import { judgePolicyPr } from "../../src/rules/policy-pr/gate.js";
import { memTree } from "../../src/rules/policy-pr/tree.js";
import { parseRuleStore, type RuleRow } from "../../src/rules/model/rule-row.js";
import { sectionShas } from "../../src/rules/checks/sections.js";

const OLD = "policies/technology.md";
const NEW = "policies/build/technology.md";
const TEXT = ["# Technology", "", "## 3 Choosing", "", "### 3.1 Approved", "", "Everyone uses only approved technologies.", ""].join("\n");
const sha = (text: string, section: string): string => sectionShas(text).get(section)!;

const row = (over: Partial<RuleRow> = {}, source: Partial<RuleRow["source"]> = {}): RuleRow => ({
  id: "GOV-SVM-010",
  source: { doc: OLD, section: "3.1", sha: sha(TEXT, "3.1"), ...source },
  expectation: "Everyone uses only approved technologies.",
  actor: ["everyone"],
  level: "C02",
  start: { version: "1.4.0", date: "2026-10-01", pr: 80 },
  end: null,
  checks: [{ on: { resource: "vcs.gov-repo", event: "pull_request" }, action: "gov-builtin/approved-technology", with: { list: "policies/technology-list.md" }, on_miss: "fail" } as never],
  ...over,
});
const dump = (rows: readonly RuleRow[]): string => yaml.dump(JSON.parse(JSON.stringify(rows)), { lineWidth: -1 });
const BASE = (): Record<string, string> => ({
  "org-config.yaml": 'org_slug: "SVM"\n',
  "framework/rules/rules.yaml": "[]\n",
  "framework/rules/checks-catalog.yaml": "resources: []\ntools: []\nactions: []\n",
  "policies/VERSION": "1.4.0\n",
  "policies/CHANGELOG.md": "# Policy changelog\n\n## 1.4.0 — 2026-10-01\n\nOlder entry.\n",
  [OLD]: TEXT,
  "policies/technology-list.md": "# List\n",
  "policies/rules/rules.yaml": dump([row()]),
});
/** The upgrade's trees: the base before, the head after the file moved (and the record naming it). */
function trees(opts: { text?: string } = {}) {
  const b = memTree(BASE());
  const files = BASE();
  delete files[OLD];
  delete files["policies/technology-list.md"];
  files[NEW] = opts.text ?? TEXT;
  files["policies/build/technology-list.md"] = "# List\n";
  files["framework/upgrade-moves.json"] = JSON.stringify([{ move: `${OLD} → ${NEW}`, version: "2.0.0" }, { move: "policies/technology-list.md → policies/build/technology-list.md", version: "2.0.0" }]);
  return { b, files, h: memTree(files) };
}
const moves = [{ from: OLD, to: NEW }, { from: "policies/technology-list.md", to: "policies/build/technology-list.md" }];

describe("PRJ-121 §3.5 gov upgrade re-sources the org's rules that cite a moved file (T8)", () => {
  it("re-sources the row, bumps the patch, freezes a snapshot and writes a 'relocated' entry — and the policy PR gate accepts it", () => {
    const { b, files, h } = trees();
    const r = relocateRows(b, h, moves, "2026-10-13");
    expect(r.relocated).to.deep.equal(["GOV-SVM-010"]);
    expect(r.version).to.equal("1.4.1");
    const [now] = parseRuleStore(files["policies/rules/rules.yaml"]!);
    expect(now!.source).to.deep.equal({ doc: NEW, section: "3.1", sha: sha(TEXT, "3.1") });
    expect(now!.checks![0]!.with).to.deep.equal({ list: "policies/build/technology-list.md" });
    expect(now!.start).to.deep.equal({ version: "1.4.0", date: "2026-10-01", pr: 80 });
    expect(files["policies/VERSION"]).to.equal("1.4.1\n");
    expect(files["policies/history/1.4.0/technology.md"], "the policies as they were, frozen").to.equal(TEXT);
    expect(files["policies/CHANGELOG.md"]).to.match(/^## 1\.4\.1 — 2026-10-13[\s\S]*relocated: GOV-SVM-010[\s\S]*## 1\.4\.0/m);
    const j = judgePolicyPr({ base: b, head: h, pr: 92, today: "2026-10-13" });
    expect(j.findings.filter((x) => x.check === "append-only" || x.check === "version" || x.check === "stamp"), JSON.stringify(j.findings)).to.deep.equal([]);
    expect(j.required).to.equal("patch");
    expect(j.changes.relocated).to.deep.equal(["GOV-SVM-010"]);
  });

  it("leaves a row alone, and names it, when the text it cites changed in the move", () => {
    const { b, files, h } = trees({ text: TEXT.replace("only approved", "mostly approved") });
    const before = files["policies/rules/rules.yaml"];
    const r = relocateRows(b, h, moves, "2026-10-13");
    expect(r.relocated).to.deep.equal([]);
    expect(r.left.join("\n")).to.contain("GOV-SVM-010");
    expect(files["policies/rules/rules.yaml"]).to.equal(before);
    expect(files["policies/VERSION"]).to.equal("1.4.0\n");
  });

  it("does nothing when no row cites a moved file, or the org has no rule store", () => {
    const { b, files, h } = trees();
    files["policies/rules/rules.yaml"] = dump([row({ checks: undefined }, { doc: "policies/elsewhere.md" })]);
    expect(relocateRows(b, h, moves, "2026-10-13").relocated).to.deep.equal([]);
    delete files["policies/rules/rules.yaml"];
    expect(relocateRows(b, h, moves, "2026-10-13")).to.deep.equal({ relocated: [], left: [], version: null });
  });

  it("a closed row is history: it is never re-sourced", () => {
    const { b, files, h } = trees();
    files["policies/rules/rules.yaml"] = dump([row({ end: { version: "1.4.0", date: "2026-10-01", pr: 81 } })]);
    expect(relocateRows(b, h, moves, "2026-10-13").relocated).to.deep.equal([]);
  });

  it("appliedMoves turns the plan's written move actions into relocations", () => {
    const actions = [{ kind: "move", dst: NEW, from: OLD }, { kind: "move", dst: "x/y.md", from: "x.md" }, { kind: "create", dst: "z.md" }];
    expect(appliedMoves(actions, [NEW, "z.md"])).to.deep.equal([{ from: OLD, to: NEW }]);
  });
});
