// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// POLICY OWNER RULING D3 A+ (PRJ-121, 2026-11-23): WHO MUST APPROVE A POLICY CHANGE, AS ONE PURE FUNCTION.
// `requiredSectionOwners` is what section-owner-approval (GOV-FRM-455) decides with; a service showing the approvers
// (gov-licence's practice record) calls the same function, so the two never disagree.
import { expect } from "chai";
import { actingPolicyOwner, requiredSectionOwners, sectionOwnerApproval, SELF_MERGED_SOLO, soloMode, type SectionOwnersFile } from "../../../src/rules/checks/policy-actions.js";
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
        const r = requiredSectionOwners({ ownership, roles, posture: "hard" }, titlePage, {}, "polly");
        expect(r.owners).to.deep.equal([]);
        expect(r.selfApprovedMiss).to.contain(why).and.contain("Name a second person as Policy Owner or Check Owner");
      }
    });

    it("needs no base text (the whole file is the Policy Owner's), and the check misses the same way", () => {
      const ctx = (author: string): EventContext =>
        ({ resource: "vcs.gov-repo", event: "pull_request", payload: { changed: [{ ...titlePage[0]!, addedLines: [] }], author, approvals: [] } as EventContext["payload"] });
      const full = { framework: [], org: [], orgScope: "SVM", orgVersion: "1.0.0", catalog: { actions: [] }, ownership, roles: { "Policy Owner": "@polly" }, posture: "hard" } as unknown as RuleSet;
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
    const r = requiredSectionOwners({ ownership, roles: { "Policy Owner": "@solo" }, posture: "hard" }, [edit("x\n", "y\n")], { [DOC]: BASE }, "solo");
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

// POLICY OWNER RULING F143 A (PRJ-121, 2026-11-23): EVERY ROLE HAS AN ALTERNATE. When a role's holder is the author,
// or the role is vacant, its alternate approves — if named, and not the author. Otherwise the fallback is as before.
describe("requiredSectionOwners — alternates (F143 A)", () => {
  const alternates = { "Data Owner": "@dev", "Policy Owner": "@pat", "Engineering Owner": "@eve" };
  const withAlt = { ownership, roles: ROLES, alternates };

  it("the holder is the author → the role's alternate approves, and the why-line says so", () => {
    const r = requiredSectionOwners(withAlt, [edit("Keep it safe.", "Keep.")], { [DOC]: BASE }, "@Dana");
    expect(r.owners).to.deep.equal([{ handle: "@dev", why: ["`policies/org-policy.md` §4 (Data Owner) — its owner is the author, so its alternate approves"] }]);
  });

  it("a vacant role → its alternate approves, not the Policy Owner", () => {
    const r = requiredSectionOwners(withAlt, [edit("Only listed.", "Only listed ones.")], { [DOC]: BASE }, "someone");
    expect(r.owners).to.deep.equal([{ handle: "@eve", why: ["`policies/org-policy.md` §3.1 (Engineering Owner) — vacant, so its alternate approves"] }]);
  });

  it("the holder is not the author → the holder approves; the alternate is not asked", () => {
    const r = requiredSectionOwners(withAlt, [edit("Keep it safe.", "Keep.")], { [DOC]: BASE }, "someone");
    expect(r.owners).to.deep.equal([{ handle: "@dana", why: ["`policies/org-policy.md` §4 (Data Owner)"] }]);
  });

  it("the Policy Owner as author → the Policy Owner's alternate, before the Check Owner", () => {
    const r = requiredSectionOwners(withAlt, [file("policies/governance.yaml", "x: 1\n")], {}, "polly");
    expect(r.owners).to.deep.equal([{ handle: "@pat", why: ["`policies/governance.yaml` (governance choices) (Policy Owner) — its owner is the author, so its alternate approves"] }]);
  });

  it("a vacant role with no alternate reads as the Policy Owner — and takes the Policy Owner's alternate when the Policy Owner is the author", () => {
    const r = requiredSectionOwners({ ownership, roles: ROLES, alternates: { "Policy Owner": "@pat" } }, [edit("Only listed.", "Only listed ones.")], { [DOC]: BASE }, "polly");
    expect(r.owners).to.deep.equal([{ handle: "@pat", why: ["`policies/org-policy.md` §3.1 (Engineering Owner — vacant, so the Policy Owner) — its owner is the author, so the Policy Owner's alternate approves"] }]);
  });

  it("an alternate who is the author does not stand in: the fallback is as before (the Policy Owner)", () => {
    const r = requiredSectionOwners({ ownership, roles: ROLES, alternates: { "Data Owner": "dana" } }, [edit("Keep it safe.", "Keep.")], { [DOC]: BASE }, "dana");
    expect(r.owners).to.deep.equal([{ handle: "@polly", why: ["`policies/org-policy.md` §4 (Data Owner) — its owner is the author, so the Policy Owner approves instead"] }]);
  });

  it("the author holds the Policy Owner and Check Owner roles: the Check Owner's alternate is the last fallback", () => {
    const r = requiredSectionOwners({ ownership, roles: { "Policy Owner": "@polly", "Check Owner": "@polly" }, alternates: { "Check Owner": "@cora" } },
      [file("policies/actions/lint/run.sh", "echo")], {}, "polly");
    expect(r.owners).to.deep.equal([{ handle: "@cora", why: ["`policies/actions/lint/run.sh` (executable action) (Check Owner) — its owner is the author, so its alternate approves"] }]);
  });

  it("no alternates at all → exactly as before", () => {
    const r = requiredSectionOwners({ ownership, roles: ROLES, alternates: {} }, [edit("Keep it safe.", "Keep.")], { [DOC]: BASE }, "@Dana");
    expect(r.owners).to.deep.equal([{ handle: "@polly", why: ["`policies/org-policy.md` §4 (Data Owner) — its owner is the author, so the Policy Owner approves instead"] }]);
  });
});

// POLICY OWNER RULING Q46 A (PRJ-121, 2026-11-23): a vacant Policy Owner or Check Owner is stood in for by its alternate,
// the same as the org's own roles. With no alternate, as before.
describe("requiredSectionOwners — the framework roles vacant (Q46 A)", () => {
  const action = [file("policies/actions/lint/run.sh", "echo")];
  const gov = [file("policies/governance.yaml", "x: 1\n")];

  it("a vacant Check Owner with an alternate → the alternate approves the action, not the Policy Owner", () => {
    const r = requiredSectionOwners({ ownership, roles: { "Policy Owner": "@polly", "Check Owner": "" }, alternates: { "Check Owner": "@cora" } }, action, {}, "dana");
    expect(r.owners).to.deep.equal([{ handle: "@cora", why: ["`policies/actions/lint/run.sh` (executable action) (Check Owner) — vacant, so its alternate approves"] }]);
  });

  it("a vacant Check Owner with no alternate → the Policy Owner, as before", () => {
    const r = requiredSectionOwners({ ownership, roles: { "Policy Owner": "@polly", "Check Owner": "" } }, action, {}, "dana");
    expect(r.owners).to.deep.equal([{ handle: "@polly", why: ["`policies/actions/lint/run.sh` (executable action) (Check Owner — vacant, so the Policy Owner)"] }]);
  });

  const vacantPo = { ownership, roles: { "Policy Owner": "", "Check Owner": "@chuck", "Data Owner": "@dana", "Engineering Owner": "" }, alternates: { "Policy Owner": "@pat" } };

  it("a vacant Policy Owner with an alternate: no 'no handle' stop — the alternate approves governance and ownership changes", () => {
    const r = requiredSectionOwners(vacantPo, gov, {}, "dana");
    expect(r.notes).to.deep.equal([]);
    expect(r.owners).to.deep.equal([{ handle: "@pat", why: ["`policies/governance.yaml` (governance choices) (Policy Owner) — vacant, so its alternate approves"] }]);
  });

  it("…and is the fallback for a vacant org role, and for an unowned section", () => {
    const r = requiredSectionOwners(vacantPo, [edit("Only listed.", "Only listed ones."), edit("x\n", "y\n")], { [DOC]: BASE }, "dana");
    expect(r.owners.map((o) => o.handle)).to.deep.equal(["@pat"]);
    expect(r.owners[0]!.why).to.deep.equal([
      "`policies/org-policy.md` §3.1 (Engineering Owner — vacant, so the Policy Owner's alternate, the Policy Owner being vacant)",
      "`policies/org-policy.md` §6 (Policy Owner) — vacant, so its alternate approves",
    ]);
  });

  it("…and when the alternate is the author, the Check Owner approves instead", () => {
    const r = requiredSectionOwners(vacantPo, gov, {}, "pat");
    expect(r.owners).to.deep.equal([{ handle: "@chuck", why: ["`policies/governance.yaml` (governance choices) (Policy Owner) — vacant, so its alternate approves — its owner is the author, so the Check Owner approves instead"] }]);
  });

  it("a vacant Policy Owner and no alternate → still 'no handle', as before", () => {
    const r = requiredSectionOwners({ ownership, roles: { "Policy Owner": "", "Check Owner": "@chuck" } }, gov, {}, "dana");
    expect(r.owners).to.deep.equal([]);
    expect(r.notes.join()).to.contain("Policy Owner has no handle");
  });

  it("the check runs with the alternate as acting Policy Owner, and a violation record goes to them", () => {
    const ctx: EventContext = { resource: "vcs.gov-repo", event: "pull_request", payload: { changed: gov.map((f) => ({ ...f, addedLines: [] })), baseTexts: {}, author: "dana", approvals: [] } as EventContext["payload"] };
    const full = { framework: [], org: [], orgScope: "SVM", orgVersion: "1.0.0", catalog: { actions: [] }, ...vacantPo } as unknown as RuleSet;
    expect(sectionOwnerApproval("GOV-FRM-455", {}, ctx, full).requestReview).to.deep.equal(["pat"]);
    expect(actingPolicyOwner(vacantPo)).to.equal("@pat");
    expect(actingPolicyOwner({ roles: { "Policy Owner": "@polly" }, alternates: { "Policy Owner": "@pat" } })).to.equal("@polly");
    expect(actingPolicyOwner({ roles: { "Policy Owner": "" } })).to.equal(undefined);
  });

  it("solo mode stays right: a vacant Policy Owner's alternate who is the only person named, as author → solo", () => {
    const r = requiredSectionOwners({ ownership, roles: { "Policy Owner": "", "Check Owner": "" }, alternates: { "Policy Owner": "@pat" }, posture: "soft" }, gov, {}, "pat");
    expect(r.solo).to.equal(true);
    expect(r.selfApprovedMiss).to.contain(SELF_MERGED_SOLO);
    expect(soloMode({ roles: { "Policy Owner": "", "Check Owner": "" }, alternates: { "Policy Owner": "@pat" } }, "dana")).to.equal(false);
  });
});

// POLICY OWNER RULING Q45 C (PRJ-121, 2026-11-23): SOLO MODE. Nobody approves their own work — unchanged. Under soft
// posture, while nobody but the author holds any role or alternate, the miss says so in words the push reads back.
describe("requiredSectionOwners — solo mode (Q45 C)", () => {
  const solo = { ownership, roles: { "Policy Owner": "@solo", "Check Owner": "@solo", "Data Owner": "" } };
  const change = [edit("x\n", "y\n")];

  it("soft (or no posture): still a miss, with no owners — the finding carries the solo words and solo is set", () => {
    for (const posture of ["soft", undefined] as const) {
      const r = requiredSectionOwners({ ...solo, ...(posture ? { posture } : {}) }, change, { [DOC]: BASE }, "solo");
      expect(r.owners).to.deep.equal([]);
      expect(r.solo).to.equal(true);
      expect(r.selfApprovedMiss).to.contain(SELF_MERGED_SOLO).and.contain("solo mode").and.contain("an alternate");
    }
  });

  it("hard: nothing changes — the plain self-approved miss, no solo flag", () => {
    const r = requiredSectionOwners({ ...solo, posture: "hard" }, change, { [DOC]: BASE }, "solo");
    expect(r.solo).to.equal(undefined);
    expect(r.selfApprovedMiss).to.not.contain(SELF_MERGED_SOLO);
    expect(r.selfApprovedMiss).to.match(/self-approved\.$/);
  });

  it("someone else holds a role that cannot approve this change → a plain miss, not solo mode", () => {
    const r = requiredSectionOwners({ ...solo, roles: { ...solo.roles, "Data Owner": "@dana" }, posture: "soft" }, change, { [DOC]: BASE }, "solo");
    expect(r.solo).to.equal(undefined);
    expect(r.selfApprovedMiss).to.not.contain(SELF_MERGED_SOLO);
  });

  it("an alternate is a second person: solo mode ends and the alternate approves", () => {
    const r = requiredSectionOwners({ ...solo, alternates: { "Policy Owner": "@pat" }, posture: "soft" }, change, { [DOC]: BASE }, "solo");
    expect(r.solo).to.equal(undefined);
    expect(r.owners.map((o) => o.handle)).to.deep.equal(["@pat"]);
  });

  it("the check reports the distinct solo outcome: a miss with solo set, under soft only", () => {
    const ctx: EventContext = { resource: "vcs.gov-repo", event: "pull_request", payload: { changed: change.map((f) => ({ ...f, addedLines: [] })), baseTexts: { [DOC]: BASE }, author: "solo", approvals: [] } as EventContext["payload"] };
    const full = (posture: "soft" | "hard") => ({ framework: [], org: [], orgScope: "SVM", orgVersion: "1.0.0", catalog: { actions: [] }, ...solo, posture }) as unknown as RuleSet;
    const soft = sectionOwnerApproval("GOV-FRM-455", {}, ctx, full("soft"));
    expect(soft).to.deep.include({ verdict: "miss", solo: true });
    expect(soft.findings[0]).to.contain(SELF_MERGED_SOLO);
    const hard = sectionOwnerApproval("GOV-FRM-455", {}, ctx, full("hard"));
    expect(hard.verdict).to.equal("miss");
    expect(hard.solo).to.equal(undefined);
    expect(hard.findings[0]).to.not.contain(SELF_MERGED_SOLO);
  });

  it("soloMode: nobody but the author named anywhere; with no author, at most one person named", () => {
    expect(soloMode(solo, "Solo")).to.equal(true);
    expect(soloMode(solo)).to.equal(true);
    expect(soloMode({ roles: { "Policy Owner": "@solo" }, alternates: { "Data Owner": "@dev" } })).to.equal(false);
    expect(soloMode({ roles: { "Policy Owner": "@solo" } }, "bob")).to.equal(false);
  });
});

describe("sectionOwnersRulesFrom — the rule set's ownership and roles from the gov repo's texts", () => {
  const governance = "governance_posture: soft\npolicy_owner:\n  github: polly\ncheck_owner:\n  github: \"\"\n";
  const roleList = "# Reps\n\n| Role | GitHub handle | Owns |\n|------|---------------|------|\n| Data Owner | @dana | `knowledge/data/` |\n| Legal | vacant | |\n";
  const own = '- { doc: policies/org-policy.md, section: "4", role: Data Owner, sha: "0000004" }\n';

  it("roles as the check loads them: a vacant role — the Check Owner too (Q46 A) — as empty; the check routes it", () => {
    const r = sectionOwnersRulesFrom({ governance, roleList, ownership: own });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.rules.roles).to.deep.equal({ "Policy Owner": "polly", "Check Owner": "", "Data Owner": "@dana", Legal: "" });
    expect(r.rules.ownership).to.deep.equal([{ doc: DOC, section: "4", role: "Data Owner", sha: "0000004" }]);
    const owners = requiredSectionOwners(r.rules, [edit("Keep it safe.", "Keep.")], { [DOC]: BASE }, undefined).owners;
    expect(owners).to.deep.equal([{ handle: "@dana", why: ["`policies/org-policy.md` §4 (Data Owner)"] }]);
  });

  it("alternates from governance.yaml and the role list's Alternate column, and the posture (F143 A, Q45 C)", () => {
    const gov = "governance_posture: hard\npolicy_owner:\n  github: polly\n  alternate: \"@pat\"\ncheck_owner:\n  github: chuck\n  alternate: \"\"\n";
    const list = "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | @dana | `knowledge/data/` | @dev |\n| Legal | vacant | | |\n";
    const r = sectionOwnersRulesFrom({ governance: gov, roleList: list, ownership: own });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.rules.alternates).to.deep.equal({ "Policy Owner": "@pat", "Data Owner": "@dev" });
    expect(r.rules.posture).to.equal("hard");
    const old = sectionOwnersRulesFrom({ governance, roleList, ownership: own });
    expect(old.ok && old.rules.alternates).to.deep.equal({});
    expect(old.ok && old.rules.posture).to.equal("soft");
  });

  it("no ownership.yaml → no rows; an unreadable one is refused, never guessed", () => {
    const none = sectionOwnersRulesFrom({ governance, roleList: null, ownership: null });
    expect(none).to.deep.include({ ok: true });
    expect(sectionOwnersRulesFrom({ governance, roleList, ownership: "{ not: a list" }).ok).to.equal(false);
  });
});
