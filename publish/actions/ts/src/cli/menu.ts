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

/** A command is visible only in these context modes; absent = every mode. See [[context-scoped-menu]]. */
export type Scope = ContextMode;
/** `argHint` = the single positional SUBJECT; `flagArgs` = the named-flag qualifiers (prompted per value).
 *  A `kind:"env"` flag is rendered as a context-scoped picker (PROJECT→local; GOVERNED→dev/uat/prod). */
export interface MenuFlagArg { readonly name: string; readonly hint: string; readonly optional?: boolean; readonly kind?: "env" }
/** When a command's SUBJECT has a discoverable value set, the menu offers a picker instead of free-typing:
 *  `project` → the user's assigned projects; `unit` → the catalog's units (§2 value discovery). */
export type SubjectKind = "project" | "unit";
export interface SubCommand {
  readonly cmd: string; readonly desc: string; readonly argHint?: string;
  readonly flagArgs?: readonly MenuFlagArg[];
  readonly subs?: readonly SubCommand[]; readonly scopes?: readonly Scope[];
  readonly subjectKind?: SubjectKind;
}
/** A governed verb the gov-operate plugin contributes at runtime (`gov-operate menu --json`). */
export interface OperateVerb {
  readonly cmd: string; readonly desc: string; readonly scopes: readonly Scope[];
  readonly argHint?: string; readonly flagArgs?: readonly MenuFlagArg[]; readonly subjectKind?: SubjectKind;
}
export type MenuAction =
  | { readonly kind: "guided"; readonly key: "work"; readonly label: string; readonly desc: string; readonly hint: string; readonly scopes?: readonly Scope[] }
  | { readonly kind: "submenu"; readonly key: "status" | "admin" | "operate"; readonly label: string; readonly desc: string; readonly commands: readonly SubCommand[]; readonly scopes?: readonly Scope[] }
  | { readonly kind: "help"; readonly key: "help"; readonly label: string; readonly desc: string; readonly hint: string; readonly scopes?: readonly Scope[] };

/** The FULL main-menu definition (every mode). `operate` = the plugin's discovered verbs, merged as the
 *  Operate submenu when present. Use `visibleActions(ctx, operate)` to get the context-filtered list. */
export function mainActions(operate: readonly OperateVerb[] = []): MenuAction[] {
  const operateSubmenu: MenuAction[] = operate.length ? [{
    kind: "submenu", key: "operate", label: "Operate", desc: "Governed deploy & catalog",
    commands: operate.map((v) => ({ cmd: v.cmd, desc: v.desc, argHint: v.argHint, flagArgs: v.flagArgs, scopes: v.scopes, subjectKind: v.subjectKind })),
  }] : [];
  return [
    { kind: "submenu", key: "status", label: "Status", desc: "Review current state", commands: [
      { cmd: "list", desc: "ongoing projects", scopes: ["governed"] },
      { cmd: "list-all", desc: "all projects (incl. closed)", scopes: ["governed"] },
      { cmd: "status", desc: "detailed status of one project", subjectKind: "project", scopes: ["project", "governed"] },
    ] },
    { kind: "guided", key: "work", label: "Work", desc: "Start / continue a project", hint: "pick a project" },
    ...operateSubmenu,
    { kind: "submenu", key: "admin", label: "Admin", desc: "Administer governance", commands: [
      { cmd: "manage", desc: "project access — assign / unassign owners", scopes: ["project", "governed"], subs: [
        { cmd: "assign", desc: "grant a user project access", argHint: "<github-login>" },
        { cmd: "unassign", desc: "revoke access", argHint: "<github-login>" },
      ] },
      { cmd: "add-repo", desc: "add a repository to the current project", argHint: "<repo-url>", flagArgs: [{ name: "base-branch", hint: "base branch", optional: true }], scopes: ["project"] },
      { cmd: "knowledge", desc: "propose org knowledge changes", scopes: ["governed"], subs: [
        { cmd: "propose", desc: "start a knowledge change", argHint: "<slug>" },
        { cmd: "submit", desc: "open a PR for a change", argHint: "<slug>", flagArgs: [{ name: "description", hint: "one-line description", optional: true }] },
        { cmd: "archive", desc: "retire a knowledge item", argHint: "<slug>" },
      ] },
      { cmd: "onboard", desc: "onboard a repository into the framework", argHint: "<repo-url>", flagArgs: [{ name: "owner", hint: "owning team/person" }, { name: "description", hint: "one-line description" }], scopes: ["governed"] },
      { cmd: "org", desc: "manage governance workspaces", scopes: ["governed"], subs: [
        { cmd: "use", desc: "switch the active org", argHint: "<github_org>" },
        { cmd: "add", desc: "register a governance workspace", argHint: "<github_org>", flagArgs: [{ name: "home", hint: "gov_repo path, e.g. ~/.acme/gov_repo" }] },
        { cmd: "list", desc: "registered workspaces" },
        { cmd: "remove", desc: "deregister a workspace", argHint: "<github_org>" },
      ] },
      { cmd: "upgrade", desc: "pull the latest framework content", scopes: ["governed"] },
      { cmd: "deps", desc: "install / verify dependencies", scopes: ["governed"] },
    ] },
    { kind: "help", key: "help", label: "Help", desc: "gov command-line use", hint: "pick a command" },
  ];
}

/** True when `scopes` admits `mode`. Absent scopes = universal; unknown mode = show all (non-menu callers). */
function inScope(scopes: readonly Scope[] | undefined, mode: ContextMode | undefined): boolean {
  return !scopes || !mode || scopes.includes(mode);
}

/** The context-filtered action list (HARD-HIDE): drops out-of-scope commands and any submenu left empty.
 *  This is the single source of menu numbering — format / resolve / run all go through it. */
export function visibleActions(ctx: MenuContext, operate: readonly OperateVerb[] = []): MenuAction[] {
  const mode = ctx.mode;
  const out: MenuAction[] = [];
  for (const a of mainActions(operate)) {
    if (a.kind === "submenu") {
      const commands = a.commands.filter((c) => inScope(c.scopes, mode));
      if (commands.length && inScope(a.scopes, mode)) out.push({ ...a, commands });
    } else if (inScope(a.scopes, mode)) out.push(a);
  }
  return out;
}

/** The env choices offered for a `kind:"env"` flag in this context (PROJECT = local only; else dev/uat/prod). */
export function contextEnvs(mode: ContextMode | undefined): string[] {
  return mode === "project" ? ["local"] : ["dev", "uat", "prod"];
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

export function formatMainMenu(ctx: MenuContext, operate: readonly OperateVerb[] = []): string[] {
  const actions = visibleActions(ctx, operate);
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
    out.push(`  (${i + 1}) ${a.label.padEnd(8)}  ${desc.padEnd(32)}  ${goesTo}`);
  });
  out.push("", "  Type a number; o to switch org; 0 to exit.", RULE);
  return out;
}

export type TopChoice =
  | { readonly kind: "action"; readonly action: MenuAction }
  | { readonly kind: "org" }
  | { readonly kind: "quit" }
  | { readonly kind: "unknown" };

export function resolveTopChoice(input: string, ctx: MenuContext = {}, operate: readonly OperateVerb[] = []): TopChoice {
  const t = input.trim().toLowerCase();
  if (t === "0" || t === "q" || t === "") return { kind: "quit" };
  if (t === "o") return { kind: "org" };
  const actions = visibleActions(ctx, operate);
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
  /** The gov-operate plugin's governed verbs, discovered at runtime. Absent/[] → no Operate submenu. */
  readonly operateVerbs?: () => readonly OperateVerb[];
  /** Discoverable subject value sets for the pickers (§2). Each may be slow (gh / plugin) → called on demand. */
  readonly listUnits?: () => readonly string[];
  readonly listMyProjects?: () => readonly string[];
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
  const operate = h.operateVerbs?.() ?? [];   // runtime-discovered governed verbs (Operate submenu)
  try {
    for (;;) {
      for (const l of formatMainMenu(ctx, operate)) w(l);
      const top = resolveTopChoice(await ask("  Choose: "), ctx, operate);
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
      // submenu → pick a command → run. Commands are already context-filtered (hard-hide), so no guard here.
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
      // Ask for the SUBJECT (one verbatim value), then each flag qualifier (each its own verbatim line —
      // no whitespace splitting, so a multi-word --description survives; CLI conventions §3).
      const extra: string[] = [];
      if (leaf.argHint || leaf.flagArgs?.length || leaf.subjectKind) { w(""); w(`  ${cmdPath.join(" ")} — ${leaf.desc}`); }
      // GOVERNED (org-home) has no current project, so `manage assign/unassign` must target a board explicitly.
      if (ctx.mode === "governed" && cmdPath[0] === "manage" && (leaf.cmd === "assign" || leaf.cmd === "unassign")) {
        const bn = (await ask("  board number to manage (see `manage list`): ")).trim();
        if (!/^\d+$/.test(bn)) { w("  a numeric board number is required"); continue; }
        extra.push("--board", bn);
      }
      // SUBJECT: a discoverable subject (unit / project) → pick from a list (§2 value discovery); else free-text.
      if (leaf.subjectKind === "project" && ctx.mode === "project" && ctx.project) {
        extra.push(ctx.project);   // inside a project → operate on THIS one, no prompt
        w(`  project: ${ctx.project}  (current)`);
      } else if (leaf.subjectKind) {
        w(`  ⏳ loading ${leaf.subjectKind}s…`);
        const items = leaf.subjectKind === "unit" ? (h.listUnits?.() ?? []) : (h.listMyProjects?.() ?? []);
        if (!items.length) { w(`  no ${leaf.subjectKind}s available to pick — is the ${leaf.subjectKind === "unit" ? "plugin/catalog" : "workspace"} configured?`); continue; }
        w(`  Select a ${leaf.subjectKind}:`);
        items.forEach((it, i) => w(`    ${String(i + 1).padStart(2)}) ${it}`));
        w("     0) back");
        const pick = (await ask("  Choose: ")).trim();
        if (pick === "0" || pick === "") continue;
        const idx = Number(pick) - 1;
        const chosen = Number.isInteger(idx) && idx >= 0 && idx < items.length ? items[idx] : items.includes(pick) ? pick : undefined;
        if (!chosen) { w("  unknown choice"); continue; }
        extra.push(chosen);
      } else if (leaf.argHint) {
        const hint = ARG_HELP[leaf.argHint];
        if (hint) w(`    ${leaf.argHint.padEnd(16)} ${hint}`);
        const v = (await ask(`  ${leaf.argHint}: `)).trim();
        if (v) extra.push(v);
      }
      let aborted = false;
      for (const fa of leaf.flagArgs ?? []) {
        if (fa.kind === "env") {   // context-scoped picker — no free-typing an env (value discovery, §2)
          const envs = contextEnvs(ctx.mode);
          if (envs.length === 1) { extra.push(`--${fa.name}`, envs[0]); w(`  --${fa.name}: ${envs[0]}  (only choice in this context)`); continue; }
          w(`  --${fa.name} (${fa.hint}):`);
          envs.forEach((e, i) => w(`    ${i + 1}) ${e}`));
          const pick = (await ask("  Choose: ")).trim();
          const idx = Number(pick) - 1;
          const e = Number.isInteger(idx) && idx >= 0 && idx < envs.length ? envs[idx] : envs.includes(pick) ? pick : undefined;
          if (e) extra.push(`--${fa.name}`, e);
          else if (!fa.optional) { w(`  unknown env '${pick}' — choose ${envs.join(" · ")}`); aborted = true; break; }
          continue;
        }
        const v = (await ask(`  --${fa.name} (${fa.hint})${fa.optional ? " [optional, blank to skip]" : ""}: `)).trim();
        if (v) extra.push(`--${fa.name}`, v);
      }
      if (aborted) continue;   // bad required value → back to the main menu, don't run a broken command
      return await h.runCommand([...cmdPath, ...extra]);
    }
  } finally {
    rl.close();
  }
}
