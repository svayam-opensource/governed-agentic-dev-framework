// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov doctor` ON ALTERNATES AND SOLO MODE (Policy Owner rulings F143 A and Q45 C, 2026-11-23). A role with no
// alternate is reported, advisory (warn), the way a vacant Check Owner is. Solo mode — nobody but one person named in
// any role or alternate — is reported too, saying what it means under the posture.
import { expect } from "chai";
import { alternatesDiagnostic, soloModeDiagnostic } from "../../src/maintain/roles-health.js";

const gov = (o: { posture?: string; po?: string; poAlt?: string; co?: string; coAlt?: string } = {}) =>
  `governance_posture: "${o.posture ?? "soft"}"\npolicy_owner:\n  github: "${o.po ?? "polly"}"\n  alternate: "${o.poAlt ?? ""}"\ncheck_owner:\n  github: "${o.co ?? ""}"\n  alternate: "${o.coAlt ?? ""}"\n`;
const LIST = "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | @dana | — | @dev |\n| Legal Owner | @lex | — | |\n";

describe("gov doctor — alternates (F143 A)", () => {
  it("names each role with no alternate, as a warning, never a failure", () => {
    const d = alternatesDiagnostic(gov({ poAlt: "pat" }), LIST)!;
    expect(d.status).to.equal("warn");
    expect(d.detail).to.contain("no alternate for Check Owner, Legal Owner").and.not.contain("Data Owner,");
  });
  it("every role with an alternate → ok", () => {
    const d = alternatesDiagnostic(gov({ poAlt: "pat", coAlt: "cora" }), LIST.replace("| @lex | — | |", "| @lex | — | @lee |"))!;
    expect(d).to.deep.include({ status: "ok" });
  });
  it("an old role list with no Alternate column reports every role, and parses", () => {
    const d = alternatesDiagnostic(gov(), "| Role | GitHub handle | Owns |\n|---|---|---|\n| Data Owner | @dana | — |\n")!;
    expect(d.detail).to.contain("Policy Owner, Check Owner, Data Owner");
  });
  it("nobody looked → no row", () => {
    expect(alternatesDiagnostic(undefined, LIST)).to.equal(null);
  });
});

describe("gov doctor — solo mode (Q45 C)", () => {
  it("one person in every role, no alternates → a warning that says how a merge is recorded under soft", () => {
    const d = soloModeDiagnostic(gov({ co: "polly" }), null)!;
    expect(d.status).to.equal("warn");
    expect(d.detail).to.contain("@polly").and.contain("self-merged: no second person").and.contain("not as a violation");
  });
  it("under hard it says such a change cannot merge", () => {
    expect(soloModeDiagnostic(gov({ posture: "hard" }), null)!.detail).to.contain("cannot merge").and.not.contain("self-merged");
  });
  it("a second person anywhere — a role holder or an alternate — → no row", () => {
    expect(soloModeDiagnostic(gov({ co: "chuck" }), null)).to.equal(null);
    expect(soloModeDiagnostic(gov({ poAlt: "pat" }), null)).to.equal(null);
    expect(soloModeDiagnostic(gov(), LIST)).to.equal(null);
  });
  it("no Policy Owner → no row (the policy-owner row fails already)", () => {
    expect(soloModeDiagnostic(gov({ po: "" }), null)).to.equal(null);
  });
});
