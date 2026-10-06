// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT A HUMAN SEES WHEN A GATE REFUSES (rule-model-design.md Q19; 2026-10-06).
 *
 * Humans get no cues. They meet the rule here, at the gate: its GOV id, its level, and the NORMALISED expectation
 * the Policy Owner approved — never the agent cue, which is phrasing for a model, not the rule — then the
 * findings. `cannot-tell` is said as such; it is never dressed up as a pass.
 *
 * Pure and byte-stable.
 */
import type { RuleRow } from "../model/rule-row.js";
import type { CheckVerdict } from "../model/contracts.js";

const OUTCOME: Readonly<Record<CheckVerdict["verdict"], string>> = {
  fail: "failed",
  "cannot-tell": "could not tell",
  pass: "passed",
};

export function humanGateMessage(row: RuleRow, verdict: CheckVerdict): string {
  const findings = verdict.findings.length ? verdict.findings.map((f) => `  - ${f}`) : ["  (none reported)"];
  return [
    `${row.id} · ${row.level} — ${OUTCOME[verdict.verdict]}`,
    `Expectation: ${row.expectation.trim()}`,
    `Source: ${row.source.doc} §${row.source.section}`,
    "Findings:",
    ...findings,
  ].join("\n");
}
