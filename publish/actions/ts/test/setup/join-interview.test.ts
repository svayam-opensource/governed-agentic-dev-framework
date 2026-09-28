// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The JOINER's third question — which of the organization's authorized agents they will use — and
 * the answer it has to cope with: the organization authorized none.
 *
 * An empty list used to be indistinguishable from "gov could not tell", so a person arriving at a
 * structure-only organization was silently not asked, met no agent, and had no way to know whether
 * that was the org's rule or a broken install.
 */
import { expect } from "chai";
import { askJoinInterview, type JoinInterviewIo } from "../../src/setup/join-interview.js";

function io(over: Partial<JoinInterviewIo> = {}): { io: JoinInterviewIo; out: string[] } {
  const out: string[] = [];
  const answers: Record<string, string> = {};
  return {
    out,
    io: {
      print: (l) => out.push(l),
      prompt: async (q, def) => {
        if (/Github Organization ID/.test(q)) return "acme";
        if (/name of your org/.test(q)) return "acme-gov";
        return answers[q] ?? def;
      },
      myOrgs: () => [],
      governanceReposIn: () => ["acme/acme-gov"],
      ...over,
    },
  };
}

describe("gov-work — joining an organization that authorizes NO agents", () => {
  it("states the organization's rule instead of silently skipping the question", async () => {
    const { io: j, out } = io({ approvedAgentsIn: () => [] });
    const r = await askJoinInterview(j);
    expect(r?.repo).to.equal("acme-gov");
    expect(r?.agent, "there is nothing to choose, so nothing is chosen").to.equal(undefined);
    const text = out.join("\n");
    expect(text).to.contain("Your organization does not use AI agents");
    expect(text, "and what gov does instead, which is the point").to.contain("projects, tasks, branches");
    expect(text, "and the way to propose a change").to.contain("gov agent approve <id>");
    expect(text, "never a list of one to pick from").to.not.contain("Which would you like to use");
  });

  it("says NOTHING when gov could not tell — a probe that failed is not a decision", async () => {
    // Saying "your organization does not use AI agents" on a failed read would state a policy the
    // organization never set, to the one person least able to check it.
    const { io: j, out } = io({ approvedAgentsIn: () => null });
    await askJoinInterview(j);
    expect(out.join("\n")).to.not.contain("does not use AI agents");
  });

  it("still tells a joiner which single agent the org DID authorize", async () => {
    const { io: j, out } = io({ approvedAgentsIn: () => [{ id: "ibm-bob", default: true }] });
    const r = await askJoinInterview(j);
    expect(r?.agent).to.equal("ibm-bob");
    expect(out.join("\n")).to.contain("has authorized one AI agent: IBM Bob");
  });
});
