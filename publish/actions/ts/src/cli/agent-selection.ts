// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Which AI agents may be used in this organization — the default first, then any others.
 *
 * WHY THIS REPLACED A SPACE-SEPARATED LIST. The question used to be "enter the numbers you
 * allow, separated by spaces. The first one becomes the default" — which asks for three
 * different things in one line: a set, an order, and the knowledge that position one is
 * special. Reversing two digits changed the organization's default without changing anything
 * visible. It is the most consequential answer in adoption and it had the least forgiving shape.
 *
 * So the DEFAULT is its own question — a single-select — and the others are a MULTI-SELECT of
 * what is left (PRJ-121 F158, Policy Owner ruling Q12 A, 2026-11-25). Both go through the one
 * shared picker (`picker.ts`): arrow keys and Space in a real terminal, and the numbered form
 * everywhere else — `Choose [1/2/…] :` for the default, `2,4` (blank = none) for the others.
 * Numbers stay STABLE — choosing 8 leaves 3 as 3 — because a list that renumbers itself
 * between prompts turns an answer the reader has already composed into the wrong one.
 *
 * It ends with the selection read back and a Y/n. Everything above is reversible until then.
 *
 * Pure, plus one driver that takes its asking as an argument.
 */
import { paint } from "./format.js";
import { pickOne, pickMany, type PickItem, type PickerTerminal } from "./picker.js";
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

/** The question the default is asked with (ruling Q12 A, word for word). */
export const DEFAULT_AGENT_QUESTION = "Which AI agent would you like to use as the default in your organization?";
/** The question the others are asked with. */
export const MORE_AGENTS_QUESTION = "Would you like to add any other AI agent to the allowed list?";

const agentItem = (a: OfferedAgent): PickItem => ({ label: a.tool, detail: a.how, number: a.n, aliases: [a.id] });

/** The `none` row — the other KIND of organization, not a way past the question. */
export function noneItem(): PickItem {
  return {
    label: `${NO_AGENTS} — this organization does not use AI agents`,
    number: noneOption(),
    aliases: [NO_AGENTS],
    note: [
      "gov still runs your process: projects, tasks, branches, knowledge, review.",
      "Nothing agent-shaped is installed, rendered or offered.",
    ],
  };
}

/** The default question's items: every offered agent, then `none`. */
export function defaultAgentItems(offered: readonly OfferedAgent[] = offeredAgents()): readonly PickItem[] {
  return [...offered.map(agentItem), noneItem()];
}

/**
 * The prose above the default question. Printed in both forms: it is the reason the question
 * is being asked now, and an arrow key does not make it less true.
 */
export function defaultAgentLines(): readonly string[] {
  // NO HEADING HERE. The interview prints `Q3 - <DEFAULT_AGENT_QUESTION>` as its question line.
  return [
    "",
    "  This is a policy decision, and it is yours to make now rather than later: an",
    "  agent that is not on this list is prohibited by default, and everyone who joins",
    "  will be offered exactly what you choose here. You can change it afterwards —",
    "  through a pull request, like any other rule.",
  ];
}

/** The numbered form's instruction under the default list. */
export function defaultAgentHelp(): readonly string[] {
  // AN ANSWER, NOT A WAY PAST THE QUESTION (Policy Owner, 2026-09-28): `none` is recorded,
  // reported by `gov doctor`, and reversed by one named command.
  return [
    "",
    "  Enter the number corresponding to the AI agent that you would like to use as",
    `  default for your organization — or ${noneOption()} if you will not be using AI agents.`,
  ];
}

/** The prose above the multi-select of the others. */
export function addMoreLines(color = false): readonly string[] {
  return [
    "",
    `  ${paint(MORE_AGENTS_QUESTION, "bold", color)}`,
    "  Choose any number of them, or none, to finish AI agent selection.",
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
      "  This is recorded as `authorized_agents: none` in policies/governance.yaml. You can start",
      "  using agents at any time with `gov agent approve <id>`.",
      "",
      "  If you are happy with this then choose 'Y' to continue, or 'N' to choose again.",
    ];
  }
  return [
    "",
    `  You have selected — ${namesSentence(agents)} as authorized AI agents to be used in`,
    "  your organization. You can change this selection by modifying values in",
    "  policies/governance.yaml (authorized_agents) later on if required.",
    "",
    "  If you are happy with your AI agent selection then choose 'Y' to continue, or 'N'",
    "  to discard these selections and choose again.",
  ];
}

export interface SelectIo {
  /** Ask, with the label already built by the caller; returns the raw answer. */
  readonly prompt: (question: string, def: string) => Promise<string>;
  readonly print: (line: string) => void;
  readonly color?: boolean;
  /** A terminal the picker may take for arrow keys. Absent = the numbered form. See picker.ts. */
  readonly terminal?: PickerTerminal | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Ctrl-C in the arrow form (tests). Default: exit 130 once the terminal is restored. */
  readonly onInterrupt?: () => void;
}

/**
 * Drive the whole selection. Returns null when no usable answer arrives — bounded, because
 * "ask again" assumes someone is there to answer, and a scripted stdin repeats itself forever.
 *
 * AN EMPTY ARRAY IS AN ANSWER: the organization chose `none` and runs no AI agents. Null is the
 * absence of an answer. Every caller must keep those apart — one is recorded as
 * `authorized_agents: none`, the other stops adoption.
 *
 * The first agent in the result carries `default: true` — `renderApprovedAgents` writes it so.
 */
export async function askAgentSelection(io: SelectIo): Promise<readonly ApprovedAgent[] | null> {
  const color = io.color ?? false;
  const pio = {
    prompt: io.prompt,
    print: io.print,
    ...(io.terminal ? { terminal: io.terminal } : {}),
    ...(io.env ? { env: io.env } : {}),
    ...(io.onInterrupt ? { onInterrupt: io.onInterrupt } : {}),
  };

  // The Y/n at the end can send us back here, which is the point of asking it.
  for (let round = 0; round < 5; round++) {
    // ── the default: a single-select, `none` included ─────────────────────────────────
    const offered = offeredAgents();
    const items = defaultAgentItems(offered);
    const first = await pickOne(pio, {
      lead: defaultAgentLines(),
      items,
      numberedHelp: defaultAgentHelp(),
      emptyError: `Choose one — or ${noneOption()} if this organization does not use AI agents.`,
      color,
    });
    if (first === null) return null;
    const chosen: ApprovedAgent[] = [];
    const def = offered[first];                      // undefined = the `none` row, the last item
    if (def) chosen.push({ id: def.id, default: true });

    // ── the others: a multi-select of what is left ────────────────────────────────────
    // SKIPPED ENTIRELY WHEN `none` WAS CHOSEN. "Would you like to add any other AI agent?" to an
    // organization that has just said it uses none would suggest the first answer did not take.
    if (def) {
      const rest = offeredAgents([def.id]);
      if (rest.length) {
        const more = await pickMany(pio, { lead: addMoreLines(color), items: rest.map(agentItem), color });
        if (more === null) return null;
        for (const i of more) chosen.push({ id: rest[i]!.id });
      }
    }

    // ── read it back ──────────────────────────────────────────────────────────────────
    for (const l of confirmLines(chosen)) io.print(l);
    const yn = (await io.prompt("  Choose (Y/n) : ", "")).trim().toLowerCase();
    if (yn === "" || yn === "y" || yn === "yes") return chosen;
    io.print("");
    io.print("  Discarded. Choosing again.");
  }
  return null;
}
