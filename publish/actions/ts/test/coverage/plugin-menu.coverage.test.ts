// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EXHAUSTIVE (full-cartesian) coverage of the enterprise plugin seam + the
 * interactive menu + both guided flows (Work / Operate). One case per menu path,
 * submenu branch, guided-flow branch, and plugin state. Pure/injected fakes only.
 */
import { expect } from "chai";
import {
  isPluginCommand,
  loadGovOperate,
  runPluginCommand,
  PLUGIN_COMMANDS,
  type PluginCliContext,
  type PluginCliResult,
} from "../../src/plugin/loader.js";
import {
  mainActions,
  formatMainMenu,
  resolveTopChoice,
  type MenuContext,
  type MenuAction,
} from "../../src/cli/menu.js";
import { myProjects, workspaceState, runWorkFlow, type WorkFlowDeps, type WorkProject } from "../../src/cli/work-flow.js";
import { runOperateFlow, OPERATE_ENVS } from "../../src/cli/operate-flow.js";
import type { OrgConfig } from "../../src/config/org-config.js";
import type { Projects } from "../../src/lifecycle/project-list.js";
import type { AnchorCreator, AnchorInfo } from "../../src/lifecycle/anchor.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

// ───────────────────────────────────────────────────────────────────────────
// Plugin seam — src/plugin/loader.ts
// ───────────────────────────────────────────────────────────────────────────

const CTX: PluginCliContext = { home: "/gov", config: {} as OrgConfig, license: "L-123" };
const CTX_NOLICENSE: PluginCliContext = { home: "/gov", config: {} as OrgConfig };

/** A fake plugin that echoes the command, gates on license, and rejects unknown subcommands. */
function fakePlugin(): (name: string) => Promise<unknown> {
  return () =>
    Promise.resolve({
      runCli: (argv: readonly string[], ctx: PluginCliContext): Promise<PluginCliResult> => {
        if (!ctx.license) return Promise.reject(new Error("gov-operate requires a valid license"));
        const [cmd] = argv;
        if (!isPluginCommand(cmd)) return Promise.resolve({ code: 3, lines: [`unknown subcommand: ${cmd}`] });
        return Promise.resolve({ code: 0, lines: [`ran ${argv.join(" ")} (license=${ctx.license})`] });
      },
    });
}

describe("coverage — plugin seam: isPluginCommand (cartesian over every command)", () => {
  for (const cmd of PLUGIN_COMMANDS) {
    it(`isPluginCommand('${cmd}') → true`, () => {
      expect(isPluginCommand(cmd)).to.equal(true);
    });
  }
  for (const cmd of ["seed", "join", "status", "list", "list-all", "manage", "onboard", "help", "", "Deploy", "CATALOG"]) {
    it(`isPluginCommand('${cmd}') → false (non-plugin)`, () => {
      expect(isPluginCommand(cmd)).to.equal(false);
    });
  }
  it("PLUGIN_COMMANDS is exactly deploy/catalog/data/promote/rollback/drift", () => {
    expect([...PLUGIN_COMMANDS]).to.deep.equal(["deploy", "catalog", "data", "promote", "rollback", "drift", "attest", "authorize", "test-spine"]);
  });
});

describe("coverage — plugin seam: loadGovOperate(importer) states", () => {
  it("module present with runCli → ok:true, exposes the plugin", async () => {
    const load = await loadGovOperate(() => Promise.resolve({ runCli: () => Promise.resolve({ code: 0, lines: [] }) }));
    expect(load.ok).to.equal(true);
    if (load.ok) expect(typeof load.plugin.runCli).to.equal("function");
  });
  it("importer throws (sync) → ok:false + install message", async () => {
    const load = await loadGovOperate(() => {
      throw new Error("boom");
    });
    expect(load.ok).to.equal(false);
    if (!load.ok) expect(load.message).to.match(/npm i -g @svayam\/gov-operate/);
  });
  it("importer rejects with ERR_MODULE_NOT_FOUND → ok:false + install message", async () => {
    const err = Object.assign(new Error("Cannot find package"), { code: "ERR_MODULE_NOT_FOUND" });
    const load = await loadGovOperate(() => Promise.reject(err));
    expect(load.ok).to.equal(false);
    if (!load.ok) {
      expect(load.message).to.match(/enterprise command/);
      expect(load.message).to.match(/npm\.svayamtech\.com/);
    }
  });
  it("module present but runCli not a function → ok:false + 'no runCli entry'", async () => {
    const load = await loadGovOperate(() => Promise.resolve({ runCli: 42 }));
    expect(load.ok).to.equal(false);
    if (!load.ok) expect(load.message).to.match(/no `runCli` entry/);
  });
  it("module present but runCli undefined → ok:false + 'no runCli entry'", async () => {
    const load = await loadGovOperate(() => Promise.resolve({ notRunCli: true }));
    expect(load.ok).to.equal(false);
    if (!load.ok) expect(load.message).to.match(/no `runCli` entry/);
  });
  it("default importer (no arg) attempts a real import — installed → ok, else the install hint", async () => {
    const load = await loadGovOperate();
    // Env-dependent: if @svayam/gov-operate is linked/installed it resolves; otherwise not-installed.
    if (load.ok) expect(load.plugin.runCli).to.be.a("function");
    else expect(load.message).to.match(/npm i -g @svayam\/gov-operate/);
  });
});

describe("coverage — plugin seam: runPluginCommand (cartesian over commands + states)", () => {
  it("not-installed → exit 2 + install hint", async () => {
    const r = await runPluginCommand(["deploy"], CTX, () => Promise.reject(new Error("no module")));
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.match(/enterprise command/);
  });
  it("installed but no runCli → exit 2 + update-the-plugin hint", async () => {
    const r = await runPluginCommand(["catalog"], CTX, () => Promise.resolve({ runCli: null }));
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.match(/no `runCli` entry/);
  });

  // Licensed: every plugin command delegates and echoes.
  for (const cmd of PLUGIN_COMMANDS) {
    it(`licensed '${cmd}' → delegates to plugin.runCli (exit 0)`, async () => {
      const r = await runPluginCommand([cmd, "arg1"], CTX, fakePlugin());
      expect(r.code).to.equal(0);
      expect(r.lines[0]).to.equal(`ran ${cmd} arg1 (license=L-123)`);
    });
  }

  // Unlicensed license gate: plugin throws LicenseError → exit 1.
  for (const cmd of PLUGIN_COMMANDS) {
    it(`unlicensed '${cmd}' → LicenseError surfaced as exit 1`, async () => {
      const r = await runPluginCommand([cmd], CTX_NOLICENSE, fakePlugin());
      expect(r.code).to.equal(1);
      expect(r.lines[0]).to.match(/requires a valid license/);
    });
  }

  it("unknown subcommand (licensed) → plugin's own non-zero code passes through", async () => {
    const r = await runPluginCommand(["frobnicate"], CTX, fakePlugin());
    expect(r.code).to.equal(3);
    expect(r.lines[0]).to.match(/unknown subcommand: frobnicate/);
  });
  it("plugin throws a non-Error-shaped rejection → exit 1 with its message", async () => {
    const importer = () => Promise.resolve({ runCli: () => Promise.reject(new Error("kaboom")) });
    const r = await runPluginCommand(["deploy"], CTX, importer);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.equal("kaboom");
  });
  it("plugin returns a rich result (code + lines) verbatim", async () => {
    const importer = () => Promise.resolve({ runCli: () => Promise.resolve({ code: 7, lines: ["a", "b"] }) });
    const r = await runPluginCommand(["catalog", "list"], CTX, importer);
    expect(r).to.deep.equal({ code: 7, lines: ["a", "b"] });
  });
  it("ctx (home/config/license) is forwarded to the plugin", async () => {
    let seen: PluginCliContext | null = null;
    const importer = () =>
      Promise.resolve({
        runCli: (_a: readonly string[], ctx: PluginCliContext) => {
          seen = ctx;
          return Promise.resolve({ code: 0, lines: [] });
        },
      });
    await runPluginCommand(["deploy"], CTX, importer);
    expect(seen).to.equal(CTX);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Menu — src/cli/menu.ts
// ───────────────────────────────────────────────────────────────────────────

const labelsNoOp = ["Status", "Work", "Admin", "Help"];
const labelsOp = ["Status", "Work", "Admin", "Help", "Operate"];

describe("coverage — menu: mainActions (both Operate states)", () => {
  it("mainActions(false) → 4 actions, no Operate", () => {
    const a = mainActions(false);
    expect(a.map((x) => x.label)).to.deep.equal(labelsNoOp);
    expect(a.find((x) => x.label === "Operate")).to.equal(undefined);
  });
  it("mainActions() default → same as false", () => {
    expect(mainActions().map((x) => x.label)).to.deep.equal(labelsNoOp);
  });
  it("mainActions(true) → 5 actions, Operate is action 5 and guided", () => {
    const a = mainActions(true);
    expect(a.map((x) => x.label)).to.deep.equal(labelsOp);
    expect(a[4].label).to.equal("Operate");
    expect(a[4].kind).to.equal("guided");
  });
  it("kinds are stable: Status/Admin submenu, Work/Operate guided, Help help", () => {
    const a = mainActions(true);
    const kind = (l: string) => a.find((x) => x.label === l)!.kind;
    expect(kind("Status")).to.equal("submenu");
    expect(kind("Admin")).to.equal("submenu");
    expect(kind("Work")).to.equal("guided");
    expect(kind("Operate")).to.equal("guided");
    expect(kind("Help")).to.equal("help");
  });
  it("Status submenu lists list/list-all/status", () => {
    const s = mainActions(false).find((x) => x.label === "Status") as Extract<MenuAction, { kind: "submenu" }>;
    expect(s.commands.map((c) => c.cmd)).to.deep.equal(["list", "list-all", "status"]);
  });
  it("Admin submenu lists all 7 governance commands", () => {
    const s = mainActions(false).find((x) => x.label === "Admin") as Extract<MenuAction, { kind: "submenu" }>;
    expect(s.commands.map((c) => c.cmd)).to.deep.equal(["manage", "knowledge", "onboard", "add-repo", "org", "upgrade", "deps"]);
  });
});

describe("coverage — menu: formatMainMenu banner variants (cartesian over fields)", () => {
  it("full context: banner + org/branch/user line + workspace line + action table", () => {
    const ctx: MenuContext = { orgName: "Acme Inc", githubOrg: "Acme", branch: "main", user: "rk", workspaceCount: 2, cliVersion: "1.0.0" };
    const m = formatMainMenu(ctx).join("\n");
    expect(m).to.match(/▸ Acme Inc — Governed Agentic Development Framework \(v1\.0\.0\)/);
    expect(m).to.match(/Org: Acme {2}\| {2}Branch: main {2}\| {2}User: rk/);
    expect(m).to.match(/2 governance workspace\(s\) registered/);
    expect(m).to.match(/\(2\) Work.*pick a project/);
  });
  it("no orgName → default framework title", () => {
    const m = formatMainMenu({ cliVersion: "1.0.0" }).join("\n");
    expect(m).to.match(/▸ Governed Agentic Development Framework — Governed Agentic Development Framework/);
  });
  it("no cliVersion → (v?)", () => {
    const m = formatMainMenu({}).join("\n");
    expect(m).to.match(/\(v\?\)/);
  });
  it("no githubOrg/branch/user → the info line is omitted entirely", () => {
    const m = formatMainMenu({ workspaceCount: 1 }).join("\n");
    expect(m).to.not.match(/Org: /);
    expect(m).to.not.match(/Branch: /);
    expect(m).to.not.match(/User: /);
  });
  it("only githubOrg present → info line shows just Org", () => {
    const m = formatMainMenu({ githubOrg: "Acme" }).join("\n");
    expect(m).to.match(/ {2}Org: Acme$/m);
    expect(m).to.not.match(/Branch:/);
    expect(m).to.not.match(/User:/);
  });
  it("only branch present → info line shows just Branch", () => {
    const m = formatMainMenu({ branch: "dev" }).join("\n");
    expect(m).to.match(/ {2}Branch: dev$/m);
  });
  it("only user present → info line shows just User", () => {
    const m = formatMainMenu({ user: "rk" }).join("\n");
    expect(m).to.match(/ {2}User: rk$/m);
  });
  it("workspaceCount undefined → no workspace line", () => {
    const m = formatMainMenu({ githubOrg: "Acme" }).join("\n");
    expect(m).to.not.match(/governance workspace\(s\) registered/);
  });
  it("workspaceCount 0 → workspace line still shown (0 is defined)", () => {
    const m = formatMainMenu({ workspaceCount: 0 }).join("\n");
    expect(m).to.match(/0 governance workspace\(s\) registered/);
  });
  it("operateInstalled false → hides Operate, shows plugin-needed hint", () => {
    const m = formatMainMenu({ operateInstalled: false }).join("\n");
    expect(m).to.not.match(/\bOperate\b/);
    expect(m).to.match(/need the enterprise plugin/);
    expect(m).to.match(/npm i -g @svayam\/gov-operate/);
  });
  it("operateInstalled true → shows Operate as action (5), hides the plugin hint", () => {
    const m = formatMainMenu({ operateInstalled: true }).join("\n");
    expect(m).to.match(/\(5\) Operate/);
    expect(m).to.not.match(/need the enterprise plugin/);
  });
  it("submenu 'Goes to' column joins first commands with ·", () => {
    const m = formatMainMenu({ operateInstalled: false }).join("\n");
    expect(m).to.match(/\(1\) Status.*list · list-all · status/);
  });
  it("Admin submenu (>4 commands) truncates 'Goes to' with an ellipsis", () => {
    const m = formatMainMenu({ operateInstalled: false }).join("\n");
    expect(m).to.match(/\(3\) Admin.*manage · knowledge · onboard · add-repo · …/);
  });
  it("always ends with the type-a-number footer + rule", () => {
    const m = formatMainMenu({});
    expect(m.join("\n")).to.match(/Type a number; o to switch org; 0 to exit\./);
  });
});

describe("coverage — menu: resolveTopChoice (cartesian: every input × both Operate states)", () => {
  const NO: MenuContext = { operateInstalled: false };
  const OP: MenuContext = { operateInstalled: true };
  const actionAt = (r: ReturnType<typeof resolveTopChoice>): string => (r as { action: MenuAction }).action.label;

  // Numbers 1..N — operateInstalled false (N=4)
  for (const [n, label] of [["1", "Status"], ["2", "Work"], ["3", "Admin"], ["4", "Help"]] as const) {
    it(`[no-operate] number '${n}' → ${label}`, () => {
      const r = resolveTopChoice(n, NO);
      expect(r.kind).to.equal("action");
      expect(actionAt(r)).to.equal(label);
    });
  }
  it("[no-operate] number '5' → unknown (out of range)", () => {
    expect(resolveTopChoice("5", NO)).to.deep.equal({ kind: "unknown" });
  });

  // Numbers 1..N — operateInstalled true (N=5)
  for (const [n, label] of [["1", "Status"], ["2", "Work"], ["3", "Admin"], ["4", "Help"], ["5", "Operate"]] as const) {
    it(`[operate] number '${n}' → ${label}`, () => {
      const r = resolveTopChoice(n, OP);
      expect(r.kind).to.equal("action");
      expect(actionAt(r)).to.equal(label);
    });
  }
  it("[operate] number '6' → unknown (out of range)", () => {
    expect(resolveTopChoice("6", OP)).to.deep.equal({ kind: "unknown" });
  });

  // Labels (case-insensitive) — both states
  for (const label of labelsNoOp) {
    it(`[no-operate] label '${label}' → ${label}`, () => {
      expect(actionAt(resolveTopChoice(label, NO))).to.equal(label);
    });
    it(`[no-operate] lowercased label '${label.toLowerCase()}' → ${label}`, () => {
      expect(actionAt(resolveTopChoice(label.toLowerCase(), NO))).to.equal(label);
    });
  }
  it("[no-operate] label 'Operate' → unknown (not installed)", () => {
    expect(resolveTopChoice("Operate", NO)).to.deep.equal({ kind: "unknown" });
  });
  it("[operate] label 'operate' → Operate", () => {
    expect(actionAt(resolveTopChoice("operate", OP))).to.equal("Operate");
  });

  // Keys — both states
  for (const [key, label] of [["status", "Status"], ["work", "Work"], ["admin", "Admin"], ["help", "Help"]] as const) {
    it(`[no-operate] key '${key}' → ${label}`, () => {
      expect(actionAt(resolveTopChoice(key, NO))).to.equal(label);
    });
  }
  it("[operate] key 'operate' → Operate", () => {
    expect(actionAt(resolveTopChoice("operate", OP))).to.equal("Operate");
  });
  it("[no-operate] key 'operate' → unknown (not installed)", () => {
    expect(resolveTopChoice("operate", NO)).to.deep.equal({ kind: "unknown" });
  });

  // Org
  it("'o' → org", () => expect(resolveTopChoice("o", NO)).to.deep.equal({ kind: "org" }));
  it("'O' (uppercase) → org", () => expect(resolveTopChoice("O", NO)).to.deep.equal({ kind: "org" }));

  // Quit variants
  for (const q of ["0", "q", "Q", "", "   ", "\t"]) {
    it(`quit input ${JSON.stringify(q)} → quit`, () => {
      expect(resolveTopChoice(q, NO)).to.deep.equal({ kind: "quit" });
    });
  }

  // Unknown variants
  for (const u of ["99", "-1", "3.5", "xyz", "wor", "1a", "status2"]) {
    it(`unknown input ${JSON.stringify(u)} → unknown`, () => {
      expect(resolveTopChoice(u, NO)).to.deep.equal({ kind: "unknown" });
    });
  }
  it("whitespace-padded number '  2  ' → Work (trimmed)", () => {
    expect(actionAt(resolveTopChoice("  2  ", NO))).to.equal("Work");
  });
  it("mixed-case label '  WoRk ' → Work (trim + lowercase)", () => {
    expect(actionAt(resolveTopChoice("  WoRk ", NO))).to.equal("Work");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Guided Work flow — src/cli/work-flow.ts
// ───────────────────────────────────────────────────────────────────────────

const projectsFrom = (boards: Array<{ number: number; title: string; closed?: boolean; url?: string }>): Projects => ({
  listBoards: () =>
    boards.map((b) => ({
      number: b.number,
      title: b.title,
      url: b.url ?? `https://github.com/orgs/Acme/projects/${b.number}`,
      closed: b.closed ?? false,
    })),
});
const anchorFor = (byNum: Record<number, { assignees: string[]; labels?: string[] }>): AnchorCreator => ({
  createAnchorIssue: () => null,
  setState: () => true,
  setAssignee: () => true,
  find: (ref) =>
    byNum[ref.number]
      ? ({ url: "u#1", number: 1, labels: byNum[ref.number].labels ?? [], assignees: byNum[ref.number].assignees } as AnchorInfo)
      : null,
});
const fsWith = (paths: string[]): Fs => ({
  pathExists: (p) => paths.some((x) => x === p || x.startsWith(p + "/")),
  readFile: () => null,
  writeFile() {},
  mkdirp() {},
  rm() {},
  readdir: () => [],
});

function workDeps(over: Partial<WorkFlowDeps> = {}): { deps: WorkFlowDeps; out: string[]; ran: string[][] } {
  const out: string[] = [];
  const ran: string[][] = [];
  const base: WorkFlowDeps = {
    projects: projectsFrom([{ number: 7, title: "Alpha" }, { number: 8, title: "Beta" }]),
    anchor: anchorFor({ 7: { assignees: ["rk"] }, 8: { assignees: ["someone-else"] } }),
    fs: fsWith([]),
    config: { githubOrg: "Acme", workspaceRepo: "acme-gov", agentWorkRoot: "/work" },
    me: "rk",
    canWriteBoard: () => true,
    run: (argv) => {
      ran.push([...argv]);
      return 0;
    },
    prompt: async () => "1",
    print: (l) => out.push(l),
    ...over,
  };
  return { deps: base, out, ran };
}

describe("coverage — Work flow: myProjects (cartesian over assignment/board states)", () => {
  it("me null → [] (nobody to filter by)", () => {
    const { deps: d } = workDeps({ me: null });
    expect(myProjects(d)).to.deep.equal([]);
  });
  it("no boards → []", () => {
    const { deps: d } = workDeps({ projects: projectsFrom([]) });
    expect(myProjects(d)).to.deep.equal([]);
  });
  it("board where I'm the anchor assignee → included", () => {
    const { deps: d } = workDeps();
    const mine = myProjects(d);
    expect(mine.map((p) => p.boardNumber)).to.deep.equal([7]);
    expect(mine[0].projectId).to.equal("PRJ-7-alpha");
  });
  it("board where I'm NOT an assignee → excluded", () => {
    const { deps: d } = workDeps({ anchor: anchorFor({ 8: { assignees: ["x"] } }) });
    expect(myProjects(d)).to.deep.equal([]);
  });
  it("board with no anchor at all → excluded", () => {
    const { deps: d } = workDeps({ anchor: anchorFor({}) });
    expect(myProjects(d)).to.deep.equal([]);
  });
  it("closed boards are excluded even when I'm the assignee", () => {
    const { deps: d } = workDeps({
      projects: projectsFrom([{ number: 7, title: "Alpha", closed: true }]),
      anchor: anchorFor({ 7: { assignees: ["rk"] } }),
    });
    expect(myProjects(d)).to.deep.equal([]);
  });
  it("multiple boards → only mine are returned, in board order", () => {
    const { deps: d } = workDeps({
      projects: projectsFrom([{ number: 7, title: "Alpha" }, { number: 8, title: "Beta" }, { number: 9, title: "Gamma" }]),
      anchor: anchorFor({ 7: { assignees: ["rk"] }, 8: { assignees: ["x"] }, 9: { assignees: ["rk", "y"] } }),
    });
    expect(myProjects(d).map((p) => p.boardNumber)).to.deep.equal([7, 9]);
  });
  it("status derives from anchor labels (paused label → paused)", () => {
    const { deps: d } = workDeps({ anchor: anchorFor({ 7: { assignees: ["rk"], labels: ["paused"] } }) });
    expect(myProjects(d)[0].status).to.equal("paused");
  });
  it("bad board URL (unparseable) → PRJ-<n> projectId fallback", () => {
    const { deps: d } = workDeps({
      projects: projectsFrom([{ number: 7, title: "Alpha", url: "not-a-board-url" }]),
      anchor: anchorFor({ 7: { assignees: ["rk"] } }),
    });
    expect(myProjects(d)[0].projectId).to.equal("PRJ-7");
  });
  it("empty-slug title (no ASCII alnum) → PRJ-<n> fallback", () => {
    const { deps: d } = workDeps({
      projects: projectsFrom([{ number: 7, title: "＊＊＊" }]),
      anchor: anchorFor({ 7: { assignees: ["rk"] } }),
    });
    expect(myProjects(d)[0].projectId).to.equal("PRJ-7");
  });
  it("honors ownerField=user in the anchor ref", () => {
    let seenField: string | null = null;
    const anchor: AnchorCreator = {
      createAnchorIssue: () => null,
      setState: () => true,
      setAssignee: () => true,
      find: (ref) => {
        seenField = ref.ownerField;
        return { url: "u", number: 1, labels: [], assignees: ["rk"] } as AnchorInfo;
      },
    };
    const { deps: d } = workDeps({ anchor, config: { githubOrg: "Acme", workspaceRepo: "acme-gov", agentWorkRoot: "/work", ownerField: "user" } });
    myProjects(d);
    expect(seenField).to.equal("user");
  });
});

describe("coverage — Work flow: workspaceState (not-seeded/not-cloned/ready)", () => {
  const p: WorkProject = { boardNumber: 7, title: "Alpha", url: "u", status: "active", projectId: "PRJ-7-alpha" };
  it("project root missing → not-seeded", () => {
    expect(workspaceState(workDeps({ fs: fsWith([]) }).deps, p)).to.equal("not-seeded");
  });
  it("root exists but no repo/.git → not-cloned", () => {
    expect(workspaceState(workDeps({ fs: fsWith(["/work/PRJ-7-alpha"]) }).deps, p)).to.equal("not-cloned");
  });
  it("repo/.git exists → ready", () => {
    expect(workspaceState(workDeps({ fs: fsWith(["/work/PRJ-7-alpha/acme-gov/.git"]) }).deps, p)).to.equal("ready");
  });
});

describe("coverage — Work flow: runWorkFlow (cartesian over pick × state × access)", () => {
  it("no projects → guidance, exit 0", async () => {
    const { deps: d, out } = workDeps({ anchor: anchorFor({}) });
    expect(await runWorkFlow(d)).to.equal(0);
    expect(out.join("\n")).to.match(/No active projects assigned to you \(rk\)/);
    expect(out.join("\n")).to.match(/Get assigned first/);
  });
  it("no projects + me null → guidance without the (me) suffix", async () => {
    const { deps: d, out } = workDeps({ me: null });
    expect(await runWorkFlow(d)).to.equal(0);
    expect(out.join("\n")).to.match(/No active projects assigned to you\./);
  });
  it("pick back '0' → exit 0, nothing run", async () => {
    const { deps: d, ran } = workDeps({ prompt: async () => "0" });
    expect(await runWorkFlow(d)).to.equal(0);
    expect(ran).to.deep.equal([]);
  });
  it("pick back '' (blank) → exit 0, nothing run", async () => {
    const { deps: d, ran } = workDeps({ prompt: async () => "" });
    expect(await runWorkFlow(d)).to.equal(0);
    expect(ran).to.deep.equal([]);
  });
  it("unknown pick (out of range) → 'unknown choice', exit 2", async () => {
    const { deps: d, out } = workDeps({ prompt: async () => "99" });
    expect(await runWorkFlow(d)).to.equal(2);
    expect(out.join("\n")).to.match(/unknown choice/);
  });
  it("unknown pick (non-numeric) → exit 2", async () => {
    const { deps: d } = workDeps({ prompt: async () => "zzz" });
    expect(await runWorkFlow(d)).to.equal(2);
  });
  it("canWriteBoard false → block, exit 1", async () => {
    const { deps: d, out } = workDeps({ canWriteBoard: () => false, prompt: async () => "1" });
    expect(await runWorkFlow(d)).to.equal(1);
    expect(out.join("\n")).to.match(/don't have write access/);
    expect(out.join("\n")).to.match(/Ask an owner to grant access/);
  });
  it("not-seeded → runs `seed <url> <me>`, then session-start guidance, exit 0", async () => {
    const { deps: d, out, ran } = workDeps({ fs: fsWith([]), prompt: async () => "1" });
    expect(await runWorkFlow(d)).to.equal(0);
    expect(ran[0]).to.deep.equal(["seed", "https://github.com/orgs/Acme/projects/7", "rk"]);
    expect(out.join("\n")).to.match(/is ready at/);
    expect(out.join("\n")).to.match(/session-start protocol/);
  });
  it("not-seeded seed argv includes me as the assignee", async () => {
    const { deps: d, ran } = workDeps({ fs: fsWith([]), prompt: async () => "1" });
    await runWorkFlow(d);
    expect(ran[0]).to.include("rk");
  });
  it("not-cloned → runs `join <projectId>`, then guidance, exit 0", async () => {
    const { deps: d, out, ran } = workDeps({ fs: fsWith(["/work/PRJ-7-alpha"]), prompt: async () => "1" });
    expect(await runWorkFlow(d)).to.equal(0);
    expect(ran[0]).to.deep.equal(["join", "PRJ-7-alpha"]);
    expect(out.join("\n")).to.match(/Cloning your workspace/);
  });
  it("ready → no seed/join run, straight to session-start guidance, exit 0", async () => {
    const { deps: d, out, ran } = workDeps({ fs: fsWith(["/work/PRJ-7-alpha/acme-gov/.git"]), prompt: async () => "1" });
    expect(await runWorkFlow(d)).to.equal(0);
    expect(ran).to.deep.equal([]);
    expect(out.join("\n")).to.match(/is ready at/);
    expect(out.join("\n")).to.match(/cd "\/work\/PRJ-7-alpha\/acme-gov"/);
  });
  it("seed non-zero exit propagates (no guidance printed)", async () => {
    const { deps: d, out } = workDeps({ fs: fsWith([]), prompt: async () => "1", run: () => 42 });
    expect(await runWorkFlow(d)).to.equal(42);
    expect(out.join("\n")).to.not.match(/is ready at/);
  });
  it("join non-zero exit propagates", async () => {
    const { deps: d } = workDeps({ fs: fsWith(["/work/PRJ-7-alpha"]), prompt: async () => "1", run: () => 9 });
    expect(await runWorkFlow(d)).to.equal(9);
  });
  it("seed run() may be async → awaited exit code propagates", async () => {
    const { deps: d } = workDeps({ fs: fsWith([]), prompt: async () => "1", run: async () => 5 });
    expect(await runWorkFlow(d)).to.equal(5);
  });
  it("picks the SECOND of my projects by index", async () => {
    const { deps: d, ran } = workDeps({
      projects: projectsFrom([{ number: 7, title: "Alpha" }, { number: 9, title: "Gamma" }]),
      anchor: anchorFor({ 7: { assignees: ["rk"] }, 9: { assignees: ["rk"] } }),
      fs: fsWith([]),
      prompt: async () => "2",
    });
    expect(await runWorkFlow(d)).to.equal(0);
    expect(ran[0][1]).to.match(/projects\/9/); // seeded the second project (board 9)
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Guided Operate flow — src/cli/operate-flow.ts
// ───────────────────────────────────────────────────────────────────────────

function operate(answers: string[]): { run: OperateDeps["run"]; prompt: OperateDeps["prompt"]; print: OperateDeps["print"]; ran: string[][]; out: string[] } {
  const ran: string[][] = [];
  const out: string[] = [];
  let i = 0;
  return {
    run: (a) => {
      ran.push([...a]);
      return 0;
    },
    prompt: async () => answers[i++] ?? "",
    print: (l) => out.push(l),
    ran,
    out,
  };
}
type OperateDeps = Parameters<typeof runOperateFlow>[0];

describe("coverage — Operate flow: runOperateFlow (cartesian over verb × unit × env)", () => {
  it("exposes envs local/dev/uat/prod", () => {
    expect([...OPERATE_ENVS]).to.deep.equal(["local", "dev", "uat", "prod"]);
  });
  it("catalog '1' → list '1' → `catalog list`, exit 0", async () => {
    const o = operate(["1", "1"]);
    expect(await runOperateFlow(o)).to.equal(0);
    expect(o.ran[0]).to.deep.equal(["catalog", "list"]);
  });
  it("catalog '1' → create '2' → prompts → `catalog create <id> --flags…`", async () => {
    const o = operate(["1", "2", "gov-work", "cli", "node", "npm", "acme", "svayam/repo", "p", "", "", "", "https://registry.npmjs.org", "why"]);
    expect(await runOperateFlow(o)).to.equal(0);
    expect(o.ran[0].slice(0, 3)).to.deep.equal(["catalog", "create", "gov-work"]);
    expect(o.ran[0]).to.include.members(["--type", "cli", "--registry", "prod=https://registry.npmjs.org"]);
  });
  it("back '0' → exit 0, nothing run", async () => {
    const o = operate(["0"]);
    expect(await runOperateFlow(o)).to.equal(0);
    expect(o.ran).to.deep.equal([]);
  });
  it("back '' (blank) → exit 0, nothing run", async () => {
    const o = operate([""]);
    expect(await runOperateFlow(o)).to.equal(0);
    expect(o.ran).to.deep.equal([]);
  });
  it("unknown top choice → 'unknown choice', exit 2", async () => {
    const o = operate(["9"]);
    expect(await runOperateFlow(o)).to.equal(2);
    expect(o.out.join("\n")).to.match(/unknown choice/);
  });

  // deploy (2) and data (3) × each valid env → `<verb> <unit> <env>` (positional)
  for (const [choice, verb] of [["2", "deploy"], ["3", "data"]] as const) {
    for (const env of OPERATE_ENVS) {
      it(`${verb} '${choice}' + unit + env '${env}' → \`${verb} <unit> ${env}\``, async () => {
        const o = operate([choice, "svc-a", env]);
        expect(await runOperateFlow(o)).to.equal(0);
        expect(o.ran[0]).to.deep.equal([verb, "svc-a", env]);
      });
    }
    it(`${verb} '${choice}' with missing unit (blank) → 'a unit is required', exit 2`, async () => {
      const o = operate([choice, "", "prod"]);
      expect(await runOperateFlow(o)).to.equal(2);
      expect(o.out.join("\n")).to.match(/a unit is required/);
      expect(o.ran).to.deep.equal([]);
    });
    it(`${verb} '${choice}' with bad env → 'env must be one of', exit 2`, async () => {
      const o = operate([choice, "svc-a", "banana"]);
      expect(await runOperateFlow(o)).to.equal(2);
      expect(o.out.join("\n")).to.match(/env must be one of: local, dev, uat, prod/);
      expect(o.ran).to.deep.equal([]);
    });
    it(`${verb} '${choice}' with empty env → exit 2`, async () => {
      const o = operate([choice, "svc-a", ""]);
      expect(await runOperateFlow(o)).to.equal(2);
    });
  }

  // promote (4) → `promote <unit> <from> <to>`
  it("promote '4' + unit + from + to → `promote <unit> <from> <to>`", async () => {
    const o = operate(["4", "svc-a", "uat", "prod"]);
    expect(await runOperateFlow(o)).to.equal(0);
    expect(o.ran[0]).to.deep.equal(["promote", "svc-a", "uat", "prod"]);
  });
  it("promote '4' with missing 'to' → exit 2, nothing run", async () => {
    const o = operate(["4", "svc-a", "uat", ""]);
    expect(await runOperateFlow(o)).to.equal(2);
    expect(o.ran).to.deep.equal([]);
  });

  it("deploy run() async → awaited exit code propagates", async () => {
    let i = 0;
    const answers = ["2", "svc-a", "prod"];
    const code = await runOperateFlow({ run: async () => 11, prompt: async () => answers[i++] ?? "", print: () => {} });
    expect(code).to.equal(11);
  });
  it("unit is trimmed before use", async () => {
    const o = operate(["2", "  svc-b  ", "dev"]);
    expect(await runOperateFlow(o)).to.equal(0);
    expect(o.ran[0]).to.deep.equal(["deploy", "svc-b", "dev"]);
  });
});
