// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { parseOrgConfig } from "../../src/config/org-config.js";
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

  it("tolerates missing keys (empty strings, no throw)", () => {
    const c = parseOrgConfig("github_org: X\n", "/home/rk");
    expect(c.githubOrg).to.equal("X");
    expect(c.workspaceRepo).to.equal("");
  });
});
