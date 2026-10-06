// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE RESIDENT TIER (rule-model-design.md Q11, Q19; 2026-10-06).
 *
 * The lines an agent carries EVERY turn: the cue of each in-force rule whose row says `cue.tier: resident`
 * (validation already holds those to C01 with an agent actor). The cue lives in the rule row; the policy prose is
 * never touched. This module renders the block that replaces `{{render.always_rules}}` in the session protocol —
 * the same place `assembleResidentBlock` (harness-render.ts) fills today from inline `gov:cue` blocks.
 *
 * A HARD CAP, AND IT FAILS RATHER THAN TRUNCATES. A resident block is read only while it is short; past that, the
 * rules at the bottom stop being read, and truncating would silently drop rules the owner approved as binding
 * every turn. So too many rows is a build error naming them, and the owner merges or shortens.
 *
 * Pure and byte-stable: rows in, text (or a failure) out; no clock, no environment.
 */
import type { RuleRow } from "../model/rule-row.js";
import type { RuleSet } from "../model/contracts.js";
import { orderedInForce } from "./order.js";

/** At most this many resident rules — one line each. */
export const RESIDENT_CAP = 40;

/** A failure the caller must surface — the same `error` shape harness-render.ts returns — plus the rows at fault. */
export interface ResidentFailure {
  readonly error: string;
  readonly ids: readonly string[];
}

/** The lead line `carriesResidentBlock` (harness-render.ts) recognises; keep its first words. */
const LEAD = [
  "**These rules bind every turn, not just the first. Each line is a rule's GOV id and its cue; the rule row",
  "that id names is the authority.**",
];

/** The in-force resident rows, framework first then org, each by id. */
export const residentRows = (set: RuleSet): RuleRow[] => orderedInForce(set, (r) => r.cue?.tier === "resident");

/** `- GOV-ID · text`. A list item, because Markdown fuses adjacent plain lines into one paragraph. */
const line = (r: RuleRow): string => `- ${r.id} · ${r.cue!.text.trim()}`;

export function renderResidentBlock(set: RuleSet): string | ResidentFailure {
  const rows = residentRows(set);
  if (rows.length === 0) {
    return {
      error: "no in-force rule carries a resident cue — the resident block would render EMPTY, and a harness file "
        + "with an empty resident block looks governed and governs nothing.",
      ids: [],
    };
  }
  const notOneLine = rows.filter((r) => r.cue!.text.trim() === "" || /[\r\n]/.test(r.cue!.text.trim()));
  if (notOneLine.length) {
    const ids = notOneLine.map((r) => r.id);
    return { error: `a resident cue is exactly one non-empty line; these are not: ${ids.join(", ")}`, ids };
  }
  if (rows.length > RESIDENT_CAP) {
    const ids = rows.map((r) => r.id);
    return {
      error: `${rows.length} resident cues exceed the cap of ${RESIDENT_CAP}. Nothing is truncated: the owner must `
        + `merge rules or shorten the tier (move some to on-demand) until it fits. Resident rows: ${ids.join(", ")}`,
      ids,
    };
  }
  return [...LEAD, "", ...rows.map(line)].join("\n");
}
