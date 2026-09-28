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
import { NO_AGENTS, type ApprovedAgent } from "../config/approved-agents.js";

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

/**
 * The number that means "no AI agents at all".
 *
 * ONE PAST THE WHOLE CATALOG, not one past what is currently offered — because the menu shrinks
 * as agents are chosen and a number that moves between prompts is the defect this file's header
 * is about. It is only offered on the FIRST question anyway (see {@link defaultAgentLines}):
 * "none" is an answer to "which agents", never an answer to "any others?".
 */
export function noneOption(): number {
  return offeredAgents().length + 1;
}

/** `Choose [1/2/4/…]` — the numbers still on offer, in catalog order. */
export function optionsLabel(offered: readonly OfferedAgent[]): string {
  return `[${offered.map((a) => a.n).join("/")}]`;
}

/** The same, plus the `none` option — the label for the one question where it is on the table. */
export function optionsLabelWithNone(offered: readonly OfferedAgent[]): string {
  return `[${[...offered.map((a) => a.n), noneOption()].join("/")}]`;
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
  // and this block used to repeat it verbatim two lines later.
  return [
    "",
    "  This is a policy decision, and it is yours to make now rather than later: an",
    "  agent that is not on this list is prohibited by default, and everyone who joins",
    "  will be offered exactly what you choose here. You can change it afterwards —",
    "  through a pull request, like any other rule.",
    "",
    ...rows(offered),
    "",
    // AN ANSWER, NOT A WAY PAST THE QUESTION (Policy Owner, 2026-09-28).
    //
    // An organization may want gov purely to put structure into its development process and
    // never run an agent. Until this option existed it had to approve a tool it would never use
    // — and then nine harness files appeared in every project directory with no explanation.
    // Fixed behaviour must be complete on its own; agentic behaviour is additive.
    //
    // Worded as the other KIND of organization rather than as "skip": a skip would leave the
    // list unowned, which is the state #196 was written to remove. This is recorded, reported by
    // `gov doctor`, and reversed by one named command.
    `    ${String(noneOption()).padStart(2)}) ${paint(`${NO_AGENTS} — this organization does not use AI agents`, "bold", color)}`,
    "        gov still runs your process: projects, tasks, branches, knowledge, review.",
    "        Nothing agent-shaped is installed, rendered or offered.",
    "",
    "  Enter the number corresponding to the AI agent that you would like to use as",
    `  default for your organization — or ${noneOption()} if you will not be using AI agents.`,
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
  if (!parts.length) return NO_AGENTS;                       // structure-only; see confirmLines
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Read it back before it becomes a rule. */
export function confirmLines(agents: readonly ApprovedAgent[]): readonly string[] {
  // READ BACK IN THE ORGANIZATION'S OWN TERMS. "You have selected — none as authorized AI agents"
  // is grammatical and says nothing about what that BUYS, which for this answer is the only
  // interesting part: gov's whole fixed process, and no agent machinery anywhere.
  if (!agents.length) {
    return [
      "",
      "  You have selected — NO AI agents for your organization. gov will run your process",
      "  in full: projects, tasks, branches, knowledge and review. It will install no agent,",
      "  render no agent instructions into your projects, and offer none.",
      "",
      "  This is recorded as `authorized_agents: none` in org-config.yaml. You can start",
      "  using agents at any time with `gov agent approve <id>`.",
      "",
      "  If you are happy with this then choose 'Y' to continue, or 'N' to choose again.",
    ];
  }
  return [
    "",
    `  You have selected — ${namesSentence(agents)} as authorized AI agents to be used in`,
    "  your organization. You can change this selection by modifying values in",
    "  org-config.yaml (authorized_agents) later on if required.",
    "",
    "  If you are happy with your AI agent selection then choose 'Y' to continue, or 'N'",
    "  to discard these selections and choose again.",
  ];
}

export type PickResult =
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "done" }
  /** The organization runs NO agents — structure-only. Only offered on the first question. */
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly message: string };

/**
 * One answer, against what is currently on offer.
 *
 * `allowDone` is false for the default question — that one is not optional, and an EMPTY answer
 * there is still refused. What changed (Policy Owner, 2026-09-28) is that the refusal now points
 * at an option rather than at a wall: `none` is the answer for an organization that does not use
 * AI agents, and it is offered on exactly the same question. Empty and `none` are not the same:
 * one leaves the list unowned, the other records a decision.
 *
 * `none` is accepted only where `allowDone` is false — i.e. on the default question. As a reply
 * to "would you like to add any other agent?" it would be a contradiction, and blank already
 * means "no more".
 */
export function parsePick(answer: string, offered: readonly OfferedAgent[], allowDone: boolean): PickResult {
  const t = answer.trim();
  if (t === "") {
    return allowDone
      ? { kind: "done" }
      : { kind: "error", message: `Choose one — or ${noneOption()} if this organization does not use AI agents.` };
  }
  if (!allowDone && (t.toLowerCase() === NO_AGENTS || Number(t) === noneOption())) return { kind: "none" };
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
 *
 * AN EMPTY ARRAY IS AN ANSWER: the organization chose `none` and runs no AI agents. Null is the
 * absence of an answer. Every caller must keep those apart — one is recorded as
 * `authorized_agents: none`, the other stops adoption.
 */
export async function askAgentSelection(io: SelectIo): Promise<readonly ApprovedAgent[] | null> {
  const MAX = 40;
  let asked = 0;

  // The Y/n at the end can send us back here, which is the point of asking it.
  for (let round = 0; round < 5; round++) {
    const chosen: ApprovedAgent[] = [];
    /** `none` was chosen: an EMPTY `chosen` that is an answer, not an unfinished question. */
    let structureOnly = false;

    // ── the default ───────────────────────────────────────────────────────────────
    while (chosen.length === 0 && !structureOnly) {
      if (++asked > MAX) return null;
      const offered = offeredAgents();
      for (const l of defaultAgentLines(offered, io.color ?? false)) io.print(l);
      const r = parsePick(await io.prompt(`  Choose ${optionsLabelWithNone(offered)} : `, ""), offered, false);
      if (r.kind === "error") { io.print(`  ✗ ${r.message}`); continue; }
      if (r.kind === "none") structureOnly = true;
      if (r.kind === "pick") chosen.push({ id: r.id, default: true });
    }

    // ── additions, one at a time ──────────────────────────────────────────────────
    // SKIPPED ENTIRELY WHEN `none` WAS CHOSEN. "Would you like to add any other AI agent?" to an
    // organization that has just said it uses none would be asking the question again in a way
    // that suggests the first answer did not take.
    while (!structureOnly) {
      const offered = offeredAgents(chosen.map((c) => c.id));
      if (offered.length === 0) break;                    // everything is approved; nothing left to ask
      if (++asked > MAX) return null;
      for (const l of addMoreLines(offered, io.color ?? false)) io.print(l);
      const r = parsePick(await io.prompt(`  Choose ${optionsLabel(offered)} : `, ""), offered, true);
      if (r.kind === "done") break;
      if (r.kind === "error") { io.print(`  ✗ ${r.message}`); continue; }
      // `none` cannot arrive here — `parsePick` only returns it where `allowDone` is false — and
      // the compiler is the right place to hold that, rather than a comment claiming it.
      if (r.kind !== "pick") break;
      chosen.push({ id: r.id });
    }

    // ── read it back ──────────────────────────────────────────────────────────────
    for (const l of confirmLines(chosen)) io.print(l);
    if (++asked > MAX) return null;
    const yn = (await io.prompt("  Choose (Y/n) : ", "")).trim().toLowerCase();
    if (yn === "" || yn === "y" || yn === "yes") return chosen;
    io.print("");
    io.print("  Discarded. Choosing again.");
  }
  return null;
}
