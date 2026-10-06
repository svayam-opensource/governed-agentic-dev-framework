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
      // agent_work_root left org-config in the split: the file's value is NOT read — the default is
      // ~/.gov/<slug>/projects, and a person's own choice comes in from ~/.gov/work-roots (config/work-root.ts).
      agentWorkRoot: "/home/rk/.gov/svm/projects",
      govWorkspace: "/home/rk/.svm/gov_repo",
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
      AGENT_WORK_ROOT: "/home/rk/.gov/svm/projects",
    });
    expect(orgTokens, "the Policy Owner's email is governance.yaml's now (governanceTokens)").to.not.have.property("POLICY_OWNER_EMAIL");
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

// The org-config split (Policy Owner, 2026-10-06): identity and infrastructure stay; the rest has moved.
describe("gov-work — org-config after the split", () => {
  it("derives org_slug_lower and never reads it", () => {
    expect(parseOrgConfig('org_slug: "ACME"\norg_slug_lower: "zzz"\n', "/h").orgSlugLower).to.equal("acme");
  });

  it("the work root: the default beside the gov repo, or the person's own — never the file's", () => {
    expect(parseOrgConfig('org_slug: "ACME"\nagent_work_root: "/elsewhere"\n', "/h").agentWorkRoot).to.equal("/h/.gov/acme/projects");
    expect(parseOrgConfig('org_slug: "ACME"\n', "/h", { workRoot: "~/work" }).agentWorkRoot).to.equal("/h/work");
    expect(parseOrgConfig("org_name: x\n", "/h").agentWorkRoot, "no slug, no default").to.equal("");
  });

  it("does not read the governance keys any more — they are reported as retired, with where they went", () => {
    const c = parseOrgConfig("org_name: Acme\ngovernance_posture: hard\npolicy_owner_github: po\n", "/h");
    expect(c).to.not.have.property("governancePosture");
    expect(c).to.not.have.property("policyOwnerEmail");
    expect(c.keyReport.retired.map((r) => r.key)).to.deep.equal(["governance_posture", "policy_owner_github"]);
    expect(c.keyReport.retired[0]!.movedTo).to.match(/policies\/governance\.yaml/);
    expect(unknownOrgConfigKeys("governance_posture: hard\n"), "retired is not unknown").to.deep.equal([]);
  });
});
