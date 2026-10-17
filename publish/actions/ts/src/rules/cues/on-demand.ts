// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ON-DEMAND TIER (rule-model-design.md Q19; 2026-10-06) — DELIVERED AS SKILLS (intent 03 D6, X12; L14, W7 closed).
 *
 * The cues an agent should have when it is about to do the thing a rule is about, rather than on every turn. This
 * module used to hold `onDemandCues(set, event)`, a per-event lookup meant for "an agent integration [that] calls this
 * before acting". No integration ever called it (spec §8, D6: "`onDemandCues` has no caller"), so the tier reached
 * no agent. It is REPLACED by the skill renderer (src/skills/render.ts): every agent with native skills loads the
 * description up front and the body when the work matches, which is what the per-event call was for — and it needs
 * no gov process alive inside the agent's session.
 *
 * What stays here is the part both deliveries agree on: WHICH rows are on demand (C02 or C03, binding an agent — X12;
 * C01 is resident, cues/resident.ts) and how a binding's file globs are read, which the skill's "use when" quotes.
 *
 * Pure.
 */
import type { RuleRow } from "../model/rule-row.js";
import type { RuleSet } from "../model/contracts.js";
import type { CheckBinding } from "../model/catalog.js";
import { bindsAgent, orderedInForce } from "./order.js";

const GLOB_KEYS = ["paths", "when"] as const;

/** The globs a binding filters on, or null when it filters on none. A non-string entry is dropped, not guessed at. */
export function bindingGlobs(b: CheckBinding): string[] | null {
  const present = GLOB_KEYS.filter((k) => b.with && b.with[k] !== undefined);
  if (!present.length) return null;
  return present.flatMap((k) => {
    const v = b.with![k];
    return (Array.isArray(v) ? v : [v]).filter((g): g is string => typeof g === "string");
  });
}

/** Is this an on-demand row: in force (the caller's set), C02 or C03, and binding an agent? Cue optional. */
export const isOnDemand = (r: RuleRow): boolean => (r.level === "C02" || r.level === "C03") && bindsAgent(r);

/** Every in-force on-demand row, framework first then org, each by id number — the order skills list them in. */
export const onDemandRows = (set: RuleSet): RuleRow[] => orderedInForce(set, isOnDemand);
