// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Which agent to launch when nobody is asked, and who decided (#196, Q9; Policy Owner, 2026-10-12).
 *
 *   org      policies/governance.yaml  authorized_agents: what is ALLOWED, and the default
 *   project  the agent this person opened LAST TIME on this project (last-agent.ts), when resuming
 *
 * THE DEFAULT IS THE LAST ONE USED, ELSE THE ORG'S (Policy Owner, 2026-10-12). Resuming a project opens what you
 * were using on it; a project seeded from scratch has no "last time", so the org default answers; and a last-used
 * agent the org no longer approves, or that is not installed here, falls back to the org default — said out loud.
 * The developer-preference default (`agent.default`) that used to sit between the two was removed by the same
 * ruling: a per-person standing default competed with "what you used last time on this project".
 *
 * WHERE THIS STILL DECIDES. An organization approving more than one agent goes to the picker (agent-picker.ts),
 * whose Enter is this same default. This silent choice remains for the cases with nobody to ask or nothing to ask
 * about: no terminal, `work.agent.ask: never`, and an org that has not decided its list.
 *
 * THE LAST-USED AGENT IS CHECKED AT LAUNCH, every time — so an org narrowing its policy yesterday takes effect
 * today, rather than whenever someone happens to open a different agent.
 */
import type { ApprovedAgent } from "../config/approved-agents.js";
import { defaultAgent } from "../config/approved-agents.js";

export type ChoiceSource = "only-one" | "last-used" | "org-default" | "asked" | "none";

export interface ChoiceResult {
  readonly id: string | null;
  readonly source: ChoiceSource;
  /** Set when the agent used last time on this project could not be opened again — always said out loud. */
  readonly ignoredLastUsed?: { readonly id: string; readonly why: string };
}

/** A recorded launch kind as the approved id it runs: Cursor's editor is the approved `cursor`. */
export const approvedIdOf = (launch: string): string => (launch === "cursor-gui" ? "cursor" : launch);

/**
 * Decide without asking, if the layers allow. `lastUsed` is the launch kind recorded for this project (null when
 * seeding from scratch, or never opened here). `runnableIds` is what is actually installed: a last-used tool that
 * is approved but absent is not an error, it just cannot be opened today.
 */
export function chooseAgent(
  approved: readonly ApprovedAgent[] | null,
  lastUsed: string | null,
  runnableIds: readonly string[],
): ChoiceResult {
  // NULL IS "NO LIST", `[]` IS "NO AGENTS" (Policy Owner, 2026-09-28).
  //
  // This read `(approved ?? []).map(…)` and then waved the filter through whenever
  // `allowed.length === 0` — one test for two opposite facts. So an organization that recorded
  // `authorized_agents: none` had EVERY installed agent treated as usable, and a person with a
  // stated preference got it launched: the org's decision overridden by whatever was on the
  // machine. Null still means gov has no list to filter by; an empty list is a rule, and it
  // filters everything out, which is what it says.
  const allowed = approved === null ? null : approved.map((a) => a.id);
  const usable = allowed === null ? [...runnableIds] : runnableIds.filter((id) => allowed.includes(id));

  const last = lastUsed ? approvedIdOf(lastUsed) : null;
  if (last) {
    if (allowed !== null && !allowed.includes(last)) {
      // Checked here, every time — so a policy narrowed yesterday takes effect today.
      return { ...fallback(usable, approved), ignoredLastUsed: { id: last, why: "your organization no longer approves it" } };
    }
    if (!runnableIds.includes(last)) {
      return { ...fallback(usable, approved), ignoredLastUsed: { id: last, why: "it is not installed on this machine" } };
    }
    return { id: last, source: "last-used" };
  }

  if (usable.length === 1) return { id: usable[0]!, source: "only-one" };

  const def = defaultAgent(approved);
  if (def && usable.includes(def)) return { id: def, source: "org-default" };

  return { id: null, source: usable.length ? "asked" : "none" };
}

/** The last-used agent cannot be opened: the org default (the ruling's fallback), else the only one there is. */
function fallback(usable: readonly string[], approved: readonly ApprovedAgent[] | null): ChoiceResult {
  const def = defaultAgent(approved);
  if (def && usable.includes(def)) return { id: def, source: "org-default" };
  if (usable.length === 1) return { id: usable[0]!, source: "only-one" };
  return { id: null, source: usable.length ? "asked" : "none" };
}

/** Say who decided, so nobody has to guess why a particular agent opened. */
export function choiceExplanation(r: ChoiceResult, toolName: (id: string) => string): readonly string[] {
  const lines: string[] = [];
  if (r.ignoredLastUsed) {
    lines.push(`  ${toolName(r.ignoredLastUsed.id)}, the agent you used last time on this project, was not opened — ${r.ignoredLastUsed.why}.`);
  }
  if (!r.id) return lines;
  switch (r.source) {
    case "last-used":
      lines.push(`  Using ${toolName(r.id)} — the agent you used last time on this project.`); break;
    case "org-default":
      lines.push(`  Using ${toolName(r.id)} — your organization's default.`); break;
    case "only-one":
      lines.push(`  Using ${toolName(r.id)} — the only approved agent installed here.`); break;
    default: break;
  }
  return lines;
}
