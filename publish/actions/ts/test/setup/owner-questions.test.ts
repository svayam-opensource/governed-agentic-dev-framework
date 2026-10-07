// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE ADOPTION WALK (Rocky 9, org svm-geneva, 2026-10-07), findings #1 and #3.
//
// #1 — setup asked the Policy Owner's EMAIL but never their GitHub handle, and silently took the signed-in gh user;
// the Check Owner was asked by handle. Ruling (Policy Owner, 2026-10-07): both roles asked by handle, in the same
// form, then the email as an OPTIONAL contact shown in the policies.
//   Q8 Policy Owner handle (default: the signed-in user) · Q9 Check Owner handle (default: the Policy Owner)
//   Q10 contact email (optional; default: the git email)  · Q11 posture · Q12 agents
//
// #3 — a numbered question printed `Choose [1/2] :` while "1" was the default. Every numbered question says what
// Enter does, and names the option.
import { expect } from "chai";
import { askOrgInterview } from "../../src/setup/interview.js";
import { deriveOrgConfig } from "../../src/setup/setup.js";
import { runSetup } from "../../src/setup/setup-run.js";
import { governanceTokens, parseGovernance } from "../../src/config/governance.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";
import { agentAnswer } from "../helpers/agents-answer.js";

const pxKeys = (m: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(m).map(([k, v]) => [px(k), v]));

const CTX = { originUrl: "", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-10-07" };

async function interview(reply: (q: string) => string) {
  const asked: string[] = [];
  const r = await askOrgInterview({
    prompt: async (q) => { asked.push(q); return reply(q); },
    print: () => {},
    derive: (partial) => deriveOrgConfig(partial, CTX),
  });
  return { r, asked };
}
const base = (q: string): string => (/^Q1 /.test(q) ? "Acme Inc" : /^Q3 /.test(q) ? "acme" : "");
const ask = (asked: readonly string[], n: number): string => asked.find((q) => q.startsWith(`Q${n} - `)) ?? "";

describe("gov-work — setup asks both owners by GitHub handle (walk #1)", () => {
  it("Q8 asks the Policy Owner's GitHub handle, offering the signed-in user", async () => {
    const { r, asked } = await interview((q) => (/^Q8 /.test(q) ? "@alice" : base(q)));
    expect(ask(asked, 8)).to.match(/Policy Owner/).and.match(/GitHub handle/).and.contain("[@rk]");
    expect(r!.answers.policyOwnerGithub).to.equal("@alice");
  });

  it("Q9 asks the Check Owner in the same form, defaulting to the Policy Owner just named", async () => {
    const { r, asked } = await interview((q) => (/^Q8 /.test(q) ? "@alice" : base(q)));
    expect(ask(asked, 9)).to.match(/Check Owner/).and.match(/GitHub handle/).and.contain("[@alice]");
    expect(r!.answers.checkOwnerGithub).to.equal("@alice");
  });

  it("Q10 asks a contact email, OPTIONAL — the git email is offered, and `none` leaves it empty", async () => {
    const { r, asked } = await interview(base);
    expect(ask(asked, 10)).to.match(/email/i).and.match(/optional/i).and.contain("[rk@acme.io]");
    expect(r!.answers.policyOwnerEmail).to.equal("rk@acme.io");
    const none = await interview((q) => (/^Q10 /.test(q) ? "none" : base(q)));
    expect(none.r!.answers.policyOwnerEmail).to.equal("");
  });

  it("an email that is not one is still refused, and asked again", async () => {
    let n = 0;
    const { r } = await interview((q) => (/^Q10 /.test(q) ? (n++ === 0 ? "not-an-email" : "po@acme.io") : base(q)));
    expect(r!.answers.policyOwnerEmail).to.equal("po@acme.io");
  });

  it("the posture is Q11 now, and nothing is asked twice", async () => {
    const { asked } = await interview(base);
    expect(ask(asked, 11)).to.match(/governance posture/);
    const numbers = asked.map((q) => /^Q(\d+) - /.exec(q)?.[1]).filter(Boolean);
    expect(numbers).to.deep.equal(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  });

  it("configure-in-place asks the Policy Owner's handle too — never takes the gh login silently", async () => {
    const writes: Record<string, string> = {};
    const asked: Array<[string, string]> = [];
    const fs = { writeFile: (f: string, c: string) => { writes[f] = c; }, pathExists: () => false, readFile: () => null, mkdirp: () => {}, rm: () => {}, readdir: () => [] } as unknown as Fs;
    const code = await runSetup({
      fs, cwd: "/repo", originUrl: "git@github.com:acme/acme-gov.git", ghUser: "rk", gitEmail: "rk@acme.io", today: CTX.today,
      prompt: async (q, def) => {
        asked.push([q, def]);
        if (/legal name/.test(q)) return "Acme Inc";
        if (/Org slug/.test(q)) return "ACME";
        if (/Policy Owner GitHub handle/.test(q)) return "@alice";
        return agentAnswer(q) ?? def;
      },
      print: () => {},
    }, true);
    expect(code).to.equal(0);
    const po = asked.find(([q]) => /Policy Owner GitHub handle/.test(q));
    expect(po, "the Policy Owner's handle is asked").to.not.equal(undefined);
    expect(po![1]).to.equal("@rk");
    const ck = asked.find(([q]) => /Check Owner GitHub handle/.test(q));
    expect(ck![1], "the Check Owner defaults to the handle just given").to.equal("@alice");
    const order = asked.map(([q]) => q).filter((q) => /Policy Owner GitHub handle|Check Owner GitHub handle|email/i.test(q));
    expect(order.map((q) => (/Policy Owner GitHub/.test(q) ? "po" : /Check Owner/.test(q) ? "ck" : "email"))).to.deep.equal(["po", "ck", "email"]);
    expect(pxKeys(writes)["/repo/policies/governance.yaml"]).to.match(/^policy_owner:\n {2}email: "rk@acme.io"\n {2}github: "@alice"$/m);
  });
});

describe("gov-work — a numbered question says what Enter does (walk #3)", () => {
  it("every Choose prompt names its default, and the option it stands for", async () => {
    const { asked } = await interview(base);
    const choices = asked.filter((q) => /Choose \[/.test(q));
    expect(choices.length, "Q6 and Q11 are numbered").to.be.at.least(2);
    for (const q of choices) expect(q, q).to.match(/Choose \[[^\]]+\] \(Enter = \d+/);
    expect(ask(asked, 6)).to.contain("Choose [1/2] (Enter = 1, main) : ");
    expect(ask(asked, 11)).to.contain("Choose [1/2] (Enter = 1, soft) : ");
  });

  it("the default it shows is the one Enter takes", async () => {
    const { r } = await interview(base);
    expect(r!.answers.defaultBranch).to.equal("main");
    expect(r!.answers.governancePosture).to.equal("soft");
  });
});

describe("gov-work — no contact email is a real answer (walk #1)", () => {
  it("the policies name the Policy Owner by handle when no email was given — never a literal <POLICY_OWNER_EMAIL>", () => {
    const tokens = governanceTokens(parseGovernance('policy_owner:\n  email: ""\n  github: "@alice"\n'));
    expect(tokens.POLICY_OWNER_EMAIL).to.equal("@alice");
    expect(governanceTokens(parseGovernance('policy_owner:\n  email: "po@acme.io"\n  github: "@alice"\n')).POLICY_OWNER_EMAIL).to.equal("po@acme.io");
  });
});
