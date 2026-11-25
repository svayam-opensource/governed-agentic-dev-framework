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
import { runSetup } from "../../src/setup/setup-run.js";
import { governanceTokens, parseGovernance } from "../../src/config/governance.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";
import { agentAnswer } from "../helpers/agents-answer.js";

const pxKeys = (m: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(m).map(([k, v]) => [px(k), v]));

const CTX = { originUrl: "", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-10-07" };


describe("gov-work — setup asks both owners by GitHub handle (walk #1)", () => {
  // F158: the founding interview no longer asks the owners (the Policy Owner is the signed-in login, no second person,
  // no email) — test/setup/interview.test.ts holds that. Configure-in-place still asks them, below.
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
    // Q44 A: the second person is optional — Enter is `none`, and the Policy Owner stays Check Owner.
    const ck = asked.find(([q]) => /approve your own changes/.test(q));
    expect(ck![1], "the second person defaults to none").to.equal("none");
    const order = asked.map(([q]) => q).filter((q) => /Policy Owner GitHub handle|approve your own changes|email/i.test(q));
    expect(order.map((q) => (/Policy Owner GitHub/.test(q) ? "po" : /your own changes/.test(q) ? "ck" : "email"))).to.deep.equal(["po", "ck", "email"]);
    expect(pxKeys(writes)["/repo/policies/governance.yaml"]).to.match(/^check_owner:\n {2}github: "@alice"$/m);
    expect(pxKeys(writes)["/repo/policies/governance.yaml"]).to.match(/^policy_owner:\n {2}email: "rk@acme.io"\n {2}github: "@alice"$/m);
  });
});

describe("gov-work — no contact email is a real answer (walk #1)", () => {
  it("the policies name the Policy Owner by handle when no email was given — never a literal <POLICY_OWNER_EMAIL>", () => {
    const tokens = governanceTokens(parseGovernance('policy_owner:\n  email: ""\n  github: "@alice"\n'));
    expect(tokens.POLICY_OWNER_EMAIL).to.equal("@alice");
    expect(governanceTokens(parseGovernance('policy_owner:\n  email: "po@acme.io"\n  github: "@alice"\n')).POLICY_OWNER_EMAIL).to.equal("po@acme.io");
  });
});
