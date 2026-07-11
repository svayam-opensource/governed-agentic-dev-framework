// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The interactive menu (`gov-work` with no args on a TTY) — a TASK-ORIENTED on-ramp
 * (mirrors the legacy `prj` menu), not a command index. The goal is to get a
 * developer working fast:
 *   Status  → review (list · list-all · status)
 *   Work    → GUIDED flow: pick your project → seed-if-new / continue → session-start
 *   Admin   → curated governance actions (manage · knowledge · onboard · …)
 *   Help    → the full command reference (for agents/devs working in TTY)
 * Rendering + choice-resolution are pure/testable; runMenu delegates the guided
 * flows + command runs to injected handlers. (Enterprise catalog/deploy is a
 * SEPARATE CLI, `gov-operate` — this menu has no knowledge of it.)
 */
import * as readline from "node:readline";

export interface MenuContext {
  readonly orgName?: string;
  readonly githubOrg?: string;
  readonly branch?: string;
  readonly user?: string;
  readonly workspaceCount?: number;
  readonly cliVersion?: string;
}

export interface SubCommand { readonly cmd: string; readonly desc: string; readonly argHint?: string; readonly subs?: readonly SubCommand[]; }
export type MenuAction =
  | { readonly kind: "guided"; readonly key: "work"; readonly label: string; readonly desc: string; readonly hint: string }
  | { readonly kind: "submenu"; readonly key: "status" | "admin"; readonly label: string; readonly desc: string; readonly commands: readonly SubCommand[] }
  | { readonly kind: "help"; readonly key: "help"; readonly label: string; readonly desc: string; readonly hint: string };

/** The main-menu actions. */
export function mainActions(): MenuAction[] {
  const actions: MenuAction[] = [
    { kind: "submenu", key: "status", label: "Status", desc: "Review current state", commands: [
      { cmd: "list", desc: "ongoing projects" },
      { cmd: "list-all", desc: "all projects (incl. closed)" },
      { cmd: "status", desc: "detailed status of one project", argHint: "<project> (blank = pick)" },
    ] },
    { kind: "guided", key: "work", label: "Work", desc: "Start / continue a project", hint: "pick a project" },
    { kind: "submenu", key: "admin", label: "Admin", desc: "Administer governance", commands: [
      { cmd: "manage", desc: "project access — assign / unassign owners", subs: [
        { cmd: "assign", desc: "grant a user project access", argHint: "<github-login>" },
        { cmd: "unassign", desc: "revoke access", argHint: "<github-login>" },
      ] },
      { cmd: "knowledge", desc: "propose org knowledge changes", subs: [
        { cmd: "propose", desc: "start a knowledge change", argHint: "<slug>" },
        { cmd: "submit", desc: "open a PR for a change", argHint: "<slug> [description]" },
        { cmd: "archive", desc: "retire a knowledge item", argHint: "<slug>" },
      ] },
      { cmd: "onboard", desc: "onboard a repository into the framework", argHint: "<repo-url> <owner> <description>" },
      { cmd: "add-repo", desc: "add a repository to a project", argHint: "<repo-url>" },
      { cmd: "org", desc: "manage governance workspaces", subs: [
        { cmd: "use", desc: "switch the active org", argHint: "<github_org>" },
        { cmd: "add", desc: "register a governance workspace", argHint: "<github_org> <home-path>" },
        { cmd: "list", desc: "registered workspaces" },
        { cmd: "remove", desc: "deregister a workspace", argHint: "<github_org>" },
      ] },
      { cmd: "upgrade", desc: "pull the latest framework content" },
      { cmd: "deps", desc: "install / verify dependencies" },
    ] },
    { kind: "help", key: "help", label: "Help", desc: "gov command-line use", hint: "pick a command" },
  ];
  return actions;
}

const RULE = "─".repeat(72);

export function formatMainMenu(ctx: MenuContext): string[] {
  const actions = mainActions();
  const out: string[] = ["", `  ▸ ${ctx.orgName ?? "Governed Agentic Development Framework"} — Governed Agentic Development Framework (v${ctx.cliVersion ?? "?"})`];
  const bits = [ctx.githubOrg && `Org: ${ctx.githubOrg}`, ctx.branch && `Branch: ${ctx.branch}`, ctx.user && `User: ${ctx.user}`].filter(Boolean) as string[];
  if (bits.length) out.push(`  ${bits.join("  |  ")}`);
  if (ctx.workspaceCount !== undefined) out.push(`  ${ctx.workspaceCount} governance workspace(s) registered — press o to switch the active org.`);
  out.push("", RULE, "", `  ${"Action".padEnd(10)}  ${"Description".padEnd(32)}  Goes to`, `  ${"-".repeat(10)}  ${"-".repeat(32)}  ${"-".repeat(30)}`);
  actions.forEach((a, i) => {
    const goesTo = a.kind === "submenu" ? a.commands.map((c) => c.cmd).slice(0, 4).join(" · ") + (a.commands.length > 4 ? " · …" : "") : a.hint;
    out.push(`  (${i + 1}) ${a.label.padEnd(6)}  ${a.desc.padEnd(32)}  ${goesTo}`);
  });
  out.push("", "  Type a number; o to switch org; 0 to exit.", RULE);
  return out;
}

export type TopChoice =
  | { readonly kind: "action"; readonly action: MenuAction }
  | { readonly kind: "org" }
  | { readonly kind: "quit" }
  | { readonly kind: "unknown" };

export function resolveTopChoice(input: string, _ctx?: MenuContext): TopChoice {
  const t = input.trim().toLowerCase();
  if (t === "0" || t === "q" || t === "") return { kind: "quit" };
  if (t === "o") return { kind: "org" };
  const actions = mainActions();
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= actions.length) return { kind: "action", action: actions[n - 1] };
  const byName = actions.find((a) => a.label.toLowerCase() === t || ("key" in a && a.key === t));
  return byName ? { kind: "action", action: byName } : { kind: "unknown" };
}

/** The shared prompt/print the guided flows use (from runMenu's readline). */
export interface MenuIo {
  readonly prompt: (q: string) => Promise<string>;
  readonly print: (l: string) => void;
}

/** Handlers the readline loop delegates to (all injected → testable). */
export interface MenuHandlers {
  /** Run a command chosen from a submenu (delegates to the CLI). */
  readonly runCommand: (argv: readonly string[]) => Promise<number> | number;
  /** The guided Work flow (pick project → seed/continue → session-start). */
  readonly runWork: (io: MenuIo) => Promise<number>;
  /** Switch the active org. */
  readonly switchOrg: (org: string) => Promise<number> | number;
  /** Help lines — full reference when no command, else per-command help. */
  readonly help: (command?: string) => readonly string[];
}

/** Resolve a numbered or typed choice against a list of (sub)commands. */
function pickCmd(cmds: readonly SubCommand[], input: string): SubCommand | null {
  const idx = Number(input) - 1;
  return Number.isInteger(idx) && idx >= 0 && idx < cmds.length ? cmds[idx] : cmds.find((c) => c.cmd === input) ?? null;
}

export async function runMenu(ctx: MenuContext, h: MenuHandlers): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
  const w = (l: string): void => void process.stderr.write(`${l}\n`);
  try {
    for (;;) {
      for (const l of formatMainMenu(ctx)) w(l);
      const top = resolveTopChoice(await ask("  Choose: "), ctx);
      if (top.kind === "quit") return 0;
      if (top.kind === "unknown") { w("  unknown choice"); continue; }
      if (top.kind === "org") {
        const org = (await ask("  org to use: ")).trim();
        if (org) return await h.switchOrg(org);
        continue;
      }
      const a = top.action;
      if (a.kind === "guided") {
        const io: MenuIo = { prompt: ask, print: w };
        return await h.runWork(io);
      }
      if (a.kind === "help") {
        w("");
        w("  Help — gov command-line use:");
        w("    1) full reference (all commands)");
        w("    2) help for one command");
        w("    0) back");
        const c = (await ask("  Choose: ")).trim();
        if (c === "1") for (const l of h.help()) w(l);
        else if (c === "2") { const cmd = (await ask("  command name: ")).trim(); for (const l of h.help(cmd || undefined)) w(l); }
        continue;
      }
      // submenu → pick a command → run
      w("");
      w(`  ${a.label}:`);
      a.commands.forEach((c, i) => w(`    ${String(i + 1).padStart(2)}) ${c.cmd.padEnd(11)} ${c.desc}`));
      w("     0) back");
      const sub = (await ask("  Choose: ")).trim();
      if (sub === "0" || sub === "") continue;
      const chosen = pickCmd(a.commands, sub);
      if (!chosen) { w("  unknown choice"); continue; }
      const cmdPath: string[] = [chosen.cmd];
      let leaf: SubCommand = chosen;
      // one level of guided nesting: a command WITH subcommands (manage/knowledge/org) → pick one
      if (chosen.subs?.length) {
        w(""); w(`  ${chosen.cmd}:`);
        chosen.subs.forEach((s, i) => w(`    ${String(i + 1).padStart(2)}) ${s.cmd.padEnd(11)} ${s.desc}`));
        w("     0) back");
        const ss = (await ask("  Choose: ")).trim();
        if (ss === "0" || ss === "") continue;
        const chosenSub = pickCmd(chosen.subs, ss);
        if (!chosenSub) { w("  unknown choice"); continue; }
        cmdPath.push(chosenSub.cmd);
        leaf = chosenSub;
      }
      // ask ONLY for the specific value(s) the leaf needs (argHint); a no-arg leaf just runs.
      let extra: string[] = [];
      if (leaf.argHint) {
        const args = (await ask(`  ${leaf.argHint}: `)).trim();
        extra = args ? args.split(/\s+/) : [];
      }
      return await h.runCommand([...cmdPath, ...extra]);
    }
  } finally {
    rl.close();
  }
}
