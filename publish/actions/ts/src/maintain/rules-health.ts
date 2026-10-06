// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT `gov doctor` SAYS ABOUT THE RULES — the numbers that decide whether a policy has teeth.
 *
 * A Policy Owner cannot tell, by reading their own policy, how much of it is enforced. That is not a failure of
 * attention: the document reads as though every rule binds equally. The only way to know is to be told, so
 * `doctor` tells you — from the rule stores, by the same derivation the rule map uses (`summariseRuleSet`, W8),
 * so doctor and `agent/harness/rule-map.md` can never disagree about a count.
 *
 * FOUR ROWS, each answering a question somebody actually asks:
 *   · how much of my policy is enforced, and by what (the six rule-map classes);
 *   · what is my agents' resident block costing on every turn;
 *   · are the generated files current, or do my rules say something my agents have not been told;
 *   · did anything stop being verifiable — a row whose source section moved on without it, a row in error.
 *
 * Pure over the facts, so the rows are tested without a repository.
 */
import type { RuleClass } from "../rules/model/catalog.js";

export interface RulesRow {
  readonly name: string;
  readonly status: "ok" | "warn" | "fail";
  readonly detail: string;
}

/** What doctor needs to know about the rules. Absent ⇒ no rows, per doctor's own rule. */
export interface RulesFacts {
  /** In-force rules per class — `summariseRuleSet`. */
  readonly counts: Readonly<Record<RuleClass, number>>;
  /** Resident cues, and their characters — the text every agent carries on every turn. */
  readonly resident: number;
  readonly residentChars: number;
  /** The budget, in tokens: a forcing function, not a physical limit. */
  readonly residentBudgetTokens?: number;
  /** Generated files whose bytes differ from what the rule stores now produce. */
  readonly staleFiles: readonly string[];
  /** In-force rows whose source section changed since they were approved — pending `gov rules propose`. */
  readonly staleRows: readonly string[];
  /** Row and binding errors in the stores. */
  readonly errors: readonly string[];
}

/**
 * Tokens from characters, at four characters each. Deliberately approximate: the number is there to be watched for
 * growth, and shipping a tokenizer to make a budget line prettier would be a dependency this CLI does not take.
 */
export const approxTokens = (chars: number): number => Math.round(chars / 4);

/** The classes in which nothing verifies the rule was followed. */
const UNVERIFIED: readonly RuleClass[] = ["cued", "advisory", "cannot-tell"];

export function rulesRows(facts: RulesFacts | undefined): readonly RulesRow[] {
  if (!facts) return [];
  const rows: RulesRow[] = [];
  const c = facts.counts;
  const total = Object.values(c).reduce((n, k) => n + k, 0);
  const unverified = UNVERIFIED.reduce((n, k) => n + c[k], 0);

  // ── how much of it is enforced ──────────────────────────────────────────────────────────────────────────────
  //
  // A WARNING WHEN MOST RULES ARE VERIFIED BY NOTHING, because that is the finding, not an incidental: the policy
  // is asking people and agents to remember things, and the honest response is a check or striking the rule.
  rows.push({
    name: "rules",
    status: total === 0 || unverified > total / 2 ? "warn" : "ok",
    detail: total === 0
      ? "no rule is in force — the rule stores are empty"
      : `${total} rules: ${c.prevented} prevented · ${c.detected} detected · ${c.judged} judged · ${c.cued} cued · ${c.advisory} advisory · ${c["cannot-tell"]} cannot-tell`
        + (unverified > total / 2 ? ` — ${unverified} of ${total} are verified by nothing` : ""),
  });

  // ── what the resident block costs ────────────────────────────────────────────────────────────────────────────
  const tokens = approxTokens(facts.residentChars);
  const budget = facts.residentBudgetTokens ?? 2000;
  rows.push({
    name: "resident rules",
    status: tokens > budget ? "warn" : "ok",
    detail: `${facts.resident} cue(s), ~${tokens} tokens in every agent's context, every turn (budget ${budget})`
      + (tokens > budget ? " — something that belongs in a rule's check may have been put in a cue" : ""),
  });

  // ── are the agents being told what the rules now say ────────────────────────────────────────────────────────
  //
  // FAIL, not warn. A stale generated file means the rules on the branch and the rules an agent carries disagree,
  // and the agent is the one acting.
  rows.push(facts.staleFiles.length
    ? {
      name: "rules build",
      status: "fail",
      detail: `${facts.staleFiles.length} generated file(s) stale — run \`gov rules build\`: ${facts.staleFiles.slice(0, 3).join(", ")}`
        + (facts.staleFiles.length > 3 ? `, and ${facts.staleFiles.length - 3} more` : ""),
    }
    : { name: "rules build", status: "ok", detail: "every generated file matches the rule stores" });

  // ── did anything stop being verifiable ──────────────────────────────────────────────────────────────────────
  if (facts.staleRows.length) {
    rows.push({
      name: "rule rows",
      status: "warn",
      detail: `${facts.staleRows.length} rule(s) pending re-review — their source section changed since approval `
        + `(${facts.staleRows.slice(0, 4).join(", ")}${facts.staleRows.length > 4 ? ", …" : ""}). Run \`gov rules propose\``,
    });
  }
  if (facts.errors.length) {
    rows.push({
      name: "rule stores",
      status: "fail",
      detail: `${facts.errors.length} error(s) in the rule stores — run \`gov rules report\` for each one`,
    });
  }
  return rows;
}
