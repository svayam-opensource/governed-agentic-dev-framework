// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { mainActions, visibleActions, formatMainMenu, resolveTopChoice, contextEnvs, type MenuContext, type OperateVerb } from "../../src/cli/menu.js";
import { isGovernedInvocation } from "../../src/cli/host.js";

const CTX: MenuContext = { orgName: "Acme Inc", githubOrg: "Acme", branch: "main", user: "rk", workspaceCount: 2, cliVersion: "1.0.0" };

// A realistic slice of what `gov-operate menu --json` contributes.
const OPERATE: OperateVerb[] = [
  { cmd: "build", desc: "build from a line-head", scopes: ["governed"], argHint: "<unit>", flagArgs: [{ name: "ref", hint: "ref", optional: true }] },
  { cmd: "deploy", desc: "converge + gate", scopes: ["project", "governed"], argHint: "<unit>", flagArgs: [{ name: "env", hint: "env", kind: "env" }] },
  { cmd: "drift", desc: "show drift", scopes: ["project", "governed"], argHint: "<unit>", flagArgs: [{ name: "env", hint: "env", kind: "env" }] },
  { cmd: "promote", desc: "promote", scopes: ["governed"], argHint: "<unit>", flagArgs: [{ name: "from", hint: "from", kind: "env" }, { name: "to", hint: "to", kind: "env" }] },
  { cmd: "rollback", desc: "roll back", scopes: ["governed"], argHint: "<unit>", flagArgs: [{ name: "env", hint: "env", kind: "env" }, { name: "to-sha", hint: "sha" }] },
];

const labels = (ctx: MenuContext, op: OperateVerb[] = []): string[] => visibleActions(ctx, op).map((a) => a.label);
const adminCmds = (ctx: MenuContext): string[] => {
  const a = visibleActions(ctx).find((x) => x.label === "Admin");
  return a && a.kind === "submenu" ? a.commands.map((c) => c.cmd) : [];
};
const operateCmds = (ctx: MenuContext, op: OperateVerb[]): string[] => {
  const a = visibleActions(ctx, op).find((x) => x.label === "Operate");
  return a && a.kind === "submenu" ? a.commands.map((c) => c.cmd) : [];
};

describe("gov-work — interactive menu (context-scoped)", () => {
  it("mainActions() is the FULL definition; no Operate submenu unless the plugin contributes verbs", () => {
    expect(mainActions().find((x) => x.label === "Operate")).to.equal(undefined);
    expect(mainActions(OPERATE).find((x) => x.label === "Operate")).to.not.equal(undefined);
  });

  it("GOVERNED context: governance admin + listing + all operate verbs are visible", () => {
    const g = { ...CTX, mode: "governed" as const };
    expect(labels(g, OPERATE)).to.deep.equal(["Status", "Work", "Operate", "Admin", "Help"]);
    expect(adminCmds(g)).to.deep.equal(["knowledge", "onboard", "org", "upgrade", "deps"]);   // project-only manage/add-repo hidden
    expect(operateCmds(g, OPERATE)).to.deep.equal(["build", "deploy", "drift", "promote", "rollback"]);
  });

  it("PROJECT context: project admin only; build/promote/rollback (governed-only) are hidden from Operate", () => {
    const p = { ...CTX, mode: "project" as const, project: "PRJ-43" };
    expect(adminCmds(p)).to.deep.equal(["manage", "add-repo"]);                 // governance admin hidden
    expect(operateCmds(p, OPERATE)).to.deep.equal(["deploy", "drift"]);         // build/promote/rollback are governed-only
    const status = visibleActions(p).find((a) => a.label === "Status");
    expect(status && status.kind === "submenu" ? status.commands.map((c) => c.cmd) : []).to.deep.equal(["status"]);  // list/list-all governed-only
  });

  it("UX-flow: EVERY Operate verb the menu can dispatch is delegated to the plugin (no 'unknown command')", () => {
    // Regression guard (2026-07-17): the menu advertised `build` (from the plugin manifest) but the host's
    // delegation set (OPERATE_COMMANDS) lacked it → picking it printed "unknown command 'build'". Any verb the
    // menu can show MUST route to gov-operate.
    for (const v of OPERATE) {
      expect(isGovernedInvocation([v.cmd]), `menu verb '${v.cmd}' must delegate to gov-operate`).to.equal(true);
      expect(isGovernedInvocation(["--gov-home", "/x", v.cmd]), `'${v.cmd}' must delegate past value-flags`).to.equal(true);
    }
  });

  it("UX-flow: `build` is GOVERNED-only — shown in GOVERNED Operate, HIDDEN in PROJECT (which is local-only)", () => {
    // Regression guard (2026-07-17): build births to the dev channel (a governed op); it once leaked into the
    // PROJECT menu and prompted for --ref where only local sandbox builds belong. Keep it out of PROJECT.
    expect(operateCmds({ ...CTX, mode: "governed" }, OPERATE)).to.include("build");
    expect(operateCmds({ ...CTX, mode: "project", project: "PRJ-43" }, OPERATE)).to.not.include("build");
  });

  it("NONE context: empty submenus disappear — only Work (setup) + Help remain", () => {
    expect(labels({ ...CTX, mode: "none" }, OPERATE)).to.deep.equal(["Work", "Help"]);
  });

  it("contextEnvs: PROJECT = local only; GOVERNED/other = dev/uat/prod", () => {
    expect(contextEnvs("project")).to.deep.equal(["local"]);
    expect(contextEnvs("governed")).to.deep.equal(["dev", "uat", "prod"]);
  });

  it("numbering matches between render and resolveTopChoice under the SAME context", () => {
    const g = { ...CTX, mode: "governed" as const };
    const rendered = visibleActions(g, OPERATE).map((a) => a.label);
    rendered.forEach((label, i) => {
      const r = resolveTopChoice(String(i + 1), g, OPERATE);
      expect(r.kind === "action" && r.action.label).to.equal(label);
    });
  });

  it("renders the banner + context line; Work adapts per mode", () => {
    const m = formatMainMenu(CTX).join("\n");
    expect(m).to.match(/▸ Acme Inc — Governed Agentic Development Framework \(v1\.0\.0\)/);
    const p = formatMainMenu({ ...CTX, mode: "project", project: "PRJ-43" }, OPERATE).join("\n");
    expect(p).to.match(/Context: PROJECT \(PRJ-43\)/);
    expect(p).to.match(/Work.*Continue the current project/);
    expect(p).to.match(/Operate/);   // plugin verbs surface in the menu now
    expect(formatMainMenu({ ...CTX, mode: "governed" }, OPERATE).join("\n")).to.match(/Context: GOVERNED/);
  });

  it("resolves o / quit / unknown", () => {
    expect(resolveTopChoice("o", CTX)).to.deep.equal({ kind: "org" });
    expect(resolveTopChoice("0", CTX)).to.deep.equal({ kind: "quit" });
    expect(resolveTopChoice("99", CTX)).to.deep.equal({ kind: "unknown" });
  });
});
