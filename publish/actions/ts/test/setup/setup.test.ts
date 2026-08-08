// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { parseOriginOwnerRepo, deriveOrgConfig, renderOrgConfig, readExistingOrgConfig } from "../../src/setup/setup.js";
import { runSetup } from "../../src/setup/setup-run.js";
import { parseOrgConfig } from "../../src/config/org-config.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

/** writes keyed by normalised path, so a POSIX literal finds what the code wrote host-natively. */
const pxKeys = (m: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [px(k), v]));

const CTX = { originUrl: "git@github.com:Acme/acme-gov.git", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04" };

describe("gov-work — setup (bootstrap)", () => {
  it("parses owner/repo from ssh + https remote URLs", () => {
    expect(parseOriginOwnerRepo("git@github.com:Acme/acme-gov.git")).to.deep.equal({ owner: "Acme", repo: "acme-gov" });
    expect(parseOriginOwnerRepo("https://github.com/Acme/acme-gov")).to.deep.equal({ owner: "Acme", repo: "acme-gov" });
    expect(parseOriginOwnerRepo("not-a-url")).to.equal(null);
  });

  it("derives defaults setup.sh-style (slug_lower, origin, paths, owners)", () => {
    const v = deriveOrgConfig({ orgName: "Acme Inc", orgSlug: "ACME" }, CTX);
    expect(v).to.include({
      orgSlugLower: "acme", githubOrg: "Acme", workspaceRepo: "acme-gov",
      defaultBranch: "main", defaultCodeBranch: "dev",
      agentWorkRoot: "~/.acme/projects", govWorkspace: "~/.acme/gov_repo",
      policyOwnerEmail: "rk@acme.io", policyOwnerGithub: "@rk",
      legalOwnerGithub: "@rk", dataArchOwnerGithub: "@rk", policyEffectiveDate: "2026-07-04",
    });
  });

  it("renders an org-config.yaml that parseOrgConfig round-trips", () => {
    const v = deriveOrgConfig({ orgName: "Acme Inc", orgShortName: "Acme", orgSlug: "ACME" }, CTX);
    const yaml = renderOrgConfig(v);
    const parsed = parseOrgConfig(yaml);
    expect(parsed).to.include({ orgName: "Acme Inc", githubOrg: "Acme", workspaceRepo: "acme-gov", defaultBranch: "main", defaultCodeBranch: "dev" });
    expect(readExistingOrgConfig(yaml)).to.include({ orgSlug: "ACME", govWorkspace: "~/.acme/gov_repo" });
  });

  it("runSetup writes org-config.yaml + sets origin (scripted prompts)", async () => {
    const writes: Record<string, string> = {};
    const fs = { writeFile: (f: string, c: string) => { writes[f] = c; }, pathExists: () => false, readFile: () => null, mkdirp: () => {}, rm: () => {}, readdir: () => [] } as Fs;
    const printed: string[] = [];
    let remoteSet = "";
    const answers: Record<string, string> = { "Full legal name of your organization": "Acme Inc", "Org slug (uppercase, 2-6 chars; e.g. ACME)": "ACME" };
    const code = await runSetup({
      fs, cwd: "/repo", originUrl: CTX.originUrl, ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04",
      prompt: async (q, def) => answers[q] ?? def,
      print: (l) => printed.push(l),
      setOriginRemote: (u) => { remoteSet = u; },
    }, true);
    expect(code).to.equal(0);
    expect(pxKeys(writes)["/repo/org-config.yaml"]).to.match(/org_name: "Acme Inc"/);
    expect(remoteSet).to.equal("git@github.com:Acme/acme-gov.git");
    expect(printed.some((l) => /gov-work org add Acme/.test(l))).to.equal(true);
  });

  it("fails when org_name/org_slug are absent (non-interactive, no existing)", async () => {
    const fs = { writeFile: () => {}, pathExists: () => false, readFile: () => null, mkdirp: () => {}, rm: () => {}, readdir: () => [] } as Fs;
    const code = await runSetup({ fs, cwd: "/repo", originUrl: CTX.originUrl, ghUser: null, gitEmail: null, today: "2026-07-04", prompt: async (_q, d) => d, print: () => {} }, false);
    expect(code).to.equal(1);
  });
});
