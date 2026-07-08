// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { mainActions, formatMainMenu, resolveTopChoice, type MenuContext } from "../../src/cli/menu.js";

const CTX: MenuContext = { orgName: "Acme Inc", githubOrg: "Acme", branch: "main", user: "rk", workspaceCount: 2, cliVersion: "1.0.0" };

describe("gov-work — interactive menu (task-oriented)", () => {
  it("Status/Work/Admin/Help; Work is guided, Status/Admin are submenus, Help is help (no Operate — separate CLI)", () => {
    const a = mainActions();
    expect(a.map((x) => x.label)).to.deep.equal(["Status", "Work", "Admin", "Help"]);
    expect(a.find((x) => x.label === "Work")!.kind).to.equal("guided");
    expect(a.find((x) => x.label === "Status")!.kind).to.equal("submenu");
    expect(a.find((x) => x.label === "Help")!.kind).to.equal("help");
    expect(a.find((x) => x.label === "Operate")).to.equal(undefined);   // enterprise ops are the separate gov-operate CLI
  });

  it("Work is NOT a command dump — its hint is 'pick a project'", () => {
    const work = mainActions().find((x) => x.label === "Work")!;
    expect(work.kind === "guided" && work.hint).to.equal("pick a project");
  });

  it("renders the prj-style banner + action table; no Operate / no enterprise-plugin hint", () => {
    const m = formatMainMenu(CTX).join("\n");
    expect(m).to.match(/▸ Acme Inc — Governed Agentic Development Framework \(v1\.0\.0\)/);
    expect(m).to.match(/\(2\) Work.*pick a project/);
    expect(m).to.not.match(/enterprise plugin/);
    expect(m).to.not.match(/Operate/);
  });

  it("resolves choices to action / org / quit", () => {
    expect((resolveTopChoice("2", CTX) as { action: { label: string } }).action.label).to.equal("Work");
    expect((resolveTopChoice("admin", CTX) as { action: { label: string } }).action.label).to.equal("Admin");
    expect(resolveTopChoice("o", CTX)).to.deep.equal({ kind: "org" });
    expect(resolveTopChoice("0", CTX)).to.deep.equal({ kind: "quit" });
    expect(resolveTopChoice("99", CTX)).to.deep.equal({ kind: "unknown" });
  });
});
