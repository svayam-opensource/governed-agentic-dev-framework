// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Which agent to launch, and who decided (#196, Q9).
 *
 * Three layers already existed; the mistake would be inventing a fourth memory.
 *
 *   org      llm-governance.md    what is ALLOWED, and the default when >1
 *   user     preferences/<gh>.md  what this person LIKES, C03
 *   here     the prompt           only when neither layer answers
 *
 * The ordering is the honest one: an organization decides what may be used, a person
 * decides among those, and the question is asked once rather than daily.
 *
 * A PREFERENCE IS CHECKED AT LAUNCH, not at write time. If it were validated only
 * when written, an org narrowing its policy would keep launching the now-forbidden
 * tool until someone happened to edit their preferences — which is precisely the
 * shape of a rule that exists and does not bite. C03 already says a preference
 * cannot override org knowledge; this is what that means in code.
 */
import type { ApprovedAgent } from "../config/approved-agents.js";
import { defaultAgent } from "../config/approved-agents.js";

export type ChoiceSource = "only-one" | "preference" | "org-default" | "asked" | "none";

export interface ChoiceResult {
  readonly id: string | null;
  readonly source: ChoiceSource;
  /** Set when a stated preference could not be honoured — always said out loud. */
  readonly ignoredPreference?: { readonly id: string; readonly why: string };
}

/**
 * Decide without asking, if the layers allow. `runnableIds` is what is actually
 * installed: a preference for a tool that is approved but absent is not an error,
 * it just cannot be honoured today.
 */
export function chooseAgent(
  approved: readonly ApprovedAgent[] | null,
  preference: string | null,
  runnableIds: readonly string[],
): ChoiceResult {
  const allowed = (approved ?? []).map((a) => a.id);
  const usable = runnableIds.filter((id) => allowed.length === 0 || allowed.includes(id));

  if (preference) {
    if (allowed.length && !allowed.includes(preference)) {
      // Checked here, every time — so a policy narrowed yesterday takes effect today.
      return {
        id: pickWithout(usable, approved),
        source: usable.length === 1 ? "only-one" : "org-default",
        ignoredPreference: { id: preference, why: "your organization no longer approves it" },
      };
    }
    if (!runnableIds.includes(preference)) {
      return {
        id: pickWithout(usable, approved),
        source: usable.length === 1 ? "only-one" : "org-default",
        ignoredPreference: { id: preference, why: "it is not installed on this machine" },
      };
    }
    return { id: preference, source: "preference" };
  }

  if (usable.length === 1) return { id: usable[0]!, source: "only-one" };

  const def = defaultAgent(approved);
  if (def && usable.includes(def)) return { id: def, source: "org-default" };

  return { id: null, source: usable.length ? "asked" : "none" };
}

function pickWithout(usable: readonly string[], approved: readonly ApprovedAgent[] | null): string | null {
  if (usable.length === 1) return usable[0]!;
  const def = defaultAgent(approved);
  return def && usable.includes(def) ? def : null;
}

/** Say who decided, so nobody has to guess why a particular agent opened. */
export function choiceExplanation(r: ChoiceResult, toolName: (id: string) => string): readonly string[] {
  const lines: string[] = [];
  if (r.ignoredPreference) {
    lines.push(`  Your preferred agent (${toolName(r.ignoredPreference.id)}) was not used — ${r.ignoredPreference.why}.`);
  }
  if (!r.id) return lines;
  switch (r.source) {
    case "preference":
      lines.push(`  Using ${toolName(r.id)} — your preference.`); break;
    case "org-default":
      lines.push(`  Using ${toolName(r.id)} — your organization's default.`); break;
    case "only-one":
      lines.push(`  Using ${toolName(r.id)} — the only approved agent installed here.`); break;
    default: break;
  }
  return lines;
}
