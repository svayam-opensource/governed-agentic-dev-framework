// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Which AI agents may be used in this organization — asked one at a time.
 *
 * WHY THIS REPLACED A SPACE-SEPARATED LIST. The question used to be "enter the numbers you
 * allow, separated by spaces. The first one becomes the default" — which asks for three
 * different things in one line: a set, an order, and the knowledge that position one is
 * special. A typo in the middle of `9 3 1` is silent, a missing space merges two numbers into
 * a tenth, and reversing two digits changes the organization's default without changing
 * anything visible. It is the most consequential answer in adoption and it had the least
 * forgiving shape.
 *
 * So: the DEFAULT is its own question, additions are one number each, and the already-chosen
 * disappear from what is offered. Numbers stay STABLE — picking 9 leaves 3 as 3 — because a
 * list that renumbers itself between prompts turns an answer the reader has already composed
 * into the wrong one.
 *
 * It ends with the selection read back and a Y/n. Everything above is reversible until then,
 * which is what makes it safe to ask this many small questions instead of one large one.
 *
 * Pure, plus one driver that takes its asking as an argument.
 */
import { paint } from "./format.js";
import { AGENT_CATALOG } from "./agent-catalog.js";
import type { ApprovedAgent } from "../config/approved-agents.js";

/** One row of the menu. `n` is the STABLE catalog position, not a position in this list. */
export interface OfferedAgent {
  readonly n: number;
  readonly id: string;
  readonly tool: string;
  readonly how: string;
}

/** Every agent with something to run, numbered once, minus anything already chosen. */
export function offeredAgents(exclude: readonly string[] = []): readonly OfferedAgent[] {
  // DEFERRED ENTRIES ARE NOT OFFERED (Policy Owner, 2026-09-10) — a smaller list, made
  // foolproof, before expanding. The numbering is taken AFTER this filter, so the menu reads
  // 1..6 with no gaps; an adopter never sees a number they cannot choose.
  return AGENT_CATALOG
    .filter((a) => a.launch !== "none" && !a.deferred)
    .map((a, i) => ({
      n: i + 1,
      id: a.id,
      tool: a.tool,
      how: a.variants?.map((v) => v.label).join(" · ") ?? (a.launch === "ide" ? "the editor" : "in the terminal"),
    }))
    .filter((a) => !exclude.includes(a.id));
}

/** `Choose [1/2/4/…]` — the numbers still on offer, in catalog order. */
export function optionsLabel(offered: readonly OfferedAgent[]): string {
  return `[${offered.map((a) => a.n).join("/")}]`;
}

const rows = (offered: readonly OfferedAgent[]): readonly string[] =>
  offered.map((a) => `    ${String(a.n).padStart(2)}) ${a.tool.padEnd(28)} ${a.how}`);

/**
 * The first question: which agent is the organization's DEFAULT.
 *
 * Asked first and alone because it is the answer that governs everyone who joins — and in the
 * old shape it was implied by typing order, which is not a way to state a policy.
 */
export function defaultAgentLines(offered: readonly OfferedAgent[], color = false): readonly string[] {
  // NO HEADING HERE. The interview prints `Q10 - Which AI agents...` as its question line,
  // and this block used to repeat it verbatim two lines later. `color` is kept in the
  // signature because the rows may want it later; it is deliberately unused for now.
  void color;
  return [
    "",
    "  This is a policy decision, and it is yours to make now rather than later: an",
    "  agent that is not on this list is prohibited by default, and everyone who joins",
    "  will be offered exactly what you choose here. You can change it afterwards —",
    "  through a pull request, like any other rule.",
    "",
    ...rows(offered),
    "",
    "  Enter the number corresponding to the AI agent that you would like to use as",
    "  default for your organization.",
  ];
}

/** Every question after the first: one more agent, or nothing and we are done. */
export function addMoreLines(offered: readonly OfferedAgent[], color = false): readonly string[] {
  return [
    "",
    `  ${paint("Would you like to add any other AI agent to the allowed list?", "bold", color)}`,
    "  - If yes then enter the number corresponding to AI agent that you would like to",
    "    add to sanctioned list and press enter.",
    "  - OR leave it blank and press enter to finish AI agent selection.",
    "",
    ...rows(offered),
  ];
}

/** `'IBM Bob' (default), 'OpenAI Codex' and 'Claude Code'` — Oxford-free, as an operator would say it. */
export function namesSentence(agents: readonly ApprovedAgent[]): string {
  const name = (id: string): string => AGENT_CATALOG.find((a) => a.id === id)?.tool ?? id;
  const parts = agents.map((a) => `'${name(a.id)}'${a.default ? " (default)" : ""}`);
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Read it back before it becomes a rule. */
export function confirmLines(agents: readonly ApprovedAgent[]): readonly string[] {
  return [
    "",
    `  You have selected — ${namesSentence(agents)} as authorized AI agents to be used in`,
    "  your organization. You can change this selection by modifying values in",
    "  llm-governance.md later on if required.",
    "",
    "  If you are happy with your AI agent selection then choose 'Y' to continue, or 'N'",
    "  to discard these selections and choose again.",
  ];
}

export type PickResult =
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "done" }
  | { readonly kind: "error"; readonly message: string };

/**
 * One answer, against what is currently on offer.
 *
 * `allowDone` is false for the default question — an organization with no approved agent
 * cannot run any, so that one answer is not optional. It is true for every addition.
 */
export function parsePick(answer: string, offered: readonly OfferedAgent[], allowDone: boolean): PickResult {
  const t = answer.trim();
  if (t === "") {
    return allowDone
      ? { kind: "done" }
      : { kind: "error", message: "Choose one — an organization with no approved agent cannot run any." };
  }
  // A NAME IS ALSO AN ANSWER. The numbers are the address, but someone who types `ibm-bob`
  // has told us exactly what they mean and refusing it would be pedantry.
  const byNumber = /^\d+$/.test(t) ? offered.find((a) => a.n === Number(t)) : undefined;
  const byId = offered.find((a) => a.id === t.toLowerCase());
  const hit = byNumber ?? byId;
  if (!hit) return { kind: "error", message: `'${t}' is not one of the numbers above.` };
  return { kind: "pick", id: hit.id };
}

export interface SelectIo {
  /** Ask, with the label already built by the caller; returns the raw answer. */
  readonly prompt: (question: string, def: string) => Promise<string>;
  readonly print: (line: string) => void;
  readonly color?: boolean;
}

/**
 * Drive the whole selection. Returns null when no usable answer arrives — bounded, because
 * "ask again" assumes someone is there to answer, and a scripted stdin repeats itself forever.
 */
export async function askAgentSelection(io: SelectIo): Promise<readonly ApprovedAgent[] | null> {
  const MAX = 40;
  let asked = 0;

  // The Y/n at the end can send us back here, which is the point of asking it.
  for (let round = 0; round < 5; round++) {
    const chosen: ApprovedAgent[] = [];

    // ── the default ───────────────────────────────────────────────────────────────
    while (chosen.length === 0) {
      if (++asked > MAX) return null;
      const offered = offeredAgents();
      for (const l of defaultAgentLines(offered, io.color ?? false)) io.print(l);
      const r = parsePick(await io.prompt(`  Choose ${optionsLabel(offered)} `, ""), offered, false);
      if (r.kind === "error") { io.print(`  ✗ ${r.message}`); continue; }
      if (r.kind === "pick") chosen.push({ id: r.id, default: true });
    }

    // ── additions, one at a time ──────────────────────────────────────────────────
    for (;;) {
      const offered = offeredAgents(chosen.map((c) => c.id));
      if (offered.length === 0) break;                    // everything is approved; nothing left to ask
      if (++asked > MAX) return null;
      for (const l of addMoreLines(offered, io.color ?? false)) io.print(l);
      const r = parsePick(await io.prompt(`  Choose ${optionsLabel(offered)} `, ""), offered, true);
      if (r.kind === "done") break;
      if (r.kind === "error") { io.print(`  ✗ ${r.message}`); continue; }
      chosen.push({ id: r.id });
    }

    // ── read it back ──────────────────────────────────────────────────────────────
    for (const l of confirmLines(chosen)) io.print(l);
    if (++asked > MAX) return null;
    const yn = (await io.prompt("  Choose (Y/n) ", "")).trim().toLowerCase();
    if (yn === "" || yn === "y" || yn === "yes") return chosen;
    io.print("");
    io.print("  Discarded. Choosing again.");
  }
  return null;
}
