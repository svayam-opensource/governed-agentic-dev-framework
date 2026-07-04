// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { renderAgentMd, renderTodoMd, substituteTokens } from "../../src/lifecycle/content.js";

describe("prj-work Phase 2 — agent.md + todo.md + token substitution", () => {
  it("renders agent.md with project identity, repo line, board URL, and NO project.yaml", () => {
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
    // GitHub is the SoT — the checklist must not tell the agent to read project.yaml
    expect(md).to.include("There is no `project.yaml`.");
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
