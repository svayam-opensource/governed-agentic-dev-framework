// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The interactive menu (`gov-work` with no args on a TTY) — a TASK-ORIENTED on-ramp
 * (mirrors the legacy `prj` menu), not a command index. The goal is to get a
 * developer working fast:
 *   Status  → review (list · list-all · status)
 *   Work    → GUIDED flow: pick your project → seed-if-new / continue → session-start
 *   Admin   → curated governance actions (manage · knowledge · onboard · …)
 *   (Help is NOT a menu item — the menu guides; the command line is documented by `gov help <cmd>`.)
 * Rendering + choice-resolution are pure/testable; runMenu delegates the guided
 * flows + command runs to injected handlers. (Enterprise catalog/deploy is a
 * SEPARATE CLI, `gov-cicd` — this menu has no knowledge of it.)
 */
import { askFns, type AskFns } from "./ask.js";
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
  /** `display.menuHeader` — "once" (the default) or "always". The person's preference. */
  readonly headerEvery?: boolean;
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
export type MenuAction =
  | { readonly kind: "guided"; readonly key: "work"; readonly label: string; readonly desc: string; readonly hint: string; readonly scopes?: readonly Scope[] }
  | { readonly kind: "submenu"; readonly key: "admin"; readonly label: string; readonly desc: string; readonly commands: readonly SubCommand[]; readonly scopes?: readonly Scope[] };

/** The FULL main-menu definition (every mode) — gov-work's OWN verbs, and only those. The menu used to
 *  merge submenus discovered from the gov-cicd and do-admin plugins; the three clients each render their
 *  own menu now (adr-three-clients, PRJ-43). Use `visibleActions(ctx)` for the context-filtered list.
 *
 *  The STATUS submenu (list · list-all · status) went on 2026-08-07: who is assigned what, and how a project
 *  is doing, are the WORK-MANAGEMENT system's answers — GitHub's today, Jira's next. gov asks that system;
 *  it does not keep its own view of it. The reads survive inside the work-mgmt port (this menu's own project
 *  picker is one), so nothing is lost except a place to type them. */
export function mainActions(): MenuAction[] {
  return [
    { kind: "guided", key: "work", label: "Work", desc: "Start / continue a project", hint: "pick a project" },
    // ADMIN is the HUMAN's administration, and only that (PRJ-43 walkthrough, 2026-08-07). `manage`,
    // `knowledge`, `onboard` and `add-repo` left: assignment is the work-management system's answer, and
    // the other three are things you ask your agent for. `deps` folded into `doctor`. What remains is what
    // an agent cannot do for you — point this machine at an org, check it, and pull new content.
    //
    // `issue` (#182) is deliberately NOT here, by that same rule: writing down a unit of work is exactly
    // the kind of thing you ask your agent for, and this menu is what you cannot. It is a direct verb.
    { kind: "submenu", key: "admin", label: "Admin", desc: "This machine and this org", commands: [
      // `org` and `doctor` in EVERY context, NONE included (PRJ-121, 2026-09-22). Both were scoped to
      // project/governed, so with no workspace resolved Admin vanished — and with it `org use`, the one way OUT
      // of that state. A walk hit it with two orgs registered and a dead one active.
      { cmd: "org", desc: "governance workspaces — switch / add / list / remove", subs: [
        { cmd: "use", desc: "switch the active org", argHint: "<github_org>" },
        { cmd: "add", desc: "register a governance workspace", argHint: "<github_org>", flagArgs: [{ name: "home", hint: "gov_repo path, e.g. ~/.acme/gov_repo" }] },
        { cmd: "list", desc: "registered workspaces" },
        { cmd: "remove", desc: "deregister a workspace", argHint: "<github_org>" },
      ] },
      { cmd: "doctor", desc: "diagnose this machine — git · gh · workspace · versions" },
      { cmd: "preferences", desc: "your settings — agent · picker · colour · logs", subs: [
        { cmd: "list", desc: "every setting, its value, and whether it is yours" },
        { cmd: "set", desc: "change one", argHint: "<key>" },
        { cmd: "reset", desc: "back to gov's default", argHint: "<key>" },
        { cmd: "path", desc: "where the file is" },
      ] },
      { cmd: "upgrade", desc: "pull the latest framework content into this org", scopes: ["governed"] },
    ] },
    // HELP LEFT THE MENU (Policy Owner, 2026-09-22). A picker of 24 command names, each answering with one line,
    // taught nothing — and the menu is the guided surface; the command line is documented where it is used,
    // `gov help <cmd>` / `gov <cmd> --help`. The footer points there.
  ];
}

/** True when `scopes` admits `mode`. Absent scopes = universal; unknown mode = show all (non-menu callers). */
function inScope(scopes: readonly Scope[] | undefined, mode: ContextMode | undefined): boolean {
  return !scopes || !mode || scopes.includes(mode);
}

/** The context-filtered action list (HARD-HIDE): drops out-of-scope commands and any submenu left empty.
 *  This is the single source of menu numbering — format / resolve / run all go through it. */
export function visibleActions(ctx: MenuContext): MenuAction[] {
  const mode = ctx.mode;
  const out: MenuAction[] = [];
  for (const a of mainActions()) {
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

/** The header: who, where, which version, which context. Printed ONCE per menu session (and on `c`). */
export function formatMenuHeader(ctx: MenuContext): string[] {
  // No org name → the framework's name ONCE, not "X — X" (a walk, 2026-09-22).
  const title = ctx.orgName ? `${ctx.orgName} — Governed Agentic Development Framework` : "Governed Agentic Development Framework";
  const out: string[] = ["", `  ▸ ${title} (v${ctx.cliVersion ?? "?"})`];
  const bits = [ctx.githubOrg && `Org: ${ctx.githubOrg}`, ctx.branch && `Branch: ${ctx.branch}`, ctx.user && `User: ${ctx.user}`].filter(Boolean) as string[];
  if (bits.length) out.push(`  ${bits.join("  |  ")}`);
  if (ctx.workspaceCount !== undefined) out.push(`  ${ctx.workspaceCount} governance workspace(s) registered — press o to switch the active org.`);
  const modeLabel = ctx.mode === "project" ? `PROJECT${ctx.project ? ` (${ctx.project})` : ""}` : ctx.mode === "governed" ? "GOVERNED (org home)" : ctx.mode === "none" ? "no workspace resolved" : undefined;
  if (modeLabel) out.push(`  Context: ${modeLabel}`);
  return out;
}

/** The action table + footer — what every return to the main menu shows. */
export function formatActionList(ctx: MenuContext): string[] {
  const actions = visibleActions(ctx);
  const out: string[] = ["", RULE, "", `  ${"Action".padEnd(10)}  ${"Description".padEnd(32)}  Goes to`, `  ${"-".repeat(10)}  ${"-".repeat(32)}  ${"-".repeat(30)}`];
  actions.forEach((a, i) => {
    let desc = a.desc;
    let goesTo = a.kind === "submenu" ? a.commands.map((c) => c.cmd).slice(0, 4).join(" · ") + (a.commands.length > 4 ? " · …" : "") : a.hint;
    if (a.key === "work") {   // adapt the guided flow to the context
      // NONE with orgs REGISTERED is not "set up first" — the fix is choosing one (a walk, 2026-09-22).
      const switchFirst = ctx.mode === "none" && (ctx.workspaceCount ?? 0) > 0;
      desc = ctx.mode === "project" ? "Continue the current project" : switchFirst ? "Choose a working org first" : ctx.mode === "none" ? "Set up a workspace first" : "Start or continue a project";
      goesTo = ctx.mode === "project" ? `continue ${ctx.project ?? "this project"}` : switchFirst ? "press o, or Admin → org" : ctx.mode === "none" ? "gov setup" : "pick / seed a project";
    }
    out.push(`  (${i + 1}) ${a.label.padEnd(8)}  ${desc.padEnd(32)}  ${goesTo}`);
  });
  out.push("", "  Type a number; o to switch org; c to show the context again; 0 to exit.",
    "  Command line: `gov help` · `gov <command> --help`", RULE);
  return out;
}

/** The whole first screen: header + actions. */
export function formatMainMenu(ctx: MenuContext): string[] {
  return [...formatMenuHeader(ctx), ...formatActionList(ctx)];
}

export type TopChoice =
  | { readonly kind: "action"; readonly action: MenuAction }
  | { readonly kind: "org" }
  | { readonly kind: "context" }
  | { readonly kind: "quit" }
  | { readonly kind: "unknown" };

export function resolveTopChoice(input: string, ctx: MenuContext = {}): TopChoice {
  const t = input.trim().toLowerCase();
  if (t === "0" || t === "q" || t === "") return { kind: "quit" };
  if (t === "o") return { kind: "org" };
  if (t === "c") return { kind: "context" };
  const actions = visibleActions(ctx);
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= actions.length) return { kind: "action", action: actions[n - 1] };
  const byName = actions.find((a) => a.label.toLowerCase() === t || ("key" in a && a.key === t));
  return byName ? { kind: "action", action: byName } : { kind: "unknown" };
}

/** The shared prompt/print the guided flows use (from runMenu's readline). */
export interface MenuIo {
  readonly prompt: (q: string) => Promise<string>;
  readonly print: (l: string) => void;
  /**
   * The same reader, with a hidden variant for a key (#213).
   *
   * The menu's readline stays open for the whole loop, so anything it hands off to must ask
   * THROUGH it. A handler that opened its own reader raced this one for the same keystrokes
   * and lost — the sign-in choice answered itself and an adopter fell through to a browser
   * screen they could not use.
   */
  readonly ask: AskFns;
}

/** Handlers the readline loop delegates to (all injected → testable). */
export interface MenuHandlers {
  /** Run a command chosen from a submenu (delegates to the CLI). */
  readonly runCommand: (argv: readonly string[]) => Promise<number> | number;
  /** The guided Work flow (pick project → seed/continue → session-start). */
  readonly runWork: (io: MenuIo) => Promise<number>;
  /** Switch the active org. */
  readonly switchOrg: (org: string) => Promise<number> | number;
  /** Registered governance workspaces — for the org switcher (so the user picks, not types the exact name). */
  readonly listOrgs: () => readonly { readonly org: string; readonly home: string }[];
  /** Discoverable subject value sets for the pickers (§2). Called on demand (a `gh` call may be slow). */
  readonly listMyProjects?: () => readonly string[];
}

/** Resolve a numbered or typed choice against a list of (sub)commands. */
function pickCmd(cmds: readonly SubCommand[], input: string): SubCommand | null {
  const idx = Number(input) - 1;
  return Number.isInteger(idx) && idx >= 0 && idx < cmds.length ? cmds[idx] : cmds.find((c) => c.cmd === input) ?? null;
}

/** A level's answer: "go up one level", or the exit code of what it ran. */
const BACK = Symbol("back");
type LevelResult = number | typeof BACK;

/** Pick one of `items` by number or exact name; null = unknown. */
function pickFrom<T>(items: readonly T[], input: string, name: (t: T) => string): T | null {
  const idx = Number(input) - 1;
  return Number.isInteger(idx) && idx >= 0 && idx < items.length ? items[idx]! : items.find((t) => name(t) === input) ?? null;
}

/**
 * NAVIGATION IS A STACK (PRJ-121, 2026-09-22). Every sub-menu used to `continue` the MAIN loop, so `0`, an
 * unknown answer, or finishing anything at depth two landed on the main menu. Now each level is its own
 * loop: `0` (or Enter) returns to the level above, an unknown answer asks again at the SAME level.
 *
 * THE HEADER PRINTS ONCE. It was redrawn on every return to the main menu; now the action list is, and
 * `c` shows the context again. A context change (an org switch) ends the menu, so the header is never stale.
 */
export async function runMenu(ctx: MenuContext, h: MenuHandlers): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
  const w = (l: string): void => void process.stderr.write(`${l}\n`);
  const isBack = (x: string): boolean => x === "0" || x === "";

  /** A leaf: ask for its subject and flags, then run it. BACK when a picker is backed out of or a value refused. */
  const runLeaf = async (cmdPath: readonly string[], leaf: SubCommand): Promise<LevelResult> => {
    // Ask for the SUBJECT (one verbatim value), then each flag qualifier (each its own verbatim line —
    // no whitespace splitting, so a multi-word --description survives; CLI conventions §3).
    const extra: string[] = [];
    if (leaf.argHint || leaf.flagArgs?.length || leaf.subjectKind) { w(""); w(`  ${cmdPath.join(" ")} — ${leaf.desc}`); }
    // GOVERNED (org-home) has no current project, so `manage assign/unassign` must target a board explicitly.
    if (ctx.mode === "governed" && cmdPath[0] === "manage" && (leaf.cmd === "assign" || leaf.cmd === "unassign")) {
      const bn = (await ask("  board number to manage (see `manage list`): ")).trim();
      if (!/^\d+$/.test(bn)) { w("  a numeric board number is required"); return BACK; }
      extra.push("--board", bn);
    }
    // SUBJECT: a discoverable subject (unit / project) → pick from a list (§2 value discovery); else free-text.
    if (leaf.subjectKind === "project" && ctx.mode === "project" && ctx.project) {
      extra.push(ctx.project);   // inside a project → operate on THIS one, no prompt
      w(`  project: ${ctx.project}  (current)`);
    } else if (leaf.subjectKind) {
      w(`  ⏳ loading ${leaf.subjectKind}s…`);
      const items = h.listMyProjects?.() ?? [];
      if (!items.length) { w(`  no ${leaf.subjectKind}s available to pick — is the workspace configured?`); return BACK; }
      for (;;) {
        w(`  Select a ${leaf.subjectKind}:`);
        items.forEach((it, i) => w(`    ${String(i + 1).padStart(2)}) ${it}`));
        w("     0) back");
        const pick = (await ask("  Choose: ")).trim();
        if (isBack(pick)) return BACK;
        const chosen = pickFrom(items, pick, (x) => x);
        if (chosen) { extra.push(chosen); break; }
        w("  unknown choice");
      }
    } else if (leaf.argHint) {
      const hint = ARG_HELP[leaf.argHint];
      if (hint) w(`    ${leaf.argHint.padEnd(16)} ${hint}`);
      const v = (await ask(`  ${leaf.argHint}: `)).trim();
      if (v) extra.push(v);
    }
    for (const fa of leaf.flagArgs ?? []) {
      if (fa.kind === "env") {   // context-scoped picker — no free-typing an env (value discovery, §2)
        const envs = contextEnvs(ctx.mode);
        if (envs.length === 1) { extra.push(`--${fa.name}`, envs[0]!); w(`  --${fa.name}: ${envs[0]}  (only choice in this context)`); continue; }
        w(`  --${fa.name} (${fa.hint}):`);
        envs.forEach((e, i) => w(`    ${i + 1}) ${e}`));
        const pick = (await ask("  Choose: ")).trim();
        const e = pickFrom(envs, pick, (x) => x);
        if (e) extra.push(`--${fa.name}`, e);
        else if (!fa.optional) { w(`  unknown env '${pick}' — choose ${envs.join(" · ")}`); return BACK; }   // never run a broken command
        continue;
      }
      const v = (await ask(`  --${fa.name} (${fa.hint})${fa.optional ? " [optional, blank to skip]" : ""}: `)).trim();
      if (v) extra.push(`--${fa.name}`, v);
    }
    return await h.runCommand([...cmdPath, ...extra]);
  };

  /** A list of commands at one level. A command with `subs` opens the next level; `0` comes back here. */
  const runLevel = async (title: string, cmds: readonly SubCommand[], path: readonly string[]): Promise<LevelResult> => {
    for (;;) {
      w(""); w(`  ${title}:`);
      cmds.forEach((c, i) => w(`    ${String(i + 1).padStart(2)}) ${c.cmd.padEnd(11)} ${c.desc}`));
      w("     0) back");
      const input = (await ask("  Choose: ")).trim();
      if (isBack(input)) return BACK;
      const chosen = pickCmd(cmds, input);
      if (!chosen) { w("  unknown choice"); continue; }
      const r = chosen.subs?.length
        ? await runLevel(chosen.cmd, chosen.subs, [...path, chosen.cmd])
        : await runLeaf([...path, chosen.cmd], chosen);
      if (r !== BACK) return r;        // ran something → done; BACK → show THIS level again
    }
  };

  try {
    let header = true;
    for (;;) {
      for (const l of header || ctx.headerEvery ? formatMainMenu(ctx) : formatActionList(ctx)) w(l);
      header = false;
      const top = resolveTopChoice(await ask("  Choose: "), ctx);
      if (top.kind === "quit") return 0;
      if (top.kind === "unknown") { w("  unknown choice"); continue; }
      if (top.kind === "context") { header = true; continue; }
      if (top.kind === "org") {
        const orgs = h.listOrgs();
        if (orgs.length === 0) { w("  No governance workspaces registered. Add one via Admin → org → add."); continue; }
        for (;;) {
          w(""); w("  Switch org — registered workspaces:");
          orgs.forEach((o, i) => w(`    ${String(i + 1).padStart(2)}) ${o.org.padEnd(20)} ${o.home}`));
          w("     0) back");
          const pick = (await ask("  Choose: ")).trim();
          if (isBack(pick)) break;
          const chosen = pickFrom(orgs, pick, (o) => o.org);
          if (chosen) return await h.switchOrg(chosen.org);
          w("  unknown choice");
        }
        continue;
      }
      const a = top.action;
      if (a.kind === "guided") {
        const io: MenuIo = { prompt: ask, print: w, ask: askFns(rl, ask) };
        return await h.runWork(io);
      }
      // submenu → pick a command → run. Commands are already context-filtered (hard-hide), so no guard here.
      const r = await runLevel(a.label, a.commands, []);
      if (r !== BACK) return r;
    }
  } finally {
    rl.close();
  }
}
