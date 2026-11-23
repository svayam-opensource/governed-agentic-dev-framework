// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// POLICY OWNER RULING D3 A+ (PRJ-121, 2026-11-23): WHO MUST APPROVE A POLICY CHANGE, AS ONE PURE FUNCTION.
// `requiredSectionOwners` is what section-owner-approval (GOV-FRM-455) decides with; a service showing the approvers
// (gov-licence's practice record) calls the same function, so the two never disagree.
import { expect } from "chai";
import { requiredSectionOwners, sectionOwnerApproval, type SectionOwnersFile } from "../../../src/rules/checks/policy-actions.js";
import { sectionOwnersRulesFrom } from "../../../src/rules/checks/section-owners-rules.js";
import type { EventContext, RuleSet } from "../../../src/rules/model/contracts.js";

const DOC = "policies/org-policy.md";
const BASE = "## 3 Technology\n\nUse approved tech.\n\n### 3.1 Libraries\n\nOnly listed.\n\n## 4 Data\n\nKeep it safe.\n\n## 6 Other\n\nx\n";
const ROLES = { "Policy Owner": "@polly", "Check Owner": "@chuck", "Data Owner": "@dana" };
const ownership = [{ doc: DOC, section: "4", role: "Data Owner", sha: "0000004" }, { doc: DOC, section: "3", role: "Engineering Owner", sha: "0000003" }];
const rules = { ownership, roles: ROLES };
const file = (path: string, text: string | null, status: SectionOwnersFile["status"] = "modified"): SectionOwnersFile => ({ path, status, text });
const edit = (from: string, to: string) => file(DOC, BASE.replace(from, to));

describe("requiredSectionOwners (GOV-FRM-455, ruling D3 A+)", () => {
  it("names each changed section's owner with the section and the role", () => {
    const r = requiredSectionOwners(rules, [edit("Keep it safe.", "Keep it very safe.")], { [DOC]: BASE }, "someone");
    expect(r).to.deep.equal({ owners: [{ handle: "@dana", why: ["`policies/org-policy.md` §4 (Data Owner)"] }], notes: [] });
  });

  it("a vacant role and an unowned section go to the Policy Owner; owners are sorted by handle, reasons in document order", () => {
    const head = BASE.replace("x\n", "y\n").replace("Only listed.", "Only listed ones.").replace("Keep it safe.", "Keep.");
    const r = requiredSectionOwners(rules, [file(DOC, head), file("policies/actions/lint/run.sh", "echo")], { [DOC]: BASE }, undefined);
    expect(r.owners.map((o) => o.handle)).to.deep.equal(["@chuck", "@dana", "@polly"]);
    expect(r.owners[2]!.why).to.deep.equal([
      "`policies/org-policy.md` §3.1 (Engineering Owner — vacant, so the Policy Owner)",
      "`policies/org-policy.md` §6 (Policy Owner)",
    ]);
    expect(r.owners[0]!.why).to.deep.equal(["`policies/actions/lint/run.sh` (executable action) (Check Owner)"]);
  });

  it("the machine-written files need nobody", () => {
    const r = requiredSectionOwners(rules,
      [file("policies/VERSION", "1.0.1\n"), file("policies/rules/rules.yaml", "[]\n"), file("policies/CHANGELOG.md", "# x\n")],
      {}, "someone");
    expect(r).to.deep.equal({ owners: [], notes: [] });
  });

  // POLICY OWNER RULING F142 A (2026-11-23): the policy's title page is the Policy Owner's, like governance.yaml.
  describe("policies/policy-document.yaml — the title page needs the Policy Owner (F142 A)", () => {
    const PD = "policies/policy-document.yaml";
    const titlePage = [file(PD, "title_page: { title: Ours, approved_by: Policy Owner }\n")];
    const why = "`policies/policy-document.yaml` (the policy's title page)";

    it("an author who is not the Policy Owner → the Policy Owner", () => {
      expect(requiredSectionOwners(rules, titlePage, { [PD]: "title_page: { title: x }\n" }, "dana"))
        .to.deep.equal({ owners: [{ handle: "@polly", why: [`${why} (Policy Owner)`] }], notes: [] });
    });

    it("the Policy Owner as author → the Check Owner approves instead", () => {
      const r = requiredSectionOwners(rules, titlePage, {}, "@Polly");
      expect(r.owners).to.deep.equal([{ handle: "@chuck", why: [`${why} (Policy Owner) — its owner is the author, so the Check Owner approves instead`] }]);
      expect(r.selfApprovedMiss).to.equal(undefined);
    });

    it("the Policy Owner as author with no Check Owner (vacant, or the same person) → a miss: name a second person", () => {
      for (const roles of [{ "Policy Owner": "@polly" }, { "Policy Owner": "@polly", "Check Owner": "polly" }]) {
        const r = requiredSectionOwners({ ownership, roles }, titlePage, {}, "polly");
        expect(r.owners).to.deep.equal([]);
        expect(r.selfApprovedMiss).to.contain(why).and.contain("Name a second person as Policy Owner or Check Owner");
      }
    });

    it("needs no base text (the whole file is the Policy Owner's), and the check misses the same way", () => {
      const ctx = (author: string): EventContext =>
        ({ resource: "vcs.gov-repo", event: "pull_request", payload: { changed: [{ ...titlePage[0]!, addedLines: [] }], author, approvals: [] } as EventContext["payload"] });
      const full = { framework: [], org: [], orgScope: "SVM", orgVersion: "1.0.0", catalog: { actions: [] }, ownership, roles: { "Policy Owner": "@polly" } } as unknown as RuleSet;
      const r = sectionOwnerApproval("GOV-FRM-455", {}, ctx("polly"), full);
      expect(r.verdict).to.equal("miss");
      expect(r.findings.join()).to.contain("Name a second person as Policy Owner or Check Owner");
      expect(sectionOwnerApproval("GOV-FRM-455", {}, ctx("dana"), full).requestReview).to.deep.equal(["polly"]);
    });
  });

  it("the author is never listed; if that leaves nobody, the Policy Owner (or Check Owner) approves instead", () => {
    const r = requiredSectionOwners(rules, [edit("Keep it safe.", "Keep.")], { [DOC]: BASE }, "@Dana");
    expect(r.owners).to.deep.equal([{ handle: "@polly", why: ["`policies/org-policy.md` §4 (Data Owner) — its owner is the author, so the Policy Owner approves instead"] }]);
    const byPolicyOwner = requiredSectionOwners(rules, [edit("x\n", "y\n")], { [DOC]: BASE }, "polly");
    expect(byPolicyOwner.owners.map((o) => o.handle)).to.deep.equal(["@chuck"]);
  });

  it("the author is the only role holder: no owners, and selfApprovedMiss says so", () => {
    const r = requiredSectionOwners({ ownership, roles: { "Policy Owner": "@solo" } }, [edit("x\n", "y\n")], { [DOC]: BASE }, "solo");
    expect(r.owners).to.deep.equal([]);
    expect(r.selfApprovedMiss).to.match(/^GOV-FRM-455: @solo changed .*self-approved\.$/);
  });

  it("what it cannot work out is a note, never a guess", () => {
    expect(requiredSectionOwners(rules, [edit("x\n", "y\n")], undefined, undefined).notes.join()).to.contain("at the base was not given");
    expect(requiredSectionOwners(rules, [file(DOC, null)], { [DOC]: BASE }, undefined).notes.join()).to.contain("could not be read at the head");
    const noOwner = requiredSectionOwners({ ownership, roles: {} }, [edit("x\n", "y\n")], { [DOC]: BASE }, undefined);
    expect(noOwner.owners).to.deep.equal([]);
    expect(noOwner.notes.join()).to.contain("Policy Owner has no handle");
  });

  it("docs, ignore and tag options apply", () => {
    const other = "policies/handbook.txt";
    const r = requiredSectionOwners(rules, [file(other, "## 1 A\n\nb\n")], { [other]: "## 1 A\n\na\n" }, undefined, { docs: ["policies/*.txt"], tag: "X" });
    expect(r.owners.map((o) => o.handle)).to.deep.equal(["@polly"]);
    const ignored = requiredSectionOwners(rules, [edit("x\n", "y\n")], { [DOC]: BASE }, undefined, { ignore: [DOC] });
    expect(ignored.owners).to.deep.equal([]);
    expect(requiredSectionOwners(rules, [edit("x\n", "y\n")], undefined, undefined, { tag: "X" }).notes[0]).to.match(/^X: /);
  });

  it("the check decides with it: the same approvers, compared with the approvals", () => {
    const changed = [edit("Keep it safe.", "Keep."), edit("x\n", "y\n")];
    const ctx = (extra: Record<string, unknown>): EventContext =>
      ({ resource: "vcs.gov-repo", event: "pull_request", payload: { changed: changed.map((f) => ({ ...f, addedLines: [] })), baseTexts: { [DOC]: BASE }, ...extra } as EventContext["payload"] });
    const want = requiredSectionOwners(rules, changed, { [DOC]: BASE }, undefined).owners.map((o) => o.handle.slice(1));
    const full = { framework: [], org: [], orgScope: "SVM", orgVersion: "1.0.0", catalog: { actions: [] }, ...rules } as unknown as RuleSet;
    expect(sectionOwnerApproval("T", {}, ctx({ approvals: [] }), full).requestReview).to.deep.equal(want);
    expect(sectionOwnerApproval("T", {}, ctx({ approvals: want }), full).verdict).to.equal("pass");
  });
});

describe("sectionOwnersRulesFrom — the rule set's ownership and roles from the gov repo's texts", () => {
  const governance = "governance_posture: soft\npolicy_owner:\n  github: polly\ncheck_owner:\n  github: \"\"\n";
  const roleList = "# Reps\n\n| Role | GitHub handle | Owns |\n|------|---------------|------|\n| Data Owner | @dana | `knowledge/data/` |\n| Legal | vacant | |\n";
  const own = '- { doc: policies/org-policy.md, section: "4", role: Data Owner, sha: "0000004" }\n';

  it("roles as the check loads them: a vacant Check Owner reads as the Policy Owner, a vacant org role as empty", () => {
    const r = sectionOwnersRulesFrom({ governance, roleList, ownership: own });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.rules.roles).to.deep.equal({ "Policy Owner": "polly", "Check Owner": "polly", "Data Owner": "@dana", Legal: "" });
    expect(r.rules.ownership).to.deep.equal([{ doc: DOC, section: "4", role: "Data Owner", sha: "0000004" }]);
    const owners = requiredSectionOwners(r.rules, [edit("Keep it safe.", "Keep.")], { [DOC]: BASE }, undefined).owners;
    expect(owners).to.deep.equal([{ handle: "@dana", why: ["`policies/org-policy.md` §4 (Data Owner)"] }]);
  });

  it("no ownership.yaml → no rows; an unreadable one is refused, never guessed", () => {
    const none = sectionOwnersRulesFrom({ governance, roleList: null, ownership: null });
    expect(none).to.deep.include({ ok: true });
    expect(sectionOwnersRulesFrom({ governance, roleList, ownership: "{ not: a list" }).ok).to.equal(false);
  });
});
