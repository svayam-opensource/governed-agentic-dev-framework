// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import {
  yamlQuote,
  renderReposBlock,
  renderProjectYaml,
  renderAgentMd,
  renderTodoMd,
  substituteTokens,
  type ProjectManifest,
} from "../../src/lifecycle/content.js";

describe("prj-work Phase 2 — yamlQuote (injection-safe)", () => {
  it("quotes and escapes backslash before double-quote", () => {
    expect(yamlQuote("plain")).to.equal('"plain"');
    expect(yamlQuote('a"b')).to.equal('"a\\"b"');
    expect(yamlQuote("back\\slash")).to.equal('"back\\\\slash"');
  });
  it("neutralizes a value ending in a backslash (C10 breakout attempt)", () => {
    // Input ends with a lone backslash; escaped so the closing quote is safe.
    expect(yamlQuote("evil\\")).to.equal('"evil\\\\"');
    expect(yamlQuote('"; injected: true')).to.equal('"\\"; injected: true"');
  });
});

const MANIFEST: ProjectManifest = {
  id: "PRJ-43-governance-common-project",
  slug: "governance-common-project",
  branch: "BRNCH-43-governance-common-project",
  description: null,
  github_project: "https://github.com/orgs/Svayamtech/projects/43",
  github_project_name: "@Governance Common Project",
  assigned_to: "svayam-rkant",
  seeded_by: "rkant@svayam.ai",
  status: "active",
  created_at: "2026-06-26",
  started_at: "2026-06-26",
  completed_at: null,
  paused_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  repos: [
    {
      url: "https://github.com/Svayamtech/911-SVM-LIB-SVC",
      role: "primary",
      base_branch: "dev",
      added_at: "2026-06-26",
      added_reason: null,
    },
  ],
  knowledge_status: null,
  knowledge_pr: null,
  agent_config: { model: "auto", provider: "cursor" },
};

describe("prj-work Phase 2 — renderProjectYaml", () => {
  it("renders the PRJ-43 manifest with the live-file shape", () => {
    const y = renderProjectYaml(MANIFEST, "dev");
    expect(y).to.include('id: "PRJ-43-governance-common-project"\n');
    expect(y).to.include('branch: "BRNCH-43-governance-common-project"\n');
    expect(y).to.include("description: ~\n");
    expect(y).to.include('github_project_name: "@Governance Common Project"\n');
    expect(y).to.include("status: active\n");
    expect(y).to.include("created_at: 2026-06-26\n");
    expect(y).to.include("  - url: https://github.com/Svayamtech/911-SVM-LIB-SVC\n");
    expect(y).to.include("    base_branch: dev\n");
    expect(y).to.include("    added_reason: ~\n");
    expect(y.endsWith("agent_config:\n  model: auto\n  provider: cursor\n")).to.equal(true);
  });

  it("renders a placeholder repos block when there are no repos", () => {
    const block = renderReposBlock([], "dev");
    expect(block).to.equal(
      ["  - url: ~", "    role: primary", "    base_branch: dev", "    added_at: ~", "    added_reason: ~"].join("\n"),
    );
  });
});

describe("prj-work Phase 2 — agent.md + todo.md + token substitution", () => {
  it("renders agent.md with project identity, repo line, and board URL", () => {
    const md = renderAgentMd({
      title: "@Governance Common Project",
      projectId: "PRJ-43-governance-common-project",
      branch: "BRNCH-43-governance-common-project",
      projectWorkRoot: "/awr/PRJ-43-governance-common-project",
      workspaceRepo: "svm-prj-work",
      agentWorkRoot: "/awr",
      githubProjectUrl: "https://github.com/orgs/Svayamtech/projects/43",
      defaultBranch: "main",
      repos: [{ name: "911-SVM-LIB-SVC", url: "https://github.com/Svayamtech/911-SVM-LIB-SVC" }],
    });
    expect(md).to.include("# @Governance Common Project — Project Agent Entry Point");
    expect(md).to.include("# Project: PRJ-43-governance-common-project  |  Branch: BRNCH-43-governance-common-project");
    expect(md).to.include("- `911-SVM-LIB-SVC/` — clone of https://github.com/Svayamtech/911-SVM-LIB-SVC on branch `BRNCH-43-governance-common-project`.");
    expect(md).to.include("board: https://github.com/orgs/Svayamtech/projects/43");
  });

  it("renderTodoMd substitutes the PRJ-NNN-<slug> placeholder", () => {
    expect(renderTodoMd("# To-do for PRJ-NNN-<slug>\n\n## Open", "PRJ-43-governance-common-project")).to.equal(
      "# To-do for PRJ-43-governance-common-project\n\n## Open",
    );
  });

  it("substituteTokens replaces <TOKEN>s, applying longer names first", () => {
    const out = substituteTokens("<ORG_NAME> uses <ORG> and <org_slug>", {
      ORG: "SVM",
      ORG_NAME: "Svayam Infoware",
      org_slug: "svm",
    });
    expect(out).to.equal("Svayam Infoware uses SVM and svm");
  });
});
