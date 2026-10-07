// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseOriginOwnerRepo, deriveOrgConfig, renderOrgConfig, renderSetupGovernance, readExistingOrgConfig, TEMPLATE_ORG_CONFIG_VALUES } from "../../src/setup/setup.js";
import { runSetup } from "../../src/setup/setup-run.js";
import { parseOrgConfig, validateOrgConfig, RETIRED_ORG_CONFIG_KEYS } from "../../src/config/org-config.js";
import { parseGovernance, frameworkOwners } from "../../src/config/governance.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";
import { agentAnswer } from "../helpers/agents-answer.js";

/** writes keyed by normalised path, so a POSIX literal finds what the code wrote host-natively. */
const pxKeys = (m: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [px(k), v]));

const CTX = { originUrl: "git@github.com:Acme/acme-gov.git", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04" };

describe("gov-work — setup (bootstrap)", () => {
  it("THE SHIPPED org-config TEMPLATE IS THE RENDERER'S EMPTY FILE — one source for its comments and keys", () => {
    const shipped = fs.readFileSync(fileURLToPath(new URL("../../../../content/org-config.example.yaml", import.meta.url)), "utf8");
    expect(shipped).to.equal(renderOrgConfig(TEMPLATE_ORG_CONFIG_VALUES));
  });

  it("parses owner/repo from ssh + https remote URLs", () => {
    expect(parseOriginOwnerRepo("git@github.com:Acme/acme-gov.git")).to.deep.equal({ owner: "Acme", repo: "acme-gov" });
    expect(parseOriginOwnerRepo("https://github.com/Acme/acme-gov")).to.deep.equal({ owner: "Acme", repo: "acme-gov" });
    expect(parseOriginOwnerRepo("not-a-url")).to.equal(null);
  });

  it("derives defaults setup.sh-style (origin, paths, owners) — no slug_lower, work root, effective date or domain owners", () => {
    const v = deriveOrgConfig({ orgName: "Acme Inc", orgSlug: "ACME" }, CTX);
    expect(v).to.include({
      githubOrg: "Acme", workspaceRepo: "acme-gov",
      defaultBranch: "main", defaultCodeBranch: "dev", govWorkspace: "~/.gov/acme/gov_repo",
      policyOwnerEmail: "rk@acme.io", policyOwnerGithub: "@rk", checkOwnerGithub: "@rk", governancePosture: "soft",
    });
    for (const gone of ["orgSlugLower", "agentWorkRoot", "policyEffectiveDate", "legalOwnerGithub", "dataArchOwnerGithub"]) {
      expect(v, gone).to.not.have.property(gone);
    }
  });

  it("org-config.yaml carries identity and infrastructure only; the governance choices go to policies/governance.yaml", () => {
    const v = deriveOrgConfig({ orgName: "Acme Inc", orgShortName: "Acme", orgSlug: "ACME" }, CTX);
    const cfg = renderOrgConfig(v);
    expect(validateOrgConfig(cfg)).to.deep.equal({ unknown: [], missing: [], retired: [], replaced: [] });
    for (const k of Object.keys(RETIRED_ORG_CONFIG_KEYS)) expect(cfg, k).to.not.match(new RegExp(`^${k}:`, "m"));
    const g = parseGovernance(renderSetupGovernance(v));
    expect(g.problems).to.deep.equal([]);
    expect(frameworkOwners(g)).to.deep.equal({ policyOwner: "@rk", checkOwner: "@rk" });
    expect(g.policyOwner.email).to.equal("rk@acme.io");
  });

  it("renders an org-config.yaml that parseOrgConfig round-trips", () => {
    const v = deriveOrgConfig({ orgName: "Acme Inc", orgShortName: "Acme", orgSlug: "ACME" }, CTX);
    const yaml = renderOrgConfig(v);
    const parsed = parseOrgConfig(yaml);
    expect(parsed).to.include({ orgName: "Acme Inc", githubOrg: "Acme", workspaceRepo: "acme-gov", defaultBranch: "main", defaultCodeBranch: "dev" });
    expect(readExistingOrgConfig(yaml)).to.include({ orgSlug: "ACME" });
    // gov_workspace is NOT rendered any more: the shipped template dropped the key, and the home is
    // resolved from the org registry / cwd walk-up. Emitting it sent adopters to `gov org add` with a
    expect(yaml).to.not.match(/^gov_workspace:/m);
    // Reading one is still supported — configs written before the key was dropped must keep working.
    expect(readExistingOrgConfig(`${yaml}\ngov_workspace: "~/.legacy/gov_repo"\n`))
      .to.include({ govWorkspace: "~/.legacy/gov_repo" });
  });

  // Tier 0 #5 (2026-10-06): setup wrote the key the template had renamed away from, so the org's first
  // `gov upgrade` lost it. setup writes the template's name; a re-run still reads a config written before.
  it("renders org_gov_repo — the template's key — and re-reads either name", () => {
    const yaml = renderOrgConfig(deriveOrgConfig({ orgName: "Acme Inc", orgSlug: "ACME" }, CTX));
    expect(yaml).to.match(/^org_gov_repo: "acme-gov"$/m);
    expect(yaml).to.not.match(/^workspace_repo:/m);
    expect(readExistingOrgConfig(yaml)).to.include({ workspaceRepo: "acme-gov" });
    expect(readExistingOrgConfig('workspace_repo: "old-gov"\n')).to.include({ workspaceRepo: "old-gov" });
  });

  it("runSetup writes org-config.yaml + sets origin (scripted prompts)", async () => {
    const writes: Record<string, string> = {};
    const fs = { writeFile: (f: string, c: string) => { writes[f] = c; }, pathExists: () => false, readFile: () => null, mkdirp: () => {}, rm: () => {}, readdir: () => [] } as Fs;
    const printed: string[] = [];
    let remoteSet = "";
    const answers: Record<string, string> = { "Full legal name of your organization": "Acme Inc", "Org slug (uppercase, 2-6 chars; e.g. ACME)": "ACME" };
    const code = await runSetup({
      fs, cwd: "/repo", originUrl: CTX.originUrl, ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04",
      prompt: async (q, def) => agentAnswer(q) ?? answers[q] ?? def,
      print: (l) => printed.push(l),
      setOriginRemote: (u) => { remoteSet = u; },
    }, true);
    expect(code).to.equal(0);
    expect(pxKeys(writes)["/repo/org-config.yaml"]).to.match(/org_name: "Acme Inc"/);
    expect(pxKeys(writes)["/repo/policies/governance.yaml"]).to.match(/^ {2}github: "@rk"$/m);
    expect(remoteSet).to.equal("git@github.com:Acme/acme-gov.git");
    // #159 finding 6a — setup no longer prints a `gov org add` hint. `gov setup <org>/<repo>` registers
    // the workspace itself, so the hint told the adopter to redo work already done.
    expect(printed.some((l) => /gov org add/.test(l)), "must not instruct what setup already did").to.equal(false);
  });

  it("fails when org_name/org_slug are absent (non-interactive, no existing)", async () => {
    const fs = { writeFile: () => {}, pathExists: () => false, readFile: () => null, mkdirp: () => {}, rm: () => {}, readdir: () => [] } as Fs;
    const code = await runSetup({ fs, cwd: "/repo", originUrl: CTX.originUrl, ghUser: null, gitEmail: null, today: "2026-07-04", prompt: async (_q, d) => d, print: () => {} }, false);
    expect(code).to.equal(1);
  });
});

// token-lifetime-standard.md §3.2 — the org's access-token life is DECLARED in org-config.yaml, and
// gov writes that file. A key gov does not know about is a key that disagrees with the tool reading it,
// which is what org-config.yaml's own banner warns against.
describe("gov-work — setup, session policy (§3.2)", () => {
  it("writes a session block with the standard's default, so a fresh org starts compliant", () => {
    const v = deriveOrgConfig({ orgName: "Acme Inc", orgSlug: "ACME" }, CTX);
    const text = renderOrgConfig(v);
    expect(text).to.contain("session:");
    expect(text).to.contain("access_ttl_sec: 300");
    // It must not read as a service endpoint — the others are URLs of things we talk to.
    expect(text.indexOf("session:")).to.be.greaterThan(text.indexOf("services:"));
  });

  it("PRESERVES an amended value on a re-run rather than resetting it to the default", () => {
    // The number is changed by amending the standard, and a re-run of setup must not quietly undo that.
    const amended = renderOrgConfig(deriveOrgConfig({ orgName: "Acme Inc", orgSlug: "ACME" }, CTX))
      .replace("access_ttl_sec: 300", "access_ttl_sec: 900");
    expect(readExistingOrgConfig(amended).accessTtlSec).to.equal("900");
  });

  it("round-trips through the reader gov-cicd and gov both use", () => {
    const text = renderOrgConfig(deriveOrgConfig({ orgName: "Acme Inc", orgSlug: "ACME" }, CTX));
    // The written file must parse — a block gov writes that gov cannot read back is the same defect
    // one step later.
    expect(readExistingOrgConfig(text).accessTtlSec).to.equal("300");
  });
});

// THE CHECK OWNER (rule-model P1 rulings, 2026-10-06): the framework's second built-in role — reviews the code of
// the org's check actions. It MUST be assigned at setup (default: the Policy Owner), and setup cannot finish with it
// empty: an org that never named a reviewer of code would have its actions approved by whoever happened to look.
describe("gov-work — setup, the Check Owner", () => {
  const noFs = (writes: Record<string, string> = {}) =>
    ({ writeFile: (f: string, c: string) => { writes[f] = c; }, pathExists: () => false, readFile: () => null, mkdirp: () => {}, rm: () => {}, readdir: () => [] }) as Fs;

  it("defaults to the Policy Owner, is written next to it in governance.yaml, and is read back on a re-run", () => {
    const v = deriveOrgConfig({ orgName: "Acme Inc", orgSlug: "ACME" }, CTX);
    expect(v.checkOwnerGithub).to.equal("@rk");
    const gov = renderSetupGovernance({ ...v, checkOwnerGithub: "@dave" });
    expect(gov).to.match(/^check_owner:\n {2}github: "@dave"$/m);
    const existing = readExistingOrgConfig(renderOrgConfig(v), gov);
    expect(existing).to.include({ checkOwnerGithub: "@dave" });
    expect(deriveOrgConfig({}, { ...CTX, existing }).checkOwnerGithub, "a re-run keeps the holder").to.equal("@dave");
  });

  it("a re-run in an org-config that predates the split still offers its owners, and keeps its agents", async () => {
    const old = 'org_name: "Acme Inc"\norg_slug: "ACME"\npolicy_owner_github: "@po"\ncheck_owner_github: "@ck"\nauthorized_agents:\n  default: "claude-code"\n';
    expect(readExistingOrgConfig(old)).to.include({ policyOwnerGithub: "@po", checkOwnerGithub: "@ck" });
    const writes: Record<string, string> = {};
    const fs = { ...noFs(writes), readFile: (f: string) => (px(f) === "/repo/org-config.yaml" ? old : null) } as Fs;
    const code = await runSetup({
      fs, cwd: "/repo", originUrl: CTX.originUrl, ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04",
      existing: readExistingOrgConfig(old), prompt: async (_q, d) => d, print: () => {},
    }, false);
    expect(code).to.equal(0);
    expect(parseGovernance(pxKeys(writes)["/repo/policies/governance.yaml"]).authorizedAgents)
      .to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }] });
  });

  it("is ASKED in a configure-in-place run, offering the Policy Owner as the default", async () => {
    const writes: Record<string, string> = {};
    const asked: Array<[string, string]> = [];
    const answers: Record<string, string> = { "Full legal name of your organization": "Acme Inc", "Org slug (uppercase, 2-6 chars; e.g. ACME)": "ACME" };
    const code = await runSetup({
      fs: noFs(writes), cwd: "/repo", originUrl: CTX.originUrl, ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04",
      prompt: async (q, def) => { asked.push([q, def]); return /Check Owner/.test(q) ? "@dave" : agentAnswer(q) ?? answers[q] ?? def; },
      print: () => {},
    }, true);
    expect(code).to.equal(0);
    const q = asked.find(([question]) => /Check Owner/.test(question));
    expect(q, "the question is asked").to.not.equal(undefined);
    expect(q![1], "and defaults to the Policy Owner").to.equal("@rk");
    expect(pxKeys(writes)["/repo/policies/governance.yaml"]).to.match(/^check_owner:\n {2}github: "@dave"$/m);
    expect(pxKeys(writes)["/repo/org-config.yaml"]).to.not.match(/check_owner/);
  });

  it("is NOT asked again when the adopter interview already answered it", async () => {
    const asked: string[] = [];
    const code = await runSetup({
      fs: noFs(), cwd: "/repo", originUrl: CTX.originUrl, ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04",
      interviewed: true,
      existing: { orgName: "Acme Inc", orgShortName: "Acme", orgSlug: "ACME", defaultBranch: "main", defaultCodeBranch: "dev", policyOwnerEmail: "rk@acme.io", checkOwnerGithub: "@dave" },
      prompt: async (q, def) => { asked.push(q); return def; },
      print: () => {},
    }, true);
    expect(code).to.equal(0);
    expect(asked.filter((q) => /Check Owner/.test(q))).to.deep.equal([]);
  });

  it("GOV-FRM-033 setup cannot finish with the Check Owner empty — nothing is written", async () => {
    const writes: Record<string, string> = {};
    const printed: string[] = [];
    // Non-interactive, no gh user, no Policy Owner on file: there is no default to fall back on.
    const code = await runSetup({
      fs: noFs(writes), cwd: "/repo", originUrl: CTX.originUrl, ghUser: null, gitEmail: null, today: "2026-07-04",
      existing: { orgName: "Acme Inc", orgSlug: "ACME" },
      prompt: async (_q, d) => d, print: (l) => printed.push(l),
    }, false);
    expect(code).to.equal(1);
    expect(writes).to.deep.equal({});
    expect(printed.join("\n")).to.match(/check_owner\.github/);
  });

  it("GOV-FRM-033 setup cannot finish with no Policy Owner, even when a Check Owner is named — nothing is written", async () => {
    const writes: Record<string, string> = {};
    const printed: string[] = [];
    // No gh user to derive the handle from, nothing on file — but a Check Owner pre-filled, so that refusal is not it.
    const code = await runSetup({
      fs: noFs(writes), cwd: "/repo", originUrl: CTX.originUrl, ghUser: null, gitEmail: null, today: "2026-07-04",
      existing: { orgName: "Acme Inc", orgSlug: "ACME", checkOwnerGithub: "@dave" },
      prompt: async (_q, d) => d, print: (l) => printed.push(l),
    }, false);
    expect(code).to.equal(1);
    expect(writes).to.deep.equal({});
    expect(printed.join("\n")).to.match(/policy_owner\.github/);
  });

  it("refuses an org slug of FRM even when it arrives pre-filled (rule-model Q7)", async () => {
    const writes: Record<string, string> = {};
    const printed: string[] = [];
    const code = await runSetup({
      fs: noFs(writes), cwd: "/repo", originUrl: CTX.originUrl, ghUser: "rk", gitEmail: null, today: "2026-07-04",
      existing: { orgName: "Acme Inc", orgSlug: "FRM" },
      prompt: async (_q, d) => d, print: (l) => printed.push(l),
    }, false);
    expect(code).to.equal(1);
    expect(writes).to.deep.equal({});
    expect(printed.join("\n")).to.match(/reserved for the framework/);
  });
});
