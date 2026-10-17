// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE TWO-KEY REVIEW, AS DOCTOR SEES IT (rule-model P1 rulings, 2026-10-06). The Policy Owner approves what a rule
// means; the Check Owner approves the code that enforces it. Doctor says when the second key is missing (vacant)
// and when both keys are on one ring (one person holds both roles).
import { expect } from "chai";
import {
  checkOwnerDiagnostic, policyOwnerDiagnostic, roleListDiagnostic, codeownersDiagnostic, expectedCodeowners, TWO_KEY_OFF,
} from "../../src/maintain/roles-health.js";
import { doctor, type DoctorFacts } from "../../src/maintain/doctor.js";

// policies/governance.yaml since the org-config split — the two framework roles' holders live there.
const cfg = (policy: string, check?: string) =>
  `policy_owner:\n  github: "${policy}"\n${check === undefined ? "" : `check_owner:\n  github: "${check}"\n`}`;

describe("gov-work — doctor, the Check Owner", () => {
  it("no row when governance.yaml was not looked for — a row about a fact nobody gathered is worse than none", () => {
    expect(checkOwnerDiagnostic(undefined)).to.equal(null);
    expect(checkOwnerDiagnostic(null)!.status, "absent: nobody named — vacant").to.equal("warn");
  });

  it("ok when a different person holds it", () => {
    const d = checkOwnerDiagnostic(cfg("@carol", "@dave"))!;
    expect(d).to.include({ name: "check owner", status: "ok" });
    expect(d.detail).to.contain("@dave");
  });

  it("warns when one person holds both roles: intent and code are approved by one person", () => {
    for (const [p, c] of [["@carol", "@carol"], ["carol", "@Carol"]]) {
      const d = checkOwnerDiagnostic(cfg(p!, c!))!;
      expect(d.status).to.equal("warn");
      expect(d.detail).to.contain(TWO_KEY_OFF);
    }
    expect(TWO_KEY_OFF).to.equal("intent and code are approved by one person — the two-key review is off");
  });

  it("warns when the role is vacant (an upgraded org gets the key empty) — and says who approves instead", () => {
    for (const text of [cfg("@carol", ""), cfg("@carol")]) {
      const d = checkOwnerDiagnostic(text)!;
      expect(d.status).to.equal("warn");
      expect(d.detail).to.match(/vacant/);
      expect(d.detail).to.contain("GOV-FRM-033");
      expect(d.detail).to.contain("check_owner.github");
    }
  });

  it("appears in doctor's report when doctor has the governance.yaml text", () => {
    const facts: DoctorFacts = {
      gitPresent: true, ghPresent: true, activeOrg: "Acme", cliVersion: "1.0.0",
      resolve: { ok: true, home: "/gov", org: "Acme", via: "active-org" },
      governanceText: cfg("@carol", "@carol"),
    };
    const row = doctor(facts).diagnostics.find((d) => d.name === "check owner");
    expect(row?.status).to.equal("warn");
    expect(doctor(facts).ok, "a warning, never a failure").to.equal(true);
  });
});

// GOV-FRM-033: the framework's two roles each have a named holder, and doctor reports either one when it is vacant.
describe("gov-work — doctor, the Policy Owner", () => {
  it("GOV-FRM-033 doctor reports a vacant Policy Owner — a failure: nobody can approve anything", () => {
    for (const text of [cfg(""), cfg("   "), "governance_posture: soft\n", null]) {
      const d = policyOwnerDiagnostic(text)!;
      expect(d).to.include({ name: "policy owner", status: "fail" });
      expect(d.detail).to.match(/vacant/);
      expect(d.detail).to.contain("policy_owner.github");
      expect(d.detail).to.contain("GOV-FRM-033");
    }
    const facts: DoctorFacts = {
      gitPresent: true, ghPresent: true, activeOrg: "Acme", cliVersion: "1.0.0",
      resolve: { ok: true, home: "/gov", org: "Acme", via: "active-org" }, governanceText: cfg(""),
    };
    expect(doctor(facts).diagnostics.find((d) => d.name === "policy owner")?.status).to.equal("fail");
    expect(doctor(facts).ok).to.equal(false);
  });

  it("ok, naming the holder, when there is one; no row when no config was examined", () => {
    expect(policyOwnerDiagnostic(cfg("carol"))).to.deep.include({ name: "policy owner", status: "ok" });
    expect(policyOwnerDiagnostic(cfg("carol"))!.detail).to.contain("@carol");
    expect(policyOwnerDiagnostic(undefined)).to.equal(null);
    expect(policyOwnerDiagnostic(null)!.detail, "absent: says which command writes it").to.contain("gov upgrade");
  });
});

// W2-Q5: the org's roles come from its role list — no fallback to the retired *_owner_github keys since the split.
describe("gov-work — doctor, the org's role list", () => {
  const LIST = "# Reps\n\n| Role | GitHub handle | Owns |\n|---|---|---|\n| Data Owner | @dana | `knowledge/data/` |\n| Legal Owner | | `knowledge/legal/` |\n";

  it("ok with the table: how many roles, and which are vacant (the Policy Owner holds them)", () => {
    const d = roleListDiagnostic(LIST)!;
    expect(d).to.include({ name: "role list", status: "ok" });
    expect(d.detail).to.contain("2 role(s)");
    expect(d.detail).to.match(/vacant.*Legal Owner/);
  });

  it("warns with no table: the org defines no roles, and the Policy Owner owns every folder", () => {
    for (const text of [null, "# Reps\n\nNo table yet.\n"]) {
      const d = roleListDiagnostic(text)!;
      expect(d.status).to.equal("warn");
      expect(d.detail).to.match(/no role table/);
      expect(d.detail).to.match(/Policy Owner owns/);
      expect(d.detail).to.not.contain("_owner_github");
    }
  });

  it("warns on a row gov cannot route, and says which", () => {
    const d = roleListDiagnostic(`${LIST}| Web Owner | @web | \`site/\` |\n`)!;
    expect(d.status).to.equal("warn");
    expect(d.detail).to.match(/site\/.*not under knowledge\//);
  });

  it("no row when the document was not read", () => {
    expect(roleListDiagnostic(undefined)).to.equal(null);
  });
});

// GOV-FRM-083: gov generates CODEOWNERS; doctor flags a copy that no longer routes the way gov would write it.
describe("gov-work — doctor, CODEOWNERS", () => {
  const CFG = cfg("@carol", "@dave");
  const LIST = "| Role | GitHub handle | Owns |\n|---|---|---|\n| Data Owner | @dana | `knowledge/data/` |\n";
  const generated = expectedCodeowners(CFG, LIST)!;

  it("ok when the file routes exactly as gov would generate it", () => {
    expect(codeownersDiagnostic(CFG, LIST, generated)).to.deep.include({ name: "codeowners", status: "ok" });
  });

  it("GOV-FRM-083 doctor flags a hand-edited CODEOWNERS that has drifted from the role list", () => {
    const edited = generated.replace(/^(\/knowledge\/data\/\s+)@dana$/m, "$1@mallory");
    const d = codeownersDiagnostic(CFG, LIST, edited)!;
    expect(d.status).to.equal("warn");
    expect(d.detail).to.match(/drift|no longer matches/);
    expect(d.detail).to.contain("/knowledge/data/ @dana");
    expect(d.detail).to.contain("gov upgrade");
    // A holder changed in the role list but CODEOWNERS not regenerated is the same drift, seen from the other side.
    expect(codeownersDiagnostic(CFG, LIST.replace("@dana", "@dora"), generated)!.status).to.equal("warn");
  });

  it("warns when there is no CODEOWNERS at all — nothing routes a review", () => {
    const d = codeownersDiagnostic(CFG, LIST, null)!;
    expect(d.status).to.equal("warn");
    expect(d.detail).to.match(/no CODEOWNERS/);
  });

  it("no row without a Policy Owner (that row already fails) or without the file having been looked for", () => {
    expect(codeownersDiagnostic(cfg(""), LIST, generated)).to.equal(null);
    expect(codeownersDiagnostic(CFG, LIST, undefined)).to.equal(null);
  });

  it("doctor shows all three rows when it has the texts", () => {
    const rows = doctor({
      gitPresent: true, ghPresent: true, activeOrg: "Acme", cliVersion: "1.0.0",
      resolve: { ok: true, home: "/gov", org: "Acme", via: "active-org" },
      governanceText: CFG, roleListText: LIST, codeownersText: generated,
    }).diagnostics.map((d) => d.name);
    expect(rows).to.include.members(["policy owner", "check owner", "role list", "codeowners"]);
  });
});
