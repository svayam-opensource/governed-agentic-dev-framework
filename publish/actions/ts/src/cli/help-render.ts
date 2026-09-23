// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * TURNING THE SPECS INTO WHAT A PERSON (OR THEIR AGENT) READS.
 *
 * Four surfaces, one source (help-spec.ts): the overview, a command's page, the short `-h` form, and `--json`
 * for an agent. Pure — every function takes what it needs and returns lines, so the shape of a page is tested
 * without a terminal.
 */
import { COMMAND_SPECS, specOf, specsFor, type CommandSpec } from "./help-spec.js";

const GROUPS: readonly { readonly audience: "you" | "agent" | "maintainer"; readonly title: string }[] = [
  { audience: "you", title: "Your commands" },
  { audience: "agent", title: "Your agent runs these (you can too)" },
  { audience: "maintainer", title: "Building gov itself" },
];

/**
 * `gov --help` / `gov help` — grouped by WHO RUNS IT (Policy Owner, 2026-09-23).
 *
 * Maintainer commands are hidden: an adopter never needs `publish` or `bump-version`, and a list that shows
 * everything teaches nothing about where to start. `gov help --all` shows them, and `gov help publish` always
 * answers, hidden or not.
 */
export function overview(all = false): string[] {
  const out = ["", "  usage: gov <command> [<args>]", ""];
  out.push("  Start here:  gov            — the menu: pick a project and open your agent", "");
  for (const g of GROUPS) {
    if (g.audience === "maintainer" && !all) continue;
    const specs = specsFor(g.audience).filter((s) => s.name !== "deps");
    if (!specs.length) continue;
    out.push(`  ${g.title}`);
    const width = Math.max(...specs.map((s) => s.name.length));
    for (const s of specs) out.push(`     ${s.name.padEnd(width + 2)} ${s.summary}`);
    out.push("");
  }
  out.push(
    "  gov help <command>        one command: what it does, what it changes, examples",
    "  gov help <topic>          projects · tasks · orgs · context · preferences",
    ...(all ? [] : ["  gov help --all            include the commands for building gov itself"]),
    "",
  );
  return out;
}

/** A command's page. The order never varies, so a reader learns where to look once. */
export function commandPage(spec: CommandSpec): string[] {
  const out = ["", `  gov ${spec.name} — ${spec.summary}`, ""];
  const row = (label: string, text: string): void => { out.push(text ? `  ${label.padEnd(10)} ${text}` : `  ${label}`); };
  row("USAGE", `gov ${spec.name}${spec.usage ? ` ${spec.usage}` : ""}`);
  if (spec.where) row("WHERE", spec.where);
  if (spec.args?.length) {
    row("ARGUMENTS", "");
    const w = Math.max(...spec.args.map((a) => a.name.length));
    for (const a of spec.args) out.push(`             ${a.name.padEnd(w)}  ${a.what}`);
  }
  if (spec.flags?.length) {
    row("FLAGS", "");
    const w = Math.max(...spec.flags.map((f) => f.name.length));
    for (const f of spec.flags) out.push(`             ${f.name.padEnd(w)}  ${f.what}`);
  }
  row("EXAMPLES", spec.examples[0] ?? `gov ${spec.name}`);
  for (const e of spec.examples.slice(1)) out.push(`             ${e}`);
  if (spec.changes) row("CHANGES", wrap(spec.changes, 66, 13));
  if (spec.exit?.length) {
    // ONE LINE PER CODE. A spec that adds a nuance to an existing code (merge's "the gate failed") is saying
    // what that code means HERE, so the lines are joined rather than printed twice with the same number.
    const byCode = new Map<number, string[]>();
    for (const e of spec.exit) byCode.set(e.code, [...(byCode.get(e.code) ?? []), e.means]);
    row("EXIT", [...byCode.entries()].map(([code, means]) => `${code} ${means.join("; ")}`).join("\n             "));
  }
  if (spec.seeAlso?.length) row("SEE ALSO", spec.seeAlso.map((s) => `gov ${s}`).join(" · "));
  out.push("");
  return out;
}

/** `-h` — the short form: what to type, and the example most people want (git's `-h` versus `--help`). */
export function shortPage(spec: CommandSpec): string[] {
  return [
    "",
    `  gov ${spec.name} — ${spec.summary}`,
    `  usage: gov ${spec.name}${spec.usage ? ` ${spec.usage}` : ""}`,
    ...spec.examples.slice(0, 2).map((e) => `         ${e}`),
    `  gov help ${spec.name} for what it changes, the flags, and the exit codes`,
    "",
  ];
}

/** Wrap a sentence to `width`, indenting continuation lines — CHANGES is the only long field. */
function wrap(text: string, width: number, indent: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) { lines.push(line); line = w; } else { line = line ? `${line} ${w}` : w; }
  }
  if (line) lines.push(line);
  return lines.join(`\n${" ".repeat(indent)}`);
}

/**
 * THE CONCEPTS COMMANDS ASSUME. Short on purpose: a topic that needs a page of prose is a sign the commands
 * are wrong, not that the topic is deep.
 */
export const TOPICS: readonly { readonly name: string; readonly title: string; readonly lines: readonly string[] }[] = [
  {
    name: "projects", title: "Projects and branches",
    lines: [
      "A project is a GitHub Project board. GitHub is the source of truth: open board = active project.",
      "",
      "  the board          github.com/orgs/<org>/projects/<n>",
      "  the project id     PRJ-<board#>-<slug>",
      "  the branch         BRNCH-<board#>-<slug>, in the workspace AND in every code repo",
      "  on your machine    <agent_work_root>/PRJ-<board#>-<slug>/",
      "",
      "`gov seed` starts one, `gov join` brings someone else's to this machine, `gov work` opens it.",
      "Its knowledge lives in projects/<id>/knowledge/ in the workspace repo.",
    ],
  },
  {
    name: "tasks", title: "Tasks",
    lines: [
      "A task is a sub-branch for one or more issues: <project-branch>.ISSUE-<n>, in every repo of the project.",
      "",
      "  gov task <issue-url>      start it (creates and pushes the sub-branch, assigns the issues)",
      "  gov merge <issue-url>     land it (merges, pushes, deletes the sub-branch, closes the issue)",
      "",
      "Several issues can share one task: pass them comma-separated. Task state is the issue's state on GitHub;",
      "gov never keeps its own copy of it.",
    ],
  },
  {
    name: "orgs", title: "Organizations and workspaces",
    lines: [
      "A workspace is one organization's governance repository, cloned on this machine.",
      "",
      "  ~/.gov/workspaces         which orgs this machine knows, and where each is cloned",
      "  ~/.gov/active             which one commands act on",
      "  <workspace>/org-config.yaml   the org's own values; every framework file reads them",
      "",
      "`gov org list` shows them, `gov org use <org>` switches, `gov setup` adds the first one.",
      "A machine may hold several; only one is active at a time.",
    ],
  },
  {
    name: "context", title: "Context: PROJECT, GOVERNED, NONE",
    lines: [
      "gov behaves differently depending on where you are standing, and says so in its banner.",
      "",
      "  PROJECT    inside a project folder — work continues THAT project; task, merge, close apply to it",
      "  GOVERNED   in the org's workspace — org-wide commands (upgrade, knowledge, manage)",
      "  NONE       no workspace resolved — setup, org and doctor still work; they are how you leave NONE",
      "",
      "If the banner says NONE unexpectedly, `gov doctor` says which of the three reasons it is.",
    ],
  },
  {
    name: "preferences", title: "Preferences, credentials and state",
    lines: [
      "Everything of yours lives in one folder: <agent_work_root>/preferences/<your-gh-login>/",
      "",
      "  <login>.md          what your AGENT should take into account (prose, yours to write)",
      "  preferences.json    what the gov CLI needs: default agent, picker, colour, log retention",
      "  credentials         your agent API keys (0600) — gov loads them for the sessions it starts",
      "  state/              gov's own: the runs it logged, what you confirmed. Safe to delete",
      "",
      "`gov preferences` lists every setting with its value and what it does. A preference chooses INSIDE what",
      "your organization allows: a default agent your org has not approved is ignored, and gov says so.",
    ],
  },
];

export const topicOf = (name: string): (typeof TOPICS)[number] | undefined => TOPICS.find((t) => t.name === name);

export function topicPage(name: string): string[] | null {
  const t = topicOf(name);
  if (!t) return null;
  return ["", `  ${t.title}`, "", ...t.lines.map((l) => (l ? `  ${l}` : "")), ""];
}

/** `gov help --json` — the specs, for an agent. The same source the pages are rendered from. */
export const helpJson = (): string => JSON.stringify({ version: 1, commands: COMMAND_SPECS, topics: TOPICS.map((t) => t.name) }, null, 2);

/**
 * "did you mean" — edit distance 1 or 2, or a command that starts with what was typed. A mistyped command is
 * the commonest way to meet help, and an overview with no suggestion makes the reader do the matching.
 */
export function didYouMean(typed: string): string[] {
  const names = [...COMMAND_SPECS.map((c) => c.name), ...TOPICS.map((t) => t.name)];
  const close = names.filter((n) => n.startsWith(typed) || distance(n, typed) <= (typed.length <= 4 ? 1 : 2));
  return close.slice(0, 3);
}

/**
 * Damerau-Levenshtein, small and dependency-free — the strings here are command names.
 *
 * TRANSPOSITION COUNTS AS ONE, because `tsak` for `task` is the commonest typo there is, and plain Levenshtein
 * scores it 2 — far enough to earn no suggestion, which is exactly when a person most wants one.
 */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Everything `gov help <x>` can answer about: a command, a topic, or nothing. */
export function helpFor(what: string, opts: { short?: boolean } = {}): string[] | null {
  const spec = specOf(what);
  if (spec) return opts.short ? shortPage(spec) : commandPage(spec);
  return topicPage(what);
}
