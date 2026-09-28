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
import { paint } from "./format.js";
import { AGENT_CATALOG } from "./agent-catalog.js";
import { readAuthorizedAgents, defaultAgent, NO_AGENTS, type ApprovedAgent } from "../config/approved-agents.js";

/** The agents worth offering at adoption: the ones with something to run. */
export function selectableAgents(): readonly { readonly id: string; readonly tool: string; readonly how: string }[] {
  // `deferred` entries are known to gov and NOT offered — see AgentCandidate.deferred.
  return AGENT_CATALOG.filter((a) => a.launch !== "none" && !a.deferred).map((a) => ({
    id: a.id,
    tool: a.tool,
    how: a.variants?.map((v) => v.label).join(" · ") ?? (a.launch === "ide" ? "the editor" : "in the terminal"),
  }));
}

/**
 * The number that means "no AI agents at all" — one past the last agent, so the agents keep the
 * numbers they have always had and nobody's muscle memory selects the new option by accident.
 */
export function noneOption(): number {
  return selectableAgents().length + 1;
}

export function approvalPrompt(color = false): readonly string[] {
  const rows = selectableAgents().map((a, i) => `    ${String(i + 1).padStart(2)}) ${a.tool.padEnd(28)} ${a.how}`);
  return [
    "",
    `  ${paint("Which AI agents may be used in this organization?", "bold", color)}`,
    "",
    "  This is a policy decision, and it is yours to make now rather than later: an",
    "  agent that is not on this list is prohibited by default, and everyone who joins",
    "  will be offered exactly what you choose here. You can change it afterwards —",
    "  through a pull request, like any other rule.",
    "",
    ...rows,
    "",
    // A CHOICE, NOT A SKIP (Policy Owner, 2026-09-28). The wording carries the whole difference:
    // "skip" would leave the organization in the unowned state #196 removed, whereas this is an
    // answer — recorded, reported by `gov doctor`, and reversible by a named command. Numbered
    // and set apart so it reads as the other kind of organization, not as a way out of the
    // question.
    `    ${String(noneOption()).padStart(2)}) ${paint("none — this organization does not use AI agents", "bold", color)}`,
    "        gov still runs your process: projects, tasks, branches, knowledge, review.",
    "        Nothing agent-shaped is installed, rendered or offered. Turn agents on any",
    "        time with `gov agent approve <id>`.",
    "",
    "  Enter the numbers you allow, separated by spaces. The first one becomes the",
    `  default for people who join — or ${noneOption()} on its own.`,
  ];
}

export type ApprovalChoice =
  | { readonly ok: true; readonly agents: readonly ApprovedAgent[] }
  | { readonly ok: false; readonly message: string };

/**
 * Read the answer. Refuses an EMPTY one — still — and that is not the same as refusing "none".
 *
 * Everything downstream reads the list this produces: installs, the joiner's flow, the work menu.
 * An empty answer leaves them reading nothing, which is the unowned state #196 removed. `none`
 * (the last number, or the word) leaves them reading a DECISION: no agents, structure-only. So the
 * refusal stays and now points at the option that says what an empty answer was being used to mean.
 */
export function parseApprovalChoice(answer: string): ApprovalChoice {
  const list = selectableAgents();
  const none = noneOption();
  const picks = answer.trim().split(/[\s,]+/).filter(Boolean);
  if (!picks.length) {
    return {
      ok: false,
      message: `Choose at least one — or ${none} if this organization does not use AI agents.`,
    };
  }
  // NONE IS EXCLUSIVE, and saying so beats quietly dropping one half of a contradiction. "1 8"
  // is not a smaller list, it is two different answers, and the person meant one of them.
  const saysNone = picks.some((p) => p.toLowerCase() === NO_AGENTS || Number(p) === none);
  if (saysNone && picks.length > 1) {
    return { ok: false, message: `${none} means no AI agents at all — choose it on its own, or choose the agents you allow.` };
  }
  if (saysNone) return { ok: true, agents: [] };

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

/** The one command that turns agents on later, named everywhere gov says agents are off. */
export const TURN_AGENTS_ON = "gov agent approve <id>";

/**
 * What an organization that runs no agents is told — at adoption, and again by every step that
 * would otherwise have offered an agent.
 *
 * THE SECOND HALF IS THE IMPORTANT HALF. A structure-only org that is merely not offered anything
 * cannot tell "off by decision" from "gov is broken here", so every one of these screens names
 * the decision, where it is recorded, and the command that reverses it.
 */
export function structureOnlyLines(): readonly string[] {
  return [
    "  AI agents are OFF for this organization — recorded as",
    `  \`authorized_agents: ${NO_AGENTS}\` in org-config.yaml.`,
    "",
    "  Everything else is unchanged: projects, tasks, branches, knowledge, review,",
    "  and the pull-request path. gov installs no agent, renders no agent harness,",
    "  and offers none.",
    "",
    `  To start using agents:  ${TURN_AGENTS_ON}   (it raises a pull request)`,
  ];
}

/** What was recorded, said plainly, because it is a rule now. */
export function approvalSummary(agents: readonly ApprovedAgent[]): readonly string[] {
  const name = (id: string): string => AGENT_CATALOG.find((a) => a.id === id)?.tool ?? id;
  // THE DECISION TO USE NONE IS READ BACK LIKE ANY OTHER (Policy Owner, 2026-09-28). It reached
  // here as an empty list and printed `Approved for this organization: ` followed by nothing,
  // then threw on `agents.find((a) => a.default)!` — a non-null assertion that was true only
  // while the list could not be empty.
  if (!agents.length) {
    return [
      "",
      `  Approved for this organization: ${NO_AGENTS} — this organization does not use AI agents.`,
      "",
      ...structureOnlyLines(),
    ];
  }
  return [
    "",
    `  Approved for this organization: ${agents.map((a) => name(a.id)).join(", ")}`,
    `  Default for people who join:    ${name(agents.find((a) => a.default)!.id)}`,
    "",
    "  Recorded in org-config.yaml (authorized_agents). Changing it later goes",
    "  through a pull request — `gov agent approve <id>`.",
  ];
}

/**
 * `gov doctor`'s agents row — a STATE, never a warning.
 *
 * An organization that chose to run no agents is not misconfigured, and a report that says
 * otherwise teaches people to ignore the report. Equally, "nobody has answered" IS worth a
 * warning, because the org is being governed by a list it never chose. The row exists to tell
 * those two apart on one line.
 *
 * Shaped to be assignable to doctor's own `Diagnostic` without this module importing it — cli
 * does not depend on maintain, and a row is three fields.
 *
 * Null when no `org-config.yaml` was examined, which is the rule doctor.ts states for itself: a
 * row about a fact nobody gathered is worse than no row.
 */
export interface AgentsDiagnostic {
  readonly name: "agents";
  readonly status: "ok" | "warn";
  readonly detail: string;
}

export function agentsDiagnostic(orgConfigText: string | null | undefined): AgentsDiagnostic | null {
  if (orgConfigText === null || orgConfigText === undefined) return null;
  const r = readAuthorizedAgents(orgConfigText);
  if (r.kind === "none") return { name: "agents", status: "ok", detail: `${NO_AGENTS} authorized (structure-only)` };
  if (r.kind === "unset") {
    return {
      name: "agents",
      status: "warn",
      detail: `not chosen yet — gov is using the framework's list. Choose with \`${TURN_AGENTS_ON}\`, `
        + `or record \`authorized_agents: ${NO_AGENTS}\` if this organization does not use agents`,
    };
  }
  const name = (id: string): string => AGENT_CATALOG.find((a) => a.id === id)?.tool ?? id;
  const def = defaultAgent(r.agents);
  return {
    name: "agents",
    status: "ok",
    detail: `${r.agents.length} authorized${def ? ` (default: ${name(def)})` : ""}`,
  };
}
