// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { mainActions, visibleActions, formatMainMenu, formatMenuHeader, formatActionList, resolveTopChoice, contextEnvs, type MenuContext } from "../../src/cli/menu.js";

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
    expect(keys, "Help left the menu (2026-09-22) — the CLI documents itself").to.deep.equal(["work", "admin"]);
    expect(mainActions().find((x) => x.label === "Operate"), "Operate was the gov-cicd merge").to.equal(undefined);
    expect(mainActions().find((x) => x.label === "Infra"), "Infra was the do-admin merge").to.equal(undefined);
  });

  // The menu is the HUMAN surface. Status (list/list-all/status) left on 2026-08-07 — those are the
  // work-management system's answers — and Admin now carries only what an agent cannot do for you.
  it("GOVERNED context: Work · Admin, and Admin is org + doctor + preferences + upgrade", () => {
    const g = { ...CTX, mode: "governed" as const };
    expect(labels(g)).to.deep.equal(["Work", "Admin"]);
    expect(adminCmds(g)).to.deep.equal(["org", "doctor", "preferences", "upgrade"]);
  });

  it("PROJECT context: upgrade is governed-only, the rest travels", () => {
    const p = { ...CTX, mode: "project" as const, project: "PRJ-43" };
    expect(adminCmds(p), "upgrade is governed-only; the rest travels").to.deep.equal(["org", "doctor", "preferences"]);
    expect(visibleActions(p).find((a) => a.label === "Status"), "Status is the work-mgmt system's").to.equal(undefined);
  });


  // Was a regression guard (2026-07-17) for `manage` being missing from GOVERNED Admin. `manage` is no
  // longer a menu item at all — assignment is the work-management system's answer, asked through the
  // work-mgmt port or its own UI — so the guard now asserts the verb still RUNS, not that it is offered.
  it("`manage` is no longer a menu item — it is the work-mgmt system's answer", () => {
    for (const mode of ["governed", "project"] as const) {
      expect(adminCmds({ ...CTX, mode, ...(mode === "project" ? { project: "PRJ-43" } : {}) }), mode).to.not.include("manage");
    }
  });


  // PRJ-121, 2026-09-22: Admin vanished in NONE — and with it `org use`, the only way OUT of NONE.
  it("NONE context: Admin stays, with org + doctor — the way out of NONE is a menu item", () => {
    expect(labels({ ...CTX, mode: "none" })).to.deep.equal(["Work", "Admin"]);
    expect(adminCmds({ ...CTX, mode: "none" })).to.deep.equal(["org", "doctor", "preferences"]);
  });

  it("NONE with orgs registered: Work says choose an org, not set one up", () => {
    const m = formatActionList({ ...CTX, mode: "none", workspaceCount: 2 }).join("\n");
    expect(m).to.match(/Work.*Choose a working org first/).and.not.match(/gov setup/);
    expect(formatActionList({ ...CTX, mode: "none", workspaceCount: 0 }).join("\n")).to.match(/Set up a workspace first.*gov setup/);
  });

  it("the header and the action list are separate — the loop prints the header once", () => {
    const header = formatMenuHeader(CTX).join("\n");
    const list = formatActionList(CTX).join("\n");
    expect(header).to.contain("▸").and.not.contain("Type a number");
    expect(list).to.contain("Type a number").and.not.contain("▸");
    expect(formatMainMenu(CTX)).to.deep.equal([...formatMenuHeader(CTX), ...formatActionList(CTX)]);
  });

  it("no org name → the framework's name once, not doubled", () => {
    const h = formatMenuHeader({ cliVersion: "1.0.0" }).join("\n");
    expect(h).to.contain("▸ Governed Agentic Development Framework (v1.0.0)");
    expect(h).to.not.contain("Framework — Governed");
  });

  it("the footer points at the command line's help", () => {
    expect(formatActionList(CTX).join("\n")).to.contain("Command line: `gov help` · `gov <command> --help`");
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
    expect(resolveTopChoice("c", CTX), "c shows the context header again").to.deep.equal({ kind: "context" });
    expect(resolveTopChoice("0", CTX)).to.deep.equal({ kind: "quit" });
    expect(resolveTopChoice("99", CTX)).to.deep.equal({ kind: "unknown" });
  });
});


// Policy Owner, 2026-09-22 — one place for a person's settings, reachable from the menu as well as the CLI.
describe("the menu offers a person their own settings", () => {
  it("Admin → preferences, with list / set / reset / path under it", () => {
    const a = visibleActions({ ...CTX, mode: "governed" }).find((x) => x.label === "Admin");
    const prefs = a && a.kind === "submenu" ? a.commands.find((c) => c.cmd === "preferences") : undefined;
    expect(prefs, "preferences is an Admin command").to.not.equal(undefined);
    expect(prefs!.subs?.map((s) => s.cmd)).to.deep.equal(["list", "set", "reset", "path"]);
  });

  it("display.menuHeader: 'always' redraws the header on every return", () => {
    // The default ("once") is the menu redesign of 361fe04; this is the person's way to have the old behaviour.
    expect(formatMainMenu({ ...CTX, headerEvery: true })).to.deep.equal([...formatMenuHeader(CTX), ...formatActionList(CTX)]);
  });
});
