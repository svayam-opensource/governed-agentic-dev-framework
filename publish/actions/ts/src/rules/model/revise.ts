// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * OPENING AND CLOSING REVISIONS — the proposer's verdicts, turned into rows (rule-model-design.md Q5, Q17; W1).
 *
 * The proposer (W4) says keep / revise / retire / add for each rule of a changed section; the CI gate (W5) checks
 * the result. Neither writes rows itself, because the two invariants a store lives by are easy to break by hand:
 *
 *   APPEND-ONLY. A change never edits a row. It closes the open one at version X and opens its successor at X,
 *                so the chain meets (validateRuleStore's `broken-chain`) and the history of what was in force
 *                when is still there to cite.
 *   GOV ISSUES IDS. An added rule's id comes from the {@link IdIssuer}, never from the verdict — the proposer is
 *                an LLM, and a model asked twice may number twice.
 *
 * ALL OR NOTHING. A verdict on an id that is not in force, or two verdicts on one id, refuses the whole batch:
 * half a proposal applied is a store nobody approved.
 *
 * Pure: rows in, rows out; the input is never mutated.
 */
import type { RuleRow, Stamp } from "./rule-row.js";
import type { IdIssuer, SectionVerdict } from "./contracts.js";

export type ApplyResult =
  | { readonly ok: true; readonly rows: readonly RuleRow[]; readonly issued: readonly string[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Apply `verdicts` to one store at `at` (the stamp of the PR that makes them so). `scope` is the store's own —
 * `FRM` or the org slug — and is what an added rule is numbered in.
 */
export function applyVerdicts(
  rows: readonly RuleRow[],
  verdicts: readonly SectionVerdict[],
  at: Stamp,
  issuer: IdIssuer,
  scope: string,
): ApplyResult {
  const openAt = new Map<string, number>();
  rows.forEach((r, i) => { if (r.end === null) openAt.set(r.id, i); });

  const problems: string[] = [];
  const seen = new Set<string>();
  for (const v of verdicts) {
    if (v.kind === "add") continue;
    if (seen.has(v.id)) problems.push(`${v.id}: more than one verdict — keep, revise and retire are exclusive`);
    seen.add(v.id);
    if (!openAt.has(v.id)) problems.push(`${v.id}: ${v.kind} needs a rule in force, and ${v.id} is ${rows.some((r) => r.id === v.id) ? "retired" : "not in this store"}`);
  }
  if (problems.length) return { ok: false, problems };

  const out: RuleRow[] = [...rows];
  const issued: string[] = [];
  const close = (id: string) => { const i = openAt.get(id)!; out[i] = { ...out[i]!, end: at }; };
  for (const v of verdicts) {
    switch (v.kind) {
      case "keep": break;
      case "retire": close(v.id); break;
      case "revise": close(v.id); out.push({ ...v.row, id: v.id, start: at, end: null }); break;
      case "add": {
        const id = issuer.next(scope);
        issued.push(id);
        out.push({ ...v.row, id, start: at, end: null });
        break;
      }
    }
  }
  return { ok: true, rows: out, issued };
}
