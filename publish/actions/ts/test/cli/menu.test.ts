// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { mainActions, visibleActions, formatMainMenu, resolveTopChoice, contextEnvs, type MenuContext } from "../../src/cli/menu.js";

const CTX: MenuContext = { orgName: "Acme Inc", githubOrg: "Acme", branch: "main", user: "rk", workspaceCount: 2, cliVersion: "1.0.0" };

const labels = (ctx: MenuContext): string[] => visibleActions(ctx).map((a) => a.label);
const adminCmds = (ctx: MenuContext): string[] => {
  const a = visibleActions(ctx).find((x) => x.label === "Admin");
  return a && a.kind === "submenu" ? a.commands.map((c) => c.cmd) : [];
};

describe("gov-work — interactive menu (context-scoped)", () => {
  // The menu used to MERGE verbs discovered from the gov-cicd and do-admin plugins. The three clients each
  // render their own menu now (adr-three-clients, PRJ-43), so gov's menu offers gov's verbs and nothing else.
  it("offers only gov-work's own submenus — no discovered plugin verbs", () => {
    const keys = mainActions().map((a) => a.key);
    expect(keys).to.deep.equal(["status", "work", "admin", "help"]);
    expect(mainActions().find((x) => x.label === "Operate"), "Operate was the gov-cicd merge").to.equal(undefined);
    expect(mainActions().find((x) => x.label === "Infra"), "Infra was the do-admin merge").to.equal(undefined);
  });

  it("GOVERNED context: governance admin + listing are visible", () => {
    const g = { ...CTX, mode: "governed" as const };
    expect(labels(g)).to.deep.equal(["Status", "Work", "Admin", "Help"]);
    expect(adminCmds(g)).to.deep.equal(["manage", "knowledge", "onboard", "org", "upgrade", "deps"]);   // manage now org-level too; add-repo stays project-only
  });

  it("PROJECT context: project admin only", () => {
    const p = { ...CTX, mode: "project" as const, project: "PRJ-43" };
    expect(adminCmds(p)).to.deep.equal(["manage", "add-repo"]);                 // governance admin hidden
    const status = visibleActions(p).find((a) => a.label === "Status");
    expect(status && status.kind === "submenu" ? status.commands.map((c) => c.cmd) : []).to.deep.equal(["status"]);  // list/list-all governed-only
  });


  it("UX-flow: `manage` (project access) is available in BOTH PROJECT and GOVERNED Admin (org-level assign)", () => {
    // Regression guard (2026-07-17): a new board (#106) couldn't be assigned from the org home because Admin
    // had no `manage`. Org admins must be able to assign/unassign from GOVERNED too.
    expect(adminCmds({ ...CTX, mode: "governed" })).to.include("manage");
    expect(adminCmds({ ...CTX, mode: "project", project: "PRJ-43" })).to.include("manage");
  });


  it("NONE context: empty submenus disappear — only Work (setup) + Help remain", () => {
    expect(labels({ ...CTX, mode: "none" })).to.deep.equal(["Work", "Help"]);
  });

  it("contextEnvs: PROJECT = local only; GOVERNED/other = dev/uat/prod", () => {
    expect(contextEnvs("project")).to.deep.equal(["local"]);
    expect(contextEnvs("governed")).to.deep.equal(["dev", "uat", "prod"]);
  });

  it("numbering matches between render and resolveTopChoice under the SAME context", () => {
    const g = { ...CTX, mode: "governed" as const };
    const rendered = visibleActions(g).map((a) => a.label);
    rendered.forEach((label, i) => {
      const r = resolveTopChoice(String(i + 1), g);
      expect(r.kind === "action" && r.action.label).to.equal(label);
    });
  });

  it("renders the banner + context line; Work adapts per mode", () => {
    const m = formatMainMenu(CTX).join("\n");
    expect(m).to.match(/▸ Acme Inc — Governed Agentic Development Framework \(v1\.0\.0\)/);
    const p = formatMainMenu({ ...CTX, mode: "project", project: "PRJ-43" }).join("\n");
    expect(p).to.match(/Context: PROJECT \(PRJ-43\)/);
    expect(p).to.match(/Work.*Continue the current project/);
    expect(formatMainMenu({ ...CTX, mode: "governed" }).join("\n")).to.match(/Context: GOVERNED/);
  });

  it("resolves o / quit / unknown", () => {
    expect(resolveTopChoice("o", CTX)).to.deep.equal({ kind: "org" });
    expect(resolveTopChoice("0", CTX)).to.deep.equal({ kind: "quit" });
    expect(resolveTopChoice("99", CTX)).to.deep.equal({ kind: "unknown" });
  });
});

