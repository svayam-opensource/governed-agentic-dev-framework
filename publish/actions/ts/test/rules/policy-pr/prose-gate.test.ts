// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// GOV-FRM-467 STARTS FROM THE PROSE (Policy Owner, 2026-10-07; rule-model-design.md "gate starts from the prose").
//
// From base vs head the gate knows every section ADDED or CHANGED in the pull request; each must appear as reviewed
// in that pull request's CHANGELOG entry ("Sections reviewed"). Found in the sandbox (svayam-e2e/prj121-gov PR #5):
// §2.2 changed, had no rule rows, and the gate — which looked only at rows — raised nothing, so the model never read
// the new sentence.
import { expect } from "chai";
import { judgePolicyPr, planPolicyPr, policyDocPaths, type GateCheck } from "../../../src/rules/policy-pr/gate.js";
import { policyPrWriter, renderChangelogEntry, type ChangelogEntry } from "../../../src/rules/policy-pr/write.js";
import { parseReviewedLines, renderReviewLine, type SectionReview } from "../../../src/rules/policy-pr/reviewed.js";
import { finishPolicyChange } from "../../../src/rules/propose/write-result.js";
import { memTree, type TreeReader } from "../../../src/rules/policy-pr/tree.js";
import { sectionShas } from "../../../src/rules/checks/sections.js";
import { MACHINE_WRITTEN_POLICY_PATHS } from "../../../src/rules/checks/policy-actions.js";
import yaml from "js-yaml";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";

const DOC = "policies/org-policy.md";
const TODAY = "2026-10-07";
const PR = 5;
const POLICY = (s22: string, s21 = "Everyone reads the policy.") =>
  `# Org policy\n\nPreamble.\n\n## 2 People\n\n### 2.1 Reading\n\n${s21}\n\n### 2.2 Training\n\n${s22}\n`;
const OLD = POLICY("New staff are trained.");
const NEW = POLICY("New staff are trained within thirty days of joining.");
const sha = (text: string, s: string): string => sectionShas(text).get(s)!;

function baseFiles(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "org-config.yaml": 'org_slug: "E2E"\n',
    "framework/rules/rules.yaml": "[]\n",
    "framework/rules/catalog.yaml": "resources: []\ntools: []\nactions: []\n",
    "policies/governance.yaml": "policy_owner: { github: \"polly\" }\n",
    "policies/VERSION": "1.0.0\n",
    "policies/CHANGELOG.md": "# Policy changelog\n\n## 1.0.0 — 2026-10-01\n\nFirst.\n",
    "policies/rules.yaml": "[]\n",
    [DOC]: OLD,
    ...extra,
  };
}

/** A head with `edits`, then version, snapshot and a changelog entry listing `reviewed` — as the writers make them. */
function prepared(edits: Record<string, string>, reviewed: readonly SectionReview[], base = baseFiles()) {
  const files = { ...base, ...edits };
  const head = memTree(files);
  const b = memTree(base);
  const plan = planPolicyPr(b, head);
  if ("unreadable" in plan) throw new Error(plan.unreadable);
  const w = policyPrWriter({ base: b, head });
  const { version } = w.bumpVersion(plan.required === "none" ? "patch" : plan.required);
  w.writeSnapshot(plan.baseVersion);
  w.writeChangelogEntry({ version, date: TODAY, pr: PR, author: "alice", approver: null, rules: [], qa: [], reviewed });
  return { base: b as TreeReader, head, files };
}
const judge = (x: { base: TreeReader; head: TreeReader }) => judgePolicyPr({ base: x.base, head: x.head, pr: PR, today: TODAY });
const checksOf = (j: { findings: readonly { check: GateCheck }[] }) => [...new Set(j.findings.map((f) => f.check))];

describe("GOV-FRM-467 the policy PR gate starts from the prose — every added or changed section is reviewed in the changelog", () => {
  it("PR #5's shape: §2.2 changed with no rule rows and no review → `unreviewed`, not passed (and no `sha` finding — there are no rows)", () => {
    const j = judge(prepared({ [DOC]: NEW }, []));
    expect(j.verdict).to.equal("fail");
    expect(checksOf(j)).to.deep.equal(["unreviewed"]);
    expect(j.findings[0]!.message).to.contain(`${DOC} §2.2`).and.contain(sha(NEW, "2.2")).and.contain("gov rules propose");
  });

  it("the entry lists §2.2 at its new sha → no rule: the gate passes", () => {
    const j = judge(prepared({ [DOC]: NEW }, [{ doc: DOC, section: "2.2", sha: sha(NEW, "2.2"), outcome: { kind: "no-rule" } }]));
    expect(j.findings).to.deep.equal([]);
    expect(j.verdict).to.equal("pass");
  });

  it("a review of an EARLIER text of the section does not count — the sha must be the head's", () => {
    const j = judge(prepared({ [DOC]: NEW }, [{ doc: DOC, section: "2.2", sha: sha(OLD, "2.2"), outcome: { kind: "no-rule" } }]));
    expect(checksOf(j)).to.deep.equal(["unreviewed"]);
  });

  it("an unchanged section is never demanded — only §2.2 is", () => {
    const j = judge(prepared({ [DOC]: NEW }, []));
    expect(j.findings.map((f) => f.message).join("\n")).to.not.contain("§2.1").and.not.contain("§2 ");
  });

  it("an added section is demanded; the text outside every numbered section (the preamble) never is", () => {
    const added = `${NEW.replace("Preamble.", "A new preamble.")}\n### 2.3 Leaving\n\nLeavers return their laptop.\n`;
    const j = judge(prepared({ [DOC]: added }, []));
    const msgs = j.findings.filter((f) => f.check === "unreviewed").map((f) => f.message);
    expect(msgs).to.have.length(2);
    expect(msgs.join("\n")).to.contain("§2.2").and.contain("§2.3");
  });

  it("a whitespace-only reflow is what the section helper calls unchanged: nothing is demanded", () => {
    const reflowed = OLD.replace("New staff are trained.", "New   staff\nare trained.  ");
    expect(sha(reflowed, "2.2")).to.equal(sha(OLD, "2.2"));
    const j = judge(prepared({ [DOC]: reflowed }, []));
    expect(j.required).to.equal("patch");
    expect(j.findings).to.deep.equal([]);
  });

  it("machine-written files and governance.yaml are never policy documents", () => {
    const machine = Object.fromEntries(MACHINE_WRITTEN_POLICY_PATHS.map((p) => [p.replace("**", "0.9.0/org-policy.md"), "# x\n\n## 1 X\n\nx\n"]));
    const docs = policyDocPaths(memTree({ ...baseFiles(), ...machine, "policies/actions/a/README.md": "## 1 Y\n" }));
    expect(docs).to.deep.equal([DOC]);
    const gov = judge(prepared({ "policies/governance.yaml": "policy_owner: { github: \"polly\" }\nmodels: { ci_allowed: true }\n" }, []));
    expect(checksOf(gov)).to.not.include("unreviewed");
  });

  it("a section of a NEW policy document is demanded; a deleted section is not (its rows' sha findings cover it)", () => {
    const j = judge(prepared({ "policies/hr.md": "# HR\n\n## 1 Leave\n\nEveryone books leave.\n" }, []));
    expect(j.findings.map((f) => f.message).join("\n")).to.contain("policies/hr.md §1");
    const gone = judge(prepared({ [DOC]: OLD.replace(/### 2\.2[\s\S]*$/, "") }, []));
    expect(checksOf(gone)).to.not.include("unreviewed");
  });
});

describe("the changelog's \"Sections reviewed\" — written by propose, read by the gate", () => {
  const S = "abc1234";
  it("renders one line per section: no rule, the rules by id and change, or removed with the rules it retired", () => {
    expect(renderReviewLine({ doc: DOC, section: "2.2", sha: S, outcome: { kind: "no-rule" } })).to.equal(`- ${DOC} §2.2 (${S}) → no rule`);
    expect(renderReviewLine({ doc: DOC, section: "3", sha: S, outcome: { kind: "rules", rules: [{ id: "GOV-E2E-001", change: "added" }, { id: "GOV-E2E-002", change: "kept" }] } }))
      .to.equal(`- ${DOC} §3 (${S}) → GOV-E2E-001 added, GOV-E2E-002 kept`);
    expect(renderReviewLine({ doc: DOC, section: "4", sha: null, outcome: { kind: "removed", retired: ["GOV-E2E-003"] } })).to.equal(`- ${DOC} §4 → removed (rules retired: GOV-E2E-003)`);
    expect(renderReviewLine({ doc: DOC, section: "5", sha: null, outcome: { kind: "removed", retired: [] } })).to.equal(`- ${DOC} §5 → removed (no rules)`);
  });

  it("the entry carries them under **Sections reviewed**, and they read back exactly", () => {
    const reviewed: SectionReview[] = [
      { doc: DOC, section: "2.2", sha: S, outcome: { kind: "no-rule" } },
      { doc: DOC, section: "3", sha: "def5678", outcome: { kind: "rules", rules: [{ id: "GOV-E2E-001", change: "revised" }] } },
      { doc: DOC, section: "4", sha: null, outcome: { kind: "removed", retired: ["GOV-E2E-009"] } },
    ];
    const e: ChangelogEntry = { version: "1.1.0", date: TODAY, pr: PR, author: "alice", approver: null, rules: [], qa: [], reviewed };
    const text = renderChangelogEntry(e);
    expect(text).to.contain("**Sections reviewed**").and.contain(`- ${DOC} §2.2 (${S}) → no rule`);
    expect(parseReviewedLines(text)).to.deep.equal(reviewed);
  });

  it("finishPolicyChange lists what the run settled, derives rows' outcomes from the trees, and lists a removed section with the rules it retired", () => {
    const row = (id: string, section: string, text: string, end: RuleRow["end"] = null): RuleRow => ({
      id, source: { doc: DOC, section, sha: sha(text, section) }, expectation: `Obey ${section}.`, actor: ["everyone"], level: "C02",
      start: { version: "1.0.0", date: "2026-10-01", pr: 1 }, end,
    });
    const dump = (rows: RuleRow[]) => yaml.dump(JSON.parse(JSON.stringify(rows)), { lineWidth: -1 });
    const base = baseFiles({ "policies/rules.yaml": dump([row("GOV-E2E-001", "2.1", OLD), row("GOV-E2E-002", "2.2", OLD)]) });
    const changed = NEW.replace("Everyone reads the policy.", "Everyone reads the policy each year.").replace(/### 2\.2[\s\S]*$/, "### 2.3 Leaving\n\nLeavers return laptops.\n");
    // §2.1 changed and its row was kept (sha refreshed); §2.2 removed, its row retired; §2.3 added, no rule.
    const kept = { ...row("GOV-E2E-001", "2.1", changed) };
    const retired = row("GOV-E2E-002", "2.2", OLD, { version: "1.1.0", date: TODAY, pr: PR });
    const files = { ...base, [DOC]: changed, "policies/rules.yaml": dump([kept, retired]) };
    const head = memTree(files);
    const fin = finishPolicyChange({ base: memTree(base), head, pr: PR, today: TODAY, author: "alice",
      reviewed: [{ doc: DOC, section: "2.3", sha: sha(changed, "2.3"), outcome: { kind: "no-rule" } }] });
    expect(fin.ok, fin.lines.join("\n")).to.equal(true);
    const log = files["policies/CHANGELOG.md"]!;
    expect(log).to.contain(`- ${DOC} §2.1 (${sha(changed, "2.1")}) → GOV-E2E-001 kept`);
    expect(log).to.contain(`- ${DOC} §2.2 → removed (rules retired: GOV-E2E-002)`);
    expect(log).to.contain(`- ${DOC} §2.3 (${sha(changed, "2.3")}) → no rule`);
    expect(judgePolicyPr({ base: memTree(base), head, pr: PR, today: TODAY }).findings).to.deep.equal([]);
  });

  it("a later run keeps the sections an earlier run of this PR reviewed (at the same sha) when it rewrites the entry", () => {
    const base = baseFiles();
    const files = { ...base, [DOC]: NEW };
    const head = memTree(files);
    finishPolicyChange({ base: memTree(base), head, pr: PR, today: TODAY, author: "alice", reviewed: [{ doc: DOC, section: "2.2", sha: sha(NEW, "2.2"), outcome: { kind: "no-rule" } }] });
    const both = NEW.replace("Everyone reads the policy.", "Everyone reads the policy twice.");
    files[DOC] = both;
    finishPolicyChange({ base: memTree(base), head, pr: PR, today: TODAY, author: "alice", reviewed: [{ doc: DOC, section: "2.1", sha: sha(both, "2.1"), outcome: { kind: "no-rule" } }] });
    const log = files["policies/CHANGELOG.md"]!;
    expect(log).to.contain("§2.1").and.contain(`§2.2 (${sha(both, "2.2")}) → no rule`);
    expect(judgePolicyPr({ base: memTree(base), head, pr: PR, today: TODAY }).findings).to.deep.equal([]);
  });

  it("a review recorded at a sha the section no longer has is dropped, so the gate demands it again", () => {
    const base = baseFiles();
    const files = { ...base, [DOC]: NEW };
    const head = memTree(files);
    finishPolicyChange({ base: memTree(base), head, pr: PR, today: TODAY, author: "alice", reviewed: [{ doc: DOC, section: "2.2", sha: sha(NEW, "2.2"), outcome: { kind: "no-rule" } }] });
    files[DOC] = POLICY("New staff are trained by HR.");
    finishPolicyChange({ base: memTree(base), head, pr: PR, today: TODAY, author: "alice" });
    expect(files["policies/CHANGELOG.md"]).to.not.contain(sha(NEW, "2.2"));
    const j = judgePolicyPr({ base: memTree(base), head, pr: PR, today: TODAY });
    expect(checksOf(j)).to.deep.equal(["unreviewed"]);
  });
});
