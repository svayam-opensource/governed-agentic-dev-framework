// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// The adopter interview asks for the Check Owner before anything is created (rule-model P1 rulings, 2026-10-06):
// the role must be assigned at setup, and the interview is the adopter path's only chance to ask.
import { expect } from "chai";
import { askOrgInterview, InterviewRefused, NEW_GOV_REPO, settledSummary } from "../../src/setup/interview.js";
import { deriveOrgConfig, renderOrgConfig, renderSetupGovernance, readExistingOrgConfig } from "../../src/setup/setup.js";
import { HARD_POSTURE_CONFIRMATION } from "../../src/setup/posture-question.js";

const CTX = { originUrl: "", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04" };

async function run(reply: (q: string) => string, over: Partial<Parameters<typeof askOrgInterview>[0]> = {}) {
  const asked: string[] = [];
  const printed: string[] = [];
  const r = await askOrgInterview({
    prompt: async (q) => { asked.push(q); return reply(q); },
    print: (l) => printed.push(l),
    derive: (partial) => deriveOrgConfig(partial, CTX),
    ...over,
  });
  return { r, asked, printed };
}

const base = (q: string): string => (/^Q1 /.test(q) ? "acme" : "");
const numbers = (asked: readonly string[]): readonly string[] => asked.map((q) => /^Q(\d+) - /.exec(q)?.[1]).filter((n): n is string => !!n);

// F158 (Policy Owner rulings, 2026-11-25): THREE questions — the organization, its identifier, its agents.
describe("gov-work — the adopter interview asks three questions (F158)", () => {
  it("asks Q1 the GitHub organization FIRST, then Q2 the identifier — and nothing else", async () => {
    const { asked } = await run(base);
    expect(numbers(asked)).to.deep.equal(["1", "2"]);
    expect(asked[0]).to.match(/^Q1 - What is the GitHub organization/);
    expect(asked[1]).to.match(/^Q2 - What would you like the identifier/).and.contain("[ACME]");
  });

  it("asks Q3 the agents when the environment records them — the default first, then the others", async () => {
    const { r, printed } = await run((q) => (/^Q1 /.test(q) ? "acme" : /one or more/.test(q) ? "" : /^\s*Choose \[1\//.test(q) ? "8" : /Y\/n/.test(q) ? "y" : ""), { selectAgents: true });
    expect(printed).to.include("Q3 - Which AI agent would you like to use as the default in your organization?");
    expect(r!.agents).to.deep.equal([{ id: "ibm-bob", default: true }]);
  });

  it("defaults every other value as ruled", async () => {
    const { r } = await run(base);
    expect(r!.repo).to.equal(NEW_GOV_REPO).and.equal("gov_repo");
    expect(r!.answers).to.include({
      githubOrg: "acme", orgSlug: "ACME", orgName: "acme", orgShortName: "acme", workspaceRepo: "gov_repo",
      defaultBranch: "main", defaultCodeBranch: "dev", policyOwnerGithub: "@rk", checkOwnerGithub: "@rk",
      policyOwnerEmail: "", governancePosture: "soft",
    });
  });

  it("the names come from GitHub's display name for the organization, the login when it has none", async () => {
    const named = await run(base, { orgDisplayName: () => "Acme Incorporated" });
    expect(named.r!.answers.orgName).to.equal("Acme Incorporated");
    expect(named.r!.answers.orgShortName).to.equal("Acme Incorporated");
    const blank = await run(base, { orgDisplayName: () => "  " });
    expect(blank.r!.answers.orgName).to.equal("acme");
  });

  it("prints EVERY value used — asked and defaulted — and where each one is changed later", async () => {
    const { printed } = await run(base, { orgDisplayName: () => "Acme Inc" });
    const text = printed.join("\n");
    for (const w of ["GitHub organization", "acme", "Organization identifier", "ACME", "Organization name", "Acme Inc", "Short name",
      "acme/gov_repo", "Production branch", "main", "Development branch", "dev", "Policy Owner", "@rk", "Check Owner",
      "contact email", "(none)", "Governance posture", "soft"]) expect(text, w).to.contain(w);
    expect(text).to.contain("(your answer · org-config.yaml)").and.contain("(default · policies/governance.yaml)");
    expect(text).to.contain("changed later by a pull request");
  });

  it("refuses a `gov_repo` that exists and is not a governance repository — before anything is created", async () => {
    let err: unknown;
    try {
      await run(base, { checkRepoName: (o, repo) => [`${o}/${repo} already exists and is not a governance repository.`] });
    } catch (e) { err = e; }
    expect(err).to.be.instanceOf(InterviewRefused);
    expect((err as Error).message).to.contain("acme/gov_repo already exists");
  });

  it("asks the repository check only after the probe found the org ungoverned", async () => {
    const order: string[] = [];
    await run(base, { afterOrg: () => { order.push("probe"); return true; }, checkRepoName: () => { order.push("repo"); return null; } });
    expect(order).to.deep.equal(["probe", "repo"]);
    const diverted: string[] = [];
    const r = await run(base, { afterOrg: () => false, checkRepoName: () => { diverted.push("repo"); return null; } });
    expect(r.r).to.equal(null);
    expect(diverted, "a joiner is never asked about a repository").to.deep.equal([]);
  });

  it("with nobody signed in to GitHub there is no Policy Owner — refused before anything is created", async () => {
    let err: unknown;
    try {
      await askOrgInterview({ prompt: async (q) => base(q), print: () => {}, derive: (p) => deriveOrgConfig(p, { ...CTX, ghUser: null }) });
    } catch (e) { err = e; }
    expect(err).to.be.instanceOf(InterviewRefused);
    expect((err as Error).message).to.contain("gh auth login");
  });

  it("refuses FRM as the identifier and asks again", async () => {
    let n = 0;
    const { r } = await run((q) => (/^Q2 /.test(q) ? (n++ === 0 ? "FRM" : "ACME") : base(q)));
    expect(r!.answers.orgSlug).to.equal("ACME");
  });

  it("the summary is pure text", () => {
    expect(settledSummary([{ what: "A", value: "", asked: false, file: "org-config.yaml" }]).join("\n")).to.contain("A  (none)   (default · org-config.yaml)");
  });
});

// W2-Q6 (Policy Owner, 2026-10-06): posture defaults to soft. The interview no longer asks it (F158).
describe("gov-work — the governance posture is recorded", () => {
  it("the hard-posture confirmation (still asked by configure-in-place) is the Policy Owner's, word for word", () => {
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
