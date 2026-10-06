// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// A CHANGE TO policies/governance.yaml IS NAMED, AND BUMPS THE VERSION AS RULED (sandbox finding, PRJ-121, 2026-10-07).
//
// The changelog called a governance change "prose only" and the gate wanted a patch. Governance choices are not
// prose: posture, the owners, the agents, publication, the approved model. The Policy Owner ruled (2026-10-07) that
// such a change is a MINOR bump, held in ONE constant every planner reads.
import { expect } from "chai";
import { describeGovernanceChanges, GOVERNANCE_PATH, EMPTY_GOVERNANCE_VALUES, renderGovernance } from "../../../src/config/governance.js";
import { GOVERNANCE_CHANGE_BUMP, judgePolicyPr, planPolicyPr } from "../../../src/rules/policy-pr/gate.js";
import { renderChangelogEntry } from "../../../src/rules/policy-pr/write.js";
import { finishPolicyChange } from "../../../src/rules/propose/write-result.js";
import { memTree } from "../../../src/rules/policy-pr/tree.js";

const GOV = renderGovernance({ ...EMPTY_GOVERNANCE_VALUES, policyOwnerGithub: "polly", policyOwnerEmail: "p@x.org" });
const withModel = (text: string, provider: string, model: string, ci: boolean): string =>
  text.replace(/provider: ""/, `provider: "${provider}"`).replace(/model: ""/, `model: "${model}"`).replace(/ci_allowed: false/, `ci_allowed: ${ci}`);

function files(gov: string): Record<string, string> {
  return {
    "org-config.yaml": 'org_slug: "SVM"\n',
    "framework/rules/rules.yaml": "[]\n",
    "framework/rules/catalog.yaml": "resources: []\ntools: []\nactions: []\n",
    "policies/VERSION": "1.4.0\n",
    "policies/CHANGELOG.md": "# Policy changelog\n\n## 1.4.0 — 2026-10-01\n\nOlder entry.\n",
    "policies/rules.yaml": "[]\n",
    [GOVERNANCE_PATH]: gov,
  };
}

describe("governance.yaml changes — named in plain words", () => {
  it("the Policy Owner's ruling: a governance change is a minor bump", () => {
    expect(GOVERNANCE_CHANGE_BUMP).to.equal("minor");
  });

  it("an approved model, in the words the changelog uses", () => {
    expect(describeGovernanceChanges(GOV, withModel(GOV, "gemini", "gemini-3.8-flash", true)))
      .to.deep.equal(["Approved model for propose: gemini · gemini-3.8-flash; CI may use it"]);
    expect(describeGovernanceChanges(withModel(GOV, "gemini", "gemini-3.8-flash", true), GOV))
      .to.deep.equal(["Approved model for propose: none; CI may not use it"]);
  });

  it("posture, owners, agents and publication each get a line", () => {
    const head = GOV.replace('governance_posture: "soft"', 'governance_posture: "hard"')
      .replace('github: "polly"', 'github: "pat"')
      .replace("check_owner:\n  github: \"\"", 'check_owner:\n  github: "chuck"')
      .replace('knowledge_publication: "none"', 'knowledge_publication: "site"');
    expect(describeGovernanceChanges(GOV, head)).to.deep.equal([
      "Governance posture: soft → hard",
      "Policy Owner: @polly → @pat",
      "Check Owner: vacant → @chuck",
      "Knowledge publication: none → site",
    ]);
  });

  it("a comment or layout edit changes no choice", () => {
    expect(describeGovernanceChanges(GOV, `${GOV}\n# a note\n`)).to.deep.equal([]);
  });
});

describe("governance.yaml changes — the planner, the gate and the changelog agree", () => {
  const base = () => memTree(files(GOV));
  const changed = () => files(withModel(GOV, "gemini", "gemini-3.8-flash", true));

  it("planPolicyPr requires GOVERNANCE_CHANGE_BUMP and carries the plain-words lines", () => {
    const plan = planPolicyPr(base(), memTree(changed()));
    if ("unreadable" in plan) throw new Error(plan.unreadable);
    expect(plan.required).to.equal(GOVERNANCE_CHANGE_BUMP);
    expect(plan.governance).to.deep.equal(["Approved model for propose: gemini · gemini-3.8-flash; CI may use it"]);
  });

  it("a comment-only edit to governance.yaml is prose: patch, nothing named", () => {
    const plan = planPolicyPr(base(), memTree(files(`${GOV}\n# a note\n`)));
    if ("unreadable" in plan) throw new Error(plan.unreadable);
    expect(plan.required).to.equal("patch");
    expect(plan.governance).to.deep.equal([]);
  });

  it("the changelog entry names the change and never says 'prose only'", () => {
    const text = renderChangelogEntry({ version: "1.5.0", date: "2026-10-07", pr: 7, author: "a", approver: null, rules: [], qa: [],
      governance: ["Approved model for propose: gemini · gemini-3.8-flash; CI may use it"] });
    expect(text).to.not.contain("prose only");
    expect(text).to.contain("**Governance choices** (`policies/governance.yaml`)");
    expect(text).to.contain("- Approved model for propose: gemini · gemini-3.8-flash; CI may use it");
  });

  it("finishPolicyChange writes a minor bump and the named entry, and the gate passes it", () => {
    const head = memTree(changed());
    const fin = finishPolicyChange({ base: base(), head, pr: 7, today: "2026-10-07", author: "alice" });
    expect(fin.ok).to.equal(true);
    expect(fin.version).to.equal("1.5.0");
    expect(head.read("policies/CHANGELOG.md")).to.contain("Approved model for propose: gemini · gemini-3.8-flash; CI may use it")
      .and.not.contain("prose only");
    const j = judgePolicyPr({ base: base(), head, pr: 7, today: "2026-10-07" });
    expect(j.findings).to.deep.equal([]);
    expect(j.verdict).to.equal("pass");
  });

  it("the gate fails a patch bump for a governance change, and an entry that does not name it", () => {
    const f = changed();
    f["policies/VERSION"] = "1.4.1\n";
    f["policies/CHANGELOG.md"] = "# Policy changelog\n\n## 1.4.1 — 2026-10-07\n\n_No rule changed — prose only._\n\n## 1.4.0 — 2026-10-01\n\nOlder entry.\n";
    const j = judgePolicyPr({ base: base(), head: memTree(f), pr: 7, today: "2026-10-07" });
    const msgs = j.findings.map((x) => x.message);
    expect(msgs).to.include("policies/VERSION is 1.4.1; the governance choices changed, so it must be 1.5.0 (or 2.0.0 if the organization chooses a major version)");
    f["policies/VERSION"] = "1.5.0\n";
    f["policies/CHANGELOG.md"] = f["policies/CHANGELOG.md"]!.replace("## 1.4.1", "## 1.5.0");
    const j2 = judgePolicyPr({ base: base(), head: memTree(f), pr: 7, today: "2026-10-07" });
    expect(j2.findings.map((x) => x.message)).to.include(
      "the policies/CHANGELOG.md entry for 1.5.0 does not name the governance change: Approved model for propose: gemini · gemini-3.8-flash; CI may use it");
  });
});
