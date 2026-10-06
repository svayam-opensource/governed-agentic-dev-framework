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
 * APPROVED EXCEPTIONS RIDE IN THE SAME BLOCK (spec §10.4; GOV-FRM-464). An exception the agent is not told about
 * is one it stops for anyway, and people learn to talk their way past cues. So the caller may pass the exceptions
 * it read from the DEFAULT branch (exceptions-io.ts), and each one in force today, for this project, is listed
 * under the C02 rule it relaxes — one line each, naming its id, scope, expiry and approver. A lapsed one is simply
 * not listed, so the rule speaks again at the next build with nothing else to do. They do not count toward the cap:
 * the cap is on rules, and an exception's line is bounded by the rule it hangs from.
 *
 * Pure and byte-stable: rows in, text (or a failure) out; no clock, no environment — "today" is an input.
 */
import type { RuleRow } from "../model/rule-row.js";
import type { RuleSet } from "../model/contracts.js";
import { applies, exceptionRefusal, type Exception } from "../exceptions.js";
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

/** The optional exceptions input: what was read at the default branch, and the moment and project to judge it for. */
export interface ResidentExceptions {
  /** Parsed exceptions (exceptions-io.ts `loadExceptions`); lapsed and out-of-scope ones are filtered here. */
  readonly exceptions: readonly Exception[];
  /** YYYY-MM-DD — the day the block is built for. An exception expiring today is still in force. */
  readonly today: string;
  /** The project the block is built for; an exception scoped elsewhere is left out. */
  readonly project?: string;
}

/** The lead of the exceptions section — after the rule lines, so the verifier's lead stays the block's first words. */
const EXCEPTIONS_LEAD = [
  "**Approved exceptions in force here.** Each relaxes the C02 rule it is listed under, only for the scope it",
  "names and only until it expires; then the rule binds again.",
];

const exceptionLine = (e: Exception): string =>
  `  - EXCEPTION ${e.id} permits ${e.why || "a documented deviation"} in `
  + `${e.scope.length ? e.scope.join(", ") : "this organization"} until ${e.expires} (approved: ${e.approvedBy}).`;

/** The exceptions section, grouped under the rule each relaxes; [] when none is in force. */
function exceptionSection(set: RuleSet, input: ResidentExceptions): string[] | ResidentFailure {
  const live = input.exceptions.filter((e) => applies(e, input.today, input.project));
  // A caller that skipped the loader's refusal must not slip a framework or C01 rule's exception in here.
  const refused = live.filter((e) => exceptionRefusal(e.clause, set) !== null);
  if (refused.length) {
    return {
      error: "these exceptions name a rule that cannot be excepted, so they are not rendered: "
        + refused.map((e) => `${e.id} (${e.path}): ${exceptionRefusal(e.clause, set)}`).join("; "),
      ids: [...new Set(refused.map((e) => e.clause))],
    };
  }
  if (!live.length) return [];
  const rules = orderedInForce(set, (r) => live.some((e) => e.clause === r.id));
  const out = ["", ...EXCEPTIONS_LEAD, ""];
  for (const r of rules) {
    out.push(`- ${r.id} · ${r.expectation.trim()}`);
    const mine = live.filter((e) => e.clause === r.id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.push(...mine.map(exceptionLine));
  }
  return out;
}

export function renderResidentBlock(set: RuleSet, exceptions?: ResidentExceptions): string | ResidentFailure {
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
  const section = exceptions ? exceptionSection(set, exceptions) : [];
  if (!Array.isArray(section)) return section;
  return [...LEAD, "", ...rows.map(line), ...section].join("\n");
}
