// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ON-DEMAND TIER (rule-model-design.md Q19; 2026-10-06).
 *
 * A cue an agent is shown only when it is about to do the thing the rule is about. It is KEYED BY THE SAME
 * resource/event AS THE RULE'S CHECK — so the moment the agent is cued and the moment the check fires cannot drift
 * apart. An agent integration calls this before acting.
 *
 * File globs: a binding whose `with.paths` or `with.when` carries globs applies only when a changed path matches
 * (src/rules/glob.ts; an empty glob list matches nothing). When the caller does not yet know the paths (`paths`
 * undefined), the binding counts — an extra cue costs a line, a missing one costs the rule.
 *
 * Pure: rule set and event in, cues out, framework first then org, each by id; one cue per rule.
 */
import type { RuleRow, Level } from "../model/rule-row.js";
import type { RuleSet } from "../model/contracts.js";
import type { CheckBinding } from "../model/catalog.js";
import { matchesAny } from "../glob.js";
import { bindsAgent, orderedInForce } from "./order.js";

export interface CueEvent {
  readonly resource: string;
  readonly event: string;
  /** The changed paths, forward-slashed. Undefined = not known yet. */
  readonly paths?: readonly string[];
}

export interface OnDemandCue {
  readonly id: string;
  readonly level: Level;
  readonly text: string;
}

const GLOB_KEYS = ["paths", "when"] as const;

/** The globs a binding filters on, or null when it filters on none. A non-string entry is dropped, not guessed at. */
function globsOf(b: CheckBinding): string[] | null {
  const present = GLOB_KEYS.filter((k) => b.with && b.with[k] !== undefined);
  if (!present.length) return null;
  return present.flatMap((k) => {
    const v = b.with![k];
    return (Array.isArray(v) ? v : [v]).filter((g): g is string => typeof g === "string");
  });
}

function bindingApplies(b: CheckBinding, ev: CueEvent): boolean {
  if (b.on.resource !== ev.resource || b.on.event !== ev.event) return false;
  const globs = globsOf(b);
  if (globs === null || ev.paths === undefined) return true;
  return ev.paths.some((p) => matchesAny(p, globs));
}

const wanted = (ev: CueEvent) => (r: RuleRow): boolean =>
  r.cue?.tier === "on-demand" && bindsAgent(r) && (r.checks ?? []).some((b) => bindingApplies(b, ev));

export function onDemandCues(set: RuleSet, ev: CueEvent): OnDemandCue[] {
  return orderedInForce(set, wanted(ev)).map((r) => ({ id: r.id, level: r.level, text: r.cue!.text }));
}
