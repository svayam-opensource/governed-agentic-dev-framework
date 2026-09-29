// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { parseOrgConfig, unknownOrgConfigKeys } from "../../src/config/org-config.js";
import { px } from "../helpers/paths.js";

// A faithful excerpt of the real Svayamtech org-config.yaml.
const ORG_CONFIG = `# Agentic Development Framework — Organization Configuration
org_name: "Svayam Infoware Pvt"
org_short_name: "Svayam"
org_slug: "SVM"
org_slug_lower: "svm"
github_org: "Svayamtech"
workspace_repo: "svm-prj-work"
org_repo_url: "git@github.com:Svayamtech/svm-prj-work.git"
default_branch: "main"
default_code_branch: "dev"
agent_work_root: "~/.svm/projects"
gov_workspace: "~/.svm/gov_repo"
policy_owner_email: "rkant@svayam.ai"
`;

describe("prj-work — parseOrgConfig", () => {
  it("parses the real Svayamtech config, expanding ~ paths", () => {
    const c = parseOrgConfig(ORG_CONFIG, "/home/rk");
    expect({ ...c, agentWorkRoot: px(c.agentWorkRoot), govWorkspace: px(c.govWorkspace) }).to.deep.include({
      orgName: "Svayam Infoware Pvt",
      orgShortName: "Svayam",
      orgSlug: "SVM",
      orgSlugLower: "svm",
      githubOrg: "Svayamtech",
      workspaceRepo: "svm-prj-work",
      orgRepoUrl: "git@github.com:Svayamtech/svm-prj-work.git",
      defaultBranch: "main",
      defaultCodeBranch: "dev",
      agentWorkRoot: "/home/rk/.svm/projects",
      govWorkspace: "/home/rk/.svm/gov_repo",
      policyOwnerEmail: "rkant@svayam.ai",
    });
  });

  it("builds the tool-file token map (matching seed's substituteTokens keys)", () => {
    const { orgTokens } = parseOrgConfig(ORG_CONFIG, "/home/rk");
    expect({ ...orgTokens, AGENT_WORK_ROOT: px(orgTokens.AGENT_WORK_ROOT ?? "") }).to.include({
      ORG_NAME: "Svayam Infoware Pvt",
      ORG_SLUG: "SVM",
      org_slug: "svm",
      GITHUB_ORG: "Svayamtech",
      WORKSPACE_REPO: "svm-prj-work",
      DEFAULT_CODE_BRANCH: "dev",
      AGENT_WORK_ROOT: "/home/rk/.svm/projects",
    });
  });

  it("env_branches: block form, order preserved — the ladder is an ORDER, not a set", () => {
    const c = parseOrgConfig(`${ORG_CONFIG}env_branches:\n  - uat\n  - sit\n`, "/home/rk");
    expect(c.envBranches).to.deep.equal(["uat", "sit"]);
  });

  it("env_branches: inline form parses the same", () => {
    expect(parseOrgConfig(`${ORG_CONFIG}env_branches: [uat, sit]\n`, "/home/rk").envBranches).to.deep.equal(["uat", "sit"]);
  });

  it("env_branches: quotes and trailing comments are stripped", () => {
    const c = parseOrgConfig(`${ORG_CONFIG}env_branches:\n  - "uat"   # the cut env\n`, "/home/rk");
    expect(c.envBranches).to.deep.equal(["uat"]);
  });

  it("env_branches: absent → empty, which is the two-rung ladder every adopter starts with", () => {
    expect(parseOrgConfig(ORG_CONFIG, "/home/rk").envBranches).to.deep.equal([]);
  });

  it("env_branches: the list ENDS at a dedent — it never swallows the next key", () => {
    // A greedy reader would have taken `policy_owner_email` as a rung and close would merge into it.
    const c = parseOrgConfig(`${ORG_CONFIG}env_branches:\n  - uat\ngov_account: "1000"\n`, "/home/rk");
    expect(c.envBranches).to.deep.equal(["uat"]);
  });

  it("tolerates missing keys (empty strings, no throw)", () => {
    const c = parseOrgConfig("github_org: X\n", "/home/rk");
    expect(c.githubOrg).to.equal("X");
    expect(c.workspaceRepo).to.equal("");
  });
});

// Policy Owner, 2026-09-23: `<WORKSPACE_REPO>` becomes `<ORG_GOV_REPO>` — the name says what the repository
// IS, where "workspace" named where it happened to sit. Both keys are read for one release, so an adopter who
// upgrades late is never broken.
describe("org_gov_repo — the new name, and the old one for one release", () => {
  const cfg = (body: string): ReturnType<typeof parseOrgConfig> => parseOrgConfig(body);

  it("reads the new key", () => {
    const c = cfg('org_name: "Acme"\norg_gov_repo: "acme-gov"\n');
    expect(c.workspaceRepo).to.equal("acme-gov");
    expect(c.orgTokens.ORG_GOV_REPO).to.equal("acme-gov");
  });

  it("still reads the old one, and resolves BOTH tokens to it", () => {
    const c = cfg('org_name: "Acme"\nworkspace_repo: "acme-gov"\n');
    expect(c.workspaceRepo, "an adopter who has not upgraded is not broken").to.equal("acme-gov");
    expect(c.orgTokens.ORG_GOV_REPO).to.equal("acme-gov");
    expect(c.orgTokens.WORKSPACE_REPO, "documents that predate the rename still resolve").to.equal("acme-gov");
  });

  it("the new key wins when both are there — which is what an upgrade leaves behind", () => {
    expect(cfg('org_gov_repo: "new-gov"\nworkspace_repo: "old-gov"\n').workspaceRepo).to.equal("new-gov");
  });
});

// Policy Owner, 2026-09-29 — the ONE posture decision, and the state that is neither.
describe("gov-work — governance_posture", () => {
  const posture = (text: string) => parseOrgConfig(text, "/home/x").governancePosture;

  it("reads the two postures gov implements", () => {
    expect(posture("governance_posture: hard").posture).to.equal("hard");
    expect(posture('governance_posture: "soft"   # decided 2026-09-29').posture).to.equal("soft");
    expect(posture("governance_posture: HARD").posture, "GitHub-ish casing is not a different answer").to.equal("hard");
  });

  it("an absent or empty key is NOBODY CHOSE — never a default to either side", () => {
    for (const text of ["org_name: Acme", 'governance_posture: ""', "governance_posture:   "]) {
      const p = posture(text);
      expect(p.posture, text).to.equal(null);
      expect(p.unrecognised, `${text} — nobody wrote anything, so nothing was misread`).to.equal(false);
    }
  });

  it("a word gov does not know is a FOURTH state: somebody chose and was not heard", () => {
    const p = posture("governance_posture: strict");
    expect(p.posture).to.equal(null);
    expect(p.unrecognised).to.equal(true);
    expect(p.raw, "kept verbatim, so the report can quote what they wrote").to.equal("strict");
  });

  it("is a key gov READS, so `unknownOrgConfigKeys` never reports it as ignored", () => {
    expect(unknownOrgConfigKeys("governance_posture: hard\nauthorized_approvers:\n  - alice\n")).to.deep.equal([]);
  });
});
