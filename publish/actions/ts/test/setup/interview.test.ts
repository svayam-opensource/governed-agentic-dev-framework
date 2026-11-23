// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// The adopter interview asks for the Check Owner before anything is created (rule-model P1 rulings, 2026-10-06):
// the role must be assigned at setup, and the interview is the adopter path's only chance to ask.
import { expect } from "chai";
import { askOrgInterview } from "../../src/setup/interview.js";
import { deriveOrgConfig, renderOrgConfig, renderSetupGovernance, readExistingOrgConfig } from "../../src/setup/setup.js";
import { HARD_POSTURE_CONFIRMATION } from "../../src/setup/posture-question.js";

const CTX = { originUrl: "", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04" };

async function run(reply: (q: string) => string) {
  const asked: string[] = [];
  const r = await askOrgInterview({
    prompt: async (q) => { asked.push(q); return reply(q); },
    print: () => {},
    derive: (partial) => deriveOrgConfig(partial, CTX),
  });
  return { r, asked };
}

describe("gov-work — the adopter interview, Check Owner", () => {
  const base = (q: string): string => (/^Q1 /.test(q) ? "Acme Inc" : /^Q3 /.test(q) ? "acme" : "");

  // Q44 A (2026-11-23): Q9 asks for a SECOND PERSON — who approves the Policy Owner's own changes — named Check Owner.
  it("asks Q9 for the second person, named Check Owner; the default is none; a handle is kept", async () => {
    const { r, asked } = await run((q) => (/^Q9 /.test(q) ? "@dave" : base(q)));
    const q9 = asked.find((q) => /^Q9 /.test(q));
    expect(q9).to.match(/approve your own changes/).and.match(/Check Owner/).and.match(/optional/i);
    expect(q9).to.contain("[none]");
    expect(r!.answers.checkOwnerGithub).to.equal("@dave");
  });

  it("Enter (none) keeps the Policy Owner as Check Owner", async () => {
    const { r } = await run(base);
    expect(r!.answers.checkOwnerGithub).to.equal("@rk");
  });

  it("refuses the Policy Owner's own handle (any case, with or without @) and a malformed one, then asks again", async () => {
    for (const bad of ["rk", "@RK", "not a handle"]) {
      let n = 0;
      const printed: string[] = [];
      const r = await askOrgInterview({
        prompt: async (q) => (/^Q9 /.test(q) ? (n++ === 0 ? bad : "@dave") : base(q)),
        print: (l) => printed.push(l),
        derive: (partial) => deriveOrgConfig(partial, CTX),
      });
      expect(r!.answers.checkOwnerGithub, bad).to.equal("@dave");
      expect(printed.join("\n"), bad).to.match(/is the Policy Owner|is not a GitHub handle/);
    }
  });

  it("refuses FRM as the identifier and asks again", async () => {
    let n = 0;
    const { r } = await run((q) => (/^Q5 /.test(q) ? (n++ === 0 ? "FRM" : "ACME") : base(q)));
    expect(r!.answers.orgSlug).to.equal("ACME");
  });
});

// W2-Q6 (Policy Owner, 2026-10-06): posture defaults to soft; hard is chosen past a confirmation, default N.
describe("gov-work — the adopter interview, governance posture", () => {
  const base = (q: string): string => (/^Q1 /.test(q) ? "Acme Inc" : /^Q3 /.test(q) ? "acme" : "");

  it("GOV-FRM-450 asks Q11 for the posture; Enter is soft and asks nothing more", async () => {
    const { r, asked } = await run(base);
    expect(asked.find((q) => /^Q11 /.test(q))).to.match(/governance posture/).and.contain("Choose [1/2]");
    expect(asked.some((q) => q.startsWith(HARD_POSTURE_CONFIRMATION))).to.equal(false);
    expect(r!.answers.governancePosture).to.equal("soft");
  });

  it("GOV-FRM-450 hard shows the confirmation VERBATIM; y keeps hard (a second person was named)", async () => {
    const { r, asked } = await run((q) => (/^Q11 /.test(q) ? "2" : /^Q9 /.test(q) ? "@dave" : q.startsWith("Choosing") ? "y" : base(q)));
    expect(asked.some((q) => q.startsWith(HARD_POSTURE_CONFIRMATION))).to.equal(true);
    expect(r!.answers.governancePosture).to.equal("hard");
  });

  // Q44 A: hard needs a second person. With none, setup records soft and says why — no confirmation is asked.
  it("Q44 A: hard with no second person → soft, said plainly, with the way to switch; no confirmation", async () => {
    const asked: string[] = [];
    const printed: string[] = [];
    const r = await askOrgInterview({
      prompt: async (q) => { asked.push(q); return /^Q11 /.test(q) ? "2" : q.startsWith("Choosing") ? "y" : base(q); },
      print: (l) => printed.push(l),
      derive: (partial) => deriveOrgConfig(partial, CTX),
    });
    expect(r!.answers.governancePosture).to.equal("soft");
    expect(asked.some((q) => q.startsWith(HARD_POSTURE_CONFIRMATION)), "no confirmation for an answer that cannot stand").to.equal(false);
    const said = printed.join("\n");
    expect(said).to.contain("Hard posture needs a second person to approve the Policy Owner's own changes");
    expect(said).to.contain("starts with soft posture");
    expect(said).to.contain("`check_owner.github` in policies/governance.yaml").and.contain("`governance_posture: hard`").and.contain("gov repo protect apply");
    expect(asked.findIndex((q) => /^Q9 /.test(q)), "the second person is asked before the posture").to.be.lessThan(asked.findIndex((q) => /^Q11 /.test(q)));
  });

  it("GOV-FRM-450 the confirmation defaults to N — Enter (or anything but yes) is soft", async () => {
    for (const reply of ["", "n", "maybe"]) {
      const { r } = await run((q) => (/^Q11 /.test(q) ? "hard" : q.startsWith("Choosing") ? reply : base(q)));
      expect(r!.answers.governancePosture, JSON.stringify(reply)).to.equal("soft");
    }
  });

  it("the confirmation text is the Policy Owner's, word for word", () => {
    expect(HARD_POSTURE_CONFIRMATION).to.equal([
      'Choosing "hard" requires your repositories to be public, or a paid GitHub plan.',
      "hard — the action (for example a merge) is stopped when a policy violation is detected.",
      "soft — a violation record is opened so the Policy Owner can review it later.",
      'Do you still want the governance posture to be "hard"? [y/N]',
    ].join("\n"));
  });

  it("GOV-FRM-450 policies/governance.yaml records the posture (org-config.yaml no longer does), and a re-run reads it back", () => {
    const v = deriveOrgConfig({ orgName: "Acme", orgSlug: "ACME", governancePosture: "hard" }, CTX);
    const gov = renderSetupGovernance(v);
    expect(gov).to.match(/^governance_posture: "hard"$/m);
    expect(renderOrgConfig(v)).to.not.match(/governance_posture/);
    expect(readExistingOrgConfig(renderOrgConfig(v), gov).governancePosture).to.equal("hard");
    expect(renderSetupGovernance(deriveOrgConfig({ orgName: "Acme", orgSlug: "ACME" }, CTX))).to.match(/^governance_posture: "soft"$/m);
  });

  it("no longer asks for a policy effective date — the key is retired", async () => {
    const { asked } = await run(base);
    expect(asked.join("\n")).to.not.match(/effective date/i);
  });
});
