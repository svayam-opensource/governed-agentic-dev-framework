// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { menuCategories, formatMainMenu, resolveTopChoice, type MenuContext } from "../../src/cli/menu.js";

const CTX: MenuContext = { orgName: "Acme Inc", githubOrg: "Acme", branch: "main", user: "rk", workspaceCount: 2, cliVersion: "1.0.0" };

describe("gov-work — interactive menu", () => {
  it("categories: Status/Work/Admin/Maintain; adds Operate only when the plugin is installed", () => {
    expect(menuCategories(false).map((c) => c.label)).to.deep.equal(["Status", "Work", "Admin", "Maintain"]);
    expect(menuCategories(true).map((c) => c.label)).to.include("Operate");
  });

  it("renders a prj-style banner (org · branch · user · workspaces) + the action table", () => {
    const m = formatMainMenu(CTX).join("\n");
    expect(m).to.match(/▸ Acme Inc — Governed Agentic Development Framework \(v1\.0\.0\)/);
    expect(m).to.match(/Org: Acme\s+\|\s+Branch: main\s+\|\s+User: rk/);
    expect(m).to.match(/2 governance workspace\(s\) registered/);
    expect(m).to.match(/\(1\) Status/);
    expect(m).to.match(/\(2\) Work/);
    // no plugin → the enterprise hint, no Operate row
    expect(m).to.match(/need the enterprise plugin/);
    expect(m).to.not.match(/\(5\) Operate/);
  });

  it("shows an Operate row (no hint) when the plugin is installed", () => {
    const m = formatMainMenu({ ...CTX, operateInstalled: true }).join("\n");
    expect(m).to.match(/\(5\) Operate/);
    expect(m).to.not.match(/need the enterprise plugin/);
  });

  it("resolves a top-level choice to a category / org / quit", () => {
    expect(resolveTopChoice("2", CTX)).to.deep.include({ kind: "category" });
    expect((resolveTopChoice("2", CTX) as { category: { key: string } }).category.key).to.equal("work");
    expect(resolveTopChoice("admin", CTX)).to.deep.include({ kind: "category" });
    expect(resolveTopChoice("o", CTX)).to.deep.equal({ kind: "org" });
    expect(resolveTopChoice("0", CTX)).to.deep.equal({ kind: "quit" });
    expect(resolveTopChoice("999", CTX)).to.deep.equal({ kind: "unknown" });
  });
});
