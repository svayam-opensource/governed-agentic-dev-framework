// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE TWO-KEY REVIEW, AS DOCTOR SEES IT (rule-model P1 rulings, 2026-10-06). The Policy Owner approves what a rule
// means; the Check Owner approves the code that enforces it. Doctor says when the second key is missing (vacant)
// and when both keys are on one ring (one person holds both roles).
import { expect } from "chai";
import { checkOwnerDiagnostic, TWO_KEY_OFF } from "../../src/maintain/roles-health.js";
import { doctor, type DoctorFacts } from "../../src/maintain/doctor.js";

const cfg = (policy: string, check?: string) =>
  `org_name: "Acme"\npolicy_owner_github: "${policy}"\n${check === undefined ? "" : `check_owner_github: "${check}"\n`}`;

describe("gov-work — doctor, the Check Owner", () => {
  it("no row when no config was examined — a row about a fact nobody gathered is worse than none", () => {
    expect(checkOwnerDiagnostic(null)).to.equal(null);
    expect(checkOwnerDiagnostic(undefined)).to.equal(null);
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
      expect(d.detail).to.contain("POL-034");
      expect(d.detail).to.contain("check_owner_github");
    }
  });

  it("appears in doctor's report when doctor has the org-config text", () => {
    const facts: DoctorFacts = {
      gitPresent: true, ghPresent: true, activeOrg: "Acme", cliVersion: "1.0.0",
      resolve: { ok: true, home: "/gov", org: "Acme", via: "active-org" },
      orgConfigText: cfg("@carol", "@carol"),
    };
    const row = doctor(facts).diagnostics.find((d) => d.name === "check owner");
    expect(row?.status).to.equal("warn");
    expect(doctor(facts).ok, "a warning, never a failure").to.equal(true);
  });
});
