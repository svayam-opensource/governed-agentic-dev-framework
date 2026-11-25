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
 * Pure: what an approval MEANS is said here — the summary, the structure-only lines and the doctor row.
 */
import { AGENT_CATALOG } from "./agent-catalog.js";
import { readAuthorizedAgents, defaultAgent, NO_AGENTS, type ApprovedAgent } from "../config/approved-agents.js";

// THE QUESTION ITSELF LIVES IN agent-selection.ts (PRJ-121 F158, ruling Q12 A, 2026-11-25). This file used to hold an
// older space-separated form of it ("the first one becomes the default") that nothing called any more; it was removed
// when the question moved to the shared picker, so there is one question and not two that could drift apart.

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
    `  \`authorized_agents: ${NO_AGENTS}\` in policies/governance.yaml.`,
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
    "  Recorded in policies/governance.yaml (authorized_agents). Changing it later goes",
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
 * Null when no `policies/governance.yaml` was looked for, which is the rule doctor.ts states for itself: a
 * row about a fact nobody gathered is worse than no row.
 */
export interface AgentsDiagnostic {
  readonly name: "agents";
  readonly status: "ok" | "warn";
  readonly detail: string;
}

export function agentsDiagnostic(governanceText: string | null | undefined): AgentsDiagnostic | null {
  if (governanceText === undefined) return null;
  const r = readAuthorizedAgents(governanceText);
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
