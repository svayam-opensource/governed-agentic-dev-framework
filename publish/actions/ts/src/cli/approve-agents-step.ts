// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Adoption asks which agents this organization allows (#196, Q3).
 *
 * The alternative was a fallback: when no policy exists, treat the framework's list
 * as approved. That works and leaves an organization permanently governed by a
 * decision nobody made — and it makes auto-install act on nine vendors the org never
 * agreed to. The fallback is not guarded here; the STATE is removed. Adoption
 * produces an approved list, so "nobody has decided" never persists past setup.
 *
 * ONE ANSWER IS ENOUGH, and one is also the good default: an org with a single
 * approved agent has a default by definition, and a joiner in that org is never
 * asked to choose — they are told which agent is being installed, and consent to
 * the step like any other.
 *
 * Pure: the question and the answer's meaning live here, the asking is the caller's.
 */
import { AGENT_CATALOG } from "./agent-catalog.js";
import type { ApprovedAgent } from "../config/approved-agents.js";

/** The agents worth offering at adoption: the ones with something to run. */
export function selectableAgents(): readonly { readonly id: string; readonly tool: string; readonly how: string }[] {
  return AGENT_CATALOG.filter((a) => a.launch !== "none").map((a) => ({
    id: a.id,
    tool: a.tool,
    how: a.variants?.map((v) => v.label).join(" · ") ?? (a.launch === "ide" ? "the editor" : "in the terminal"),
  }));
}

export function approvalPrompt(): readonly string[] {
  const rows = selectableAgents().map((a, i) => `    ${String(i + 1).padStart(2)}) ${a.tool.padEnd(28)} ${a.how}`);
  return [
    "",
    "  Which AI agents may be used in this organization?",
    "",
    "  This is a policy decision, and it is yours to make now rather than later: an",
    "  agent that is not on this list is prohibited by default, and everyone who joins",
    "  will be offered exactly what you choose here. You can change it afterwards —",
    "  through a pull request, like any other rule.",
    "",
    ...rows,
    "",
    "  Enter the numbers you allow, separated by spaces. The first one becomes the",
    "  default for people who join.",
  ];
}

export type ApprovalChoice =
  | { readonly ok: true; readonly agents: readonly ApprovedAgent[] }
  | { readonly ok: false; readonly message: string };

/**
 * Read the answer. Refuses an empty one: this is the single question that must be
 * answered, because everything downstream — installs, the joiner's flow, the work
 * menu — reads the list it produces.
 */
export function parseApprovalChoice(answer: string): ApprovalChoice {
  const list = selectableAgents();
  const picks = answer.trim().split(/[\s,]+/).filter(Boolean);
  if (!picks.length) {
    return { ok: false, message: "Choose at least one — an organization with no approved agent cannot run any." };
  }

  const chosen: ApprovedAgent[] = [];
  for (const p of picks) {
    const n = Number(p);
    const byNumber = Number.isInteger(n) && n >= 1 && n <= list.length ? list[n - 1] : undefined;
    const byId = list.find((a) => a.id === p.toLowerCase());
    const hit = byNumber ?? byId;
    if (!hit) return { ok: false, message: `'${p}' is not one of the numbers above.` };
    if (!chosen.some((c) => c.id === hit.id)) chosen.push({ id: hit.id });
  }
  // The first pick is the default — stated in the prompt, so the order carries
  // meaning rather than being an accident of typing.
  chosen[0] = { ...chosen[0]!, default: true };
  return { ok: true, agents: chosen };
}

/** What was recorded, said plainly, because it is a rule now. */
export function approvalSummary(agents: readonly ApprovedAgent[]): readonly string[] {
  const name = (id: string): string => AGENT_CATALOG.find((a) => a.id === id)?.tool ?? id;
  return [
    "",
    `  Approved for this organization: ${agents.map((a) => name(a.id)).join(", ")}`,
    `  Default for people who join:    ${name(agents.find((a) => a.default)!.id)}`,
    "",
    "  Recorded in knowledge/policies/llm-governance.md. Changing it later goes",
    "  through a pull request — `gov agent approve <id>`.",
  ];
}
