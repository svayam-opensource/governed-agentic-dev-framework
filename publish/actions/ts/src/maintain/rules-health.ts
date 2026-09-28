// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT `gov doctor` SAYS ABOUT THE RULES — the numbers that decide whether a policy has teeth.
 *
 * A Policy Owner cannot tell, by reading their own policy, how much of it is enforced. That is not a failure of
 * attention: the document reads as though every clause binds equally, when in this framework's own policy 3 of
 * 107 rules are checked, 8 are resident in an agent's context, and 92 are advisory — enforced by nothing. The
 * only way to know is to be told, so `doctor` tells you.
 *
 * FOUR ROWS, each answering a question somebody actually asks:
 *   · how much of my policy is enforced, and by what;
 *   · what is my agents' resident block costing on every turn;
 *   · are the generated files current, or is my policy saying something my agents have not been told;
 *   · did anything stop being verifiable — a cue whose clause moved on without it.
 *
 * Pure over the compile result, so the rows are tested without a repository.
 */
import type { MappedClause, EnforcementClass } from "../rules/rules-build.js";
import type { Diagnostic } from "../rules/notation.js";

export interface RulesRow {
  readonly name: string;
  readonly status: "ok" | "warn" | "fail";
  readonly detail: string;
}

/** What doctor needs to know about the rules. Absent ⇒ no rows, per doctor's own rule. */
export interface RulesFacts {
  readonly map: readonly MappedClause[];
  readonly diagnostics: readonly Diagnostic[];
  /** Generated files whose bytes differ from what the policies now produce. */
  readonly stale: readonly string[];
  /** Characters in the resident block — the cue text every agent carries on every turn. */
  readonly residentChars: number;
  /** The budget, in tokens, from the design: a forcing function, not a physical limit. */
  readonly residentBudgetTokens?: number;
}

const count = (map: readonly MappedClause[], k: EnforcementClass): number => map.filter((m) => m.klass === k).length;

/**
 * Tokens from characters, at four characters each.
 *
 * Deliberately approximate and deliberately NOT a tokenizer: the number is there to be watched for growth, and a
 * figure accurate to the nearest few per cent answers that as well as an exact one would. Shipping a tokenizer to
 * make a budget line prettier would be the sort of dependency this CLI does not take.
 */
export const approxTokens = (chars: number): number => Math.round(chars / 4);

export function rulesRows(facts: RulesFacts | undefined): readonly RulesRow[] {
  if (!facts) return [];
  const rows: RulesRow[] = [];
  const governed = facts.map.filter((m) => m.level).length;
  const checked = count(facts.map, "checked");
  const cued = count(facts.map, "cued");
  const implemented = count(facts.map, "implemented");
  const advisory = count(facts.map, "advisory");

  // ── how much of it is enforced ──────────────────────────────────────────────────────────────────────────────
  //
  // A WARNING WHEN MOST RULES ARE ADVISORY, because that is the finding, not an incidental. It is not a fault to
  // be fixed by a flag: it means the policy is asking people and agents to remember things, and the honest
  // response is either a check, a cue, or striking the clause. `ok` would read as "nothing to see here".
  rows.push({
    name: "rules",
    status: governed === 0 ? "warn" : advisory > governed / 2 ? "warn" : "ok",
    detail: governed === 0
      ? "no clause in your policies states a rule — a modal verb (MUST · MAY · CAN) is what makes one"
      : `${governed} rules: ${checked} checked · ${cued} cued · ${implemented} implemented · ${advisory} advisory`
        + (advisory > governed / 2 ? ` — ${advisory} of ${governed} are enforced by nothing` : ""),
  });

  // ── what the resident block costs ────────────────────────────────────────────────────────────────────────────
  const tokens = approxTokens(facts.residentChars);
  const budget = facts.residentBudgetTokens ?? 2000;
  rows.push({
    name: "resident rules",
    status: tokens > budget ? "warn" : "ok",
    detail: `~${tokens} tokens in every agent's context, every turn (budget ${budget})`
      + (tokens > budget ? " — something that belongs in the policy may have been put in a cue" : ""),
  });

  // ── are the agents being told what the policy now says ──────────────────────────────────────────────────────
  //
  // FAIL, not warn. A stale generated file means the policy on disk and the rules an agent carries disagree, and
  // the agent is the one acting. Everything else in this report is about a machine being ready; this is about
  // governance being true.
  if (facts.stale.length) {
    rows.push({
      name: "rules build",
      status: "fail",
      detail: `${facts.stale.length} generated file(s) stale — run \`gov rules build\`: ${facts.stale.slice(0, 3).join(", ")}`
        + (facts.stale.length > 3 ? `, and ${facts.stale.length - 3} more` : ""),
    });
  } else {
    rows.push({ name: "rules build", status: "ok", detail: "every generated file matches the policies" });
  }

  // ── did anything stop being verifiable ──────────────────────────────────────────────────────────────────────
  const errors = facts.diagnostics.filter((d) => d.kind !== "actor-unnamed");
  const stale = errors.filter((d) => d.kind === "stale-cue");
  const unnamed = facts.diagnostics.length - errors.length;
  if (stale.length) {
    rows.push({
      name: "cues",
      status: "fail",
      detail: `${stale.length} cue(s) no longer match the clause they were approved against — an agent is being `
        + "told the old text. Re-draft and approve, or `gov rules build --restamp` if the wording still holds",
    });
  }
  if (errors.length - stale.length > 0) {
    rows.push({
      name: "notation",
      status: "fail",
      detail: `${errors.length - stale.length} error(s) in your policies — run \`gov rules report\` for each one`,
    });
  }
  if (unnamed) {
    rows.push({
      name: "clause actors",
      status: "warn",
      detail: `${unnamed} rule(s) name no actor, so gov cannot tell whether each is about gov, an agent or a `
        + "person — and `implemented` under-reports until they do (rule 7)",
    });
  }
  return rows;
}
