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

export type ContextMode = "project" | "governed" | "none";

export interface MenuContext {
  readonly orgName?: string;
  readonly githubOrg?: string;
  readonly branch?: string;
  readonly user?: string;
  readonly workspaceCount?: number;
  readonly cliVersion?: string;
  /** PROJECT (cwd inside a project) · GOVERNED (org home) · NONE (no workspace). Drives menu adaptation. */
  readonly mode?: ContextMode;
  /** the current project id, when mode === "project". */
  readonly project?: string;
}

/** `needsProject`: this command operates on the CURRENT project, so it's only valid in PROJECT context.
 *  `argHint` = the single positional SUBJECT; `flagArgs` = the named-flag qualifiers (prompted per value). */
export interface SubCommand {
  readonly cmd: string; readonly desc: string; readonly argHint?: string;
  readonly flagArgs?: readonly { readonly name: string; readonly hint: string; readonly optional?: boolean }[];
  readonly subs?: readonly SubCommand[]; readonly needsProject?: boolean;
}
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
      { cmd: "manage", desc: "project access — assign / unassign owners", needsProject: true, subs: [
        { cmd: "assign", desc: "grant a user project access", argHint: "<github-login>" },
        { cmd: "unassign", desc: "revoke access", argHint: "<github-login>" },
      ] },
      { cmd: "knowledge", desc: "propose org knowledge changes", subs: [
        { cmd: "propose", desc: "start a knowledge change", argHint: "<slug>" },
        { cmd: "submit", desc: "open a PR for a change", argHint: "<slug>", flagArgs: [{ name: "description", hint: "one-line description", optional: true }] },
        { cmd: "archive", desc: "retire a knowledge item", argHint: "<slug>" },
      ] },
      { cmd: "onboard", desc: "onboard a repository into the framework", argHint: "<repo-url>", flagArgs: [{ name: "owner", hint: "owning team/person" }, { name: "description", hint: "one-line description" }] },
      { cmd: "add-repo", desc: "add a repository to the current project", argHint: "<repo-url>", flagArgs: [{ name: "base-branch", hint: "base branch", optional: true }], needsProject: true },
      { cmd: "org", desc: "manage governance workspaces", subs: [
        { cmd: "use", desc: "switch the active org", argHint: "<github_org>" },
        { cmd: "add", desc: "register a governance workspace", argHint: "<github_org>", flagArgs: [{ name: "home", hint: "gov_repo path, e.g. ~/.acme/gov_repo" }] },
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

/** Human hints for the arg placeholders a leaf command asks for (so `<slug>:` isn't cryptic). */
const ARG_HELP: Record<string, string> = {
  "<slug>": "a short kebab-case name for this item, e.g. deploy-policy (NOT the org slug)",
  "<github-login>": "a GitHub @handle, e.g. @alice",
  "<repo-url>": "the repository URL, e.g. https://github.com/org/repo",
  "<owner>": "the owning team or person",
  "<description>": "a one-line description (wrap in quotes if it has spaces)",
  "<github_org>": "the GitHub org or username",
  "<home-path>": "the gov_repo path, e.g. ~/.acme/gov_repo",
  "<board-url>": "the GitHub Project board URL",
};

export function formatMainMenu(ctx: MenuContext): string[] {
  const actions = mainActions();
  const out: string[] = ["", `  ▸ ${ctx.orgName ?? "Governed Agentic Development Framework"} — Governed Agentic Development Framework (v${ctx.cliVersion ?? "?"})`];
  const bits = [ctx.githubOrg && `Org: ${ctx.githubOrg}`, ctx.branch && `Branch: ${ctx.branch}`, ctx.user && `User: ${ctx.user}`].filter(Boolean) as string[];
  if (bits.length) out.push(`  ${bits.join("  |  ")}`);
  if (ctx.workspaceCount !== undefined) out.push(`  ${ctx.workspaceCount} governance workspace(s) registered — press o to switch the active org.`);
  const modeLabel = ctx.mode === "project" ? `PROJECT${ctx.project ? ` (${ctx.project})` : ""}` : ctx.mode === "governed" ? "GOVERNED (org home)" : ctx.mode === "none" ? "no workspace resolved" : undefined;
  if (modeLabel) out.push(`  Context: ${modeLabel}`);
  out.push("", RULE, "", `  ${"Action".padEnd(10)}  ${"Description".padEnd(32)}  Goes to`, `  ${"-".repeat(10)}  ${"-".repeat(32)}  ${"-".repeat(30)}`);
  actions.forEach((a, i) => {
    let desc = a.desc;
    let goesTo = a.kind === "submenu" ? a.commands.map((c) => c.cmd).slice(0, 4).join(" · ") + (a.commands.length > 4 ? " · …" : "") : a.hint;
    if (a.key === "work") {   // adapt the guided flow to the context
      desc = ctx.mode === "project" ? "Continue the current project" : ctx.mode === "none" ? "Set up a workspace first" : "Start or continue a project";
      goesTo = ctx.mode === "project" ? `continue ${ctx.project ?? "this project"}` : ctx.mode === "none" ? "gov setup" : "pick / seed a project";
    }
    out.push(`  (${i + 1}) ${a.label.padEnd(6)}  ${desc.padEnd(32)}  ${goesTo}`);
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
  /** All command names, in reference order — for the "help for one command" picker. */
  readonly helpCommands: () => readonly string[];
  /** Registered governance workspaces — for the org switcher (so the user picks, not types the exact name). */
  readonly listOrgs: () => readonly { readonly org: string; readonly home: string }[];
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
        const orgs = h.listOrgs();
        if (orgs.length === 0) { w("  No governance workspaces registered. Add one via Admin → org → add."); continue; }
        w(""); w("  Switch org — registered workspaces:");
        orgs.forEach((o, i) => w(`    ${String(i + 1).padStart(2)}) ${o.org.padEnd(20)} ${o.home}`));
        w("     0) back");
        const pick = (await ask("  Choose: ")).trim();
        if (pick === "0" || pick === "") continue;
        const i = Number(pick) - 1;
        const chosen = Number.isInteger(i) && i >= 0 && i < orgs.length ? orgs[i] : orgs.find((o) => o.org === pick);
        if (!chosen) { w("  unknown choice"); continue; }
        return await h.switchOrg(chosen.org);
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
        else if (c === "2") {
          const cmds = h.helpCommands();
          w("");
          w("  Pick a command for help:");
          cmds.forEach((cmd, i) => w(`    ${String(i + 1).padStart(2)}) ${cmd}`));
          w("     0) back");
          const pick = (await ask("  Choose: ")).trim();
          if (pick !== "0" && pick !== "") {
            const i = Number(pick) - 1;
            const chosen = Number.isInteger(i) && i >= 0 && i < cmds.length ? cmds[i] : cmds.includes(pick) ? pick : undefined;
            if (chosen) for (const l of h.help(chosen)) w(l);
            else w("  unknown choice");
          }
        }
        continue;
      }
      // submenu → pick a command → run
      w("");
      w(`  ${a.label}:`);
      a.commands.forEach((c, i) => {
        const na = c.needsProject && ctx.mode !== "project" ? "  — needs an active project" : "";
        w(`    ${String(i + 1).padStart(2)}) ${c.cmd.padEnd(11)} ${c.desc}${na}`);
      });
      w("     0) back");
      const sub = (await ask("  Choose: ")).trim();
      if (sub === "0" || sub === "") continue;
      const chosen = pickCmd(a.commands, sub);
      if (!chosen) { w("  unknown choice"); continue; }
      if (chosen.needsProject && ctx.mode !== "project") {
        w(`  '${chosen.cmd}' needs an active project — run Work → continue (or cd into a project dir) first.`);
        continue;
      }
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
      // Ask for the SUBJECT (one verbatim value), then each flag qualifier (each its own verbatim line —
      // no whitespace splitting, so a multi-word --description survives; CLI conventions §3).
      const extra: string[] = [];
      if (leaf.argHint || leaf.flagArgs?.length) { w(""); w(`  ${cmdPath.join(" ")} — ${leaf.desc}`); }
      if (leaf.argHint) {
        const hint = ARG_HELP[leaf.argHint];
        if (hint) w(`    ${leaf.argHint.padEnd(16)} ${hint}`);
        const v = (await ask(`  ${leaf.argHint}: `)).trim();
        if (v) extra.push(v);
      }
      for (const fa of leaf.flagArgs ?? []) {
        const v = (await ask(`  --${fa.name} (${fa.hint})${fa.optional ? " [optional, blank to skip]" : ""}: `)).trim();
        if (v) extra.push(`--${fa.name}`, v);
      }
      return await h.runCommand([...cmdPath, ...extra]);
    }
  } finally {
    rl.close();
  }
}
