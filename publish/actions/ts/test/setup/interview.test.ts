// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// The adopter interview asks for the Check Owner before anything is created (rule-model P1 rulings, 2026-10-06):
// the role must be assigned at setup, and the interview is the adopter path's only chance to ask.
import { expect } from "chai";
import { askOrgInterview } from "../../src/setup/interview.js";
import { deriveOrgConfig, renderOrgConfig, readExistingOrgConfig } from "../../src/setup/setup.js";
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
  const base = (q: string): string => (/^Q1 /.test(q) ? "Acme Inc" : /^Q3 /.test(q) ? "acme" : /^Q8 /.test(q) ? "rk@acme.io" : "");

  it("asks Q10 for the Check Owner, defaulting to the Policy Owner, and keeps the answer", async () => {
    const { r, asked } = await run((q) => (/^Q10 /.test(q) ? "@dave" : base(q)));
    const q10 = asked.find((q) => /^Q10 /.test(q));
    expect(q10).to.match(/Check Owner/);
    expect(q10).to.contain("[@rk]");
    expect(r!.answers.checkOwnerGithub).to.equal("@dave");
  });

  it("Enter accepts the Policy Owner", async () => {
    const { r } = await run(base);
    expect(r!.answers.checkOwnerGithub).to.equal("@rk");
  });

  it("refuses FRM as the identifier and asks again", async () => {
    let n = 0;
    const { r } = await run((q) => (/^Q5 /.test(q) ? (n++ === 0 ? "FRM" : "ACME") : base(q)));
    expect(r!.answers.orgSlug).to.equal("ACME");
  });
});

// W2-Q6 (Policy Owner, 2026-10-06): posture defaults to soft; hard is chosen past a confirmation, default N.
describe("gov-work — the adopter interview, governance posture", () => {
  const base = (q: string): string => (/^Q1 /.test(q) ? "Acme Inc" : /^Q3 /.test(q) ? "acme" : /^Q8 /.test(q) ? "rk@acme.io" : "");

  it("asks Q11 for the posture; Enter is soft and asks nothing more", async () => {
    const { r, asked } = await run(base);
    expect(asked.find((q) => /^Q11 /.test(q))).to.match(/governance posture/).and.contain("Choose [1/2]");
    expect(asked.some((q) => q.startsWith(HARD_POSTURE_CONFIRMATION))).to.equal(false);
    expect(r!.answers.governancePosture).to.equal("soft");
  });

  it("hard shows the confirmation VERBATIM; y keeps hard", async () => {
    const { r, asked } = await run((q) => (/^Q11 /.test(q) ? "2" : q.startsWith("Choosing") ? "y" : base(q)));
    expect(asked.some((q) => q.startsWith(HARD_POSTURE_CONFIRMATION))).to.equal(true);
    expect(r!.answers.governancePosture).to.equal("hard");
  });

  it("the confirmation defaults to N — Enter (or anything but yes) is soft", async () => {
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

  it("org-config.yaml records the posture, and a re-run reads it back", () => {
    const v = deriveOrgConfig({ orgName: "Acme", orgSlug: "ACME", governancePosture: "hard" }, CTX);
    const text = renderOrgConfig(v);
    expect(text).to.match(/^governance_posture: "hard"$/m);
    expect(readExistingOrgConfig(text).governancePosture).to.equal("hard");
    expect(renderOrgConfig(deriveOrgConfig({ orgName: "Acme", orgSlug: "ACME" }, CTX))).to.match(/^governance_posture: "soft"$/m);
  });
});
