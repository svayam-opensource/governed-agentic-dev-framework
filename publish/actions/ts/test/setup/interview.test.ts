// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// The adopter interview asks for the Check Owner before anything is created (rule-model P1 rulings, 2026-10-06):
// the role must be assigned at setup, and the interview is the adopter path's only chance to ask.
import { expect } from "chai";
import { askOrgInterview } from "../../src/setup/interview.js";
import { deriveOrgConfig } from "../../src/setup/setup.js";

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
