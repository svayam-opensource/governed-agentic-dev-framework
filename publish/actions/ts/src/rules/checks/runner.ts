// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov check run <GOV-ID>` — THE ONE ENTRY POINT EVERY RENDERED BINDING CALLS (rule-model-design.md Q14; W6).
 *
 * Given a rule id and the event that fired, find the rule's IN-FORCE row in the injected {@link RuleSet} (both
 * stores, as the DEFAULT branch has them — the caller loads them, never from the branch under review), run each of
 * its bindings whose resource and event match, and combine the outcomes.
 *
 * NOTHING HERE PASSES BY DEFAULT. An unknown id, an unloadable rule set, a rule with no binding on this event, an
 * action the catalog lacks, parameters that do not fit the action, a tool this slice cannot run, an LLM judge —
 * each is `cannot-tell`, with a finding that says which. The verdict order is fail > cannot-tell > pass: one real
 * failure is a failure whatever else could not run, and one check that could not run stops the rule reading as
 * passed.
 *
 * `on_miss: warn` reports the miss as a finding (prefixed `warn:`) and does not fail.
 */
import { inForce } from "../model/rule-row.js";
import type { CheckRunner, CheckVerdict, EventContext, RuleSet } from "../model/contracts.js";
import type { ReadDoc } from "../diff-check.js";
import { runBuiltin } from "./builtin.js";
import { validateParams } from "./params.js";

export interface CheckRunnerDeps {
  /** Both stores and the merged catalog from the DEFAULT branch; null = could not be read (never "no rules"). */
  readonly rules: RuleSet | null;
  /** A document from the DEFAULT branch (what `list=` points at), or null. */
  readonly readDefault: ReadDoc;
}

type Outcome = "pass" | "fail" | "cannot-tell";
const RANK: Record<Outcome, number> = { pass: 0, "cannot-tell": 1, fail: 2 };

export function createCheckRunner(deps: CheckRunnerDeps): CheckRunner {
  return {
    run(id: string, ctx: EventContext): CheckVerdict {
      const cannot = (finding: string): CheckVerdict => ({ verdict: "cannot-tell", findings: [finding] });
      const rules = deps.rules;
      if (!rules) return cannot(`${id}: the rule stores could not be read from the default branch, so nothing was checked.`);

      const row = inForce([...rules.framework, ...rules.org]).find((r) => r.id === id);
      if (!row) return cannot(`${id}: no rule in force has this id, so nothing was checked.`);

      const bindings = (row.checks ?? []).filter((b) => b.on.resource === ctx.resource && b.on.event === ctx.event);
      if (!bindings.length) return cannot(`${id}: binds no check on ${ctx.resource} · ${ctx.event}, so nothing was checked.`);

      let verdict: Outcome = "pass";
      const findings: string[] = [];
      const fold = (o: Outcome, f: readonly string[]) => {
        if (RANK[o] > RANK[verdict]) verdict = o;
        findings.push(...f);
      };

      for (const b of bindings) {
        const tag = `${id} [${b.action}]`;
        const action = rules.catalog.actions.find((a) => a.id === b.action);
        if (!action) { fold("cannot-tell", [`${tag}: the catalog has no such action, so nothing was checked.`]); continue; }
        if (action.tool === "llm") {
          // Q22: an LLM verdict never blocks — and in this slice it never runs, so it is never a pass either.
          fold("cannot-tell", [`${tag}: LLM judge not implemented, so nothing was checked.`]);
          continue;
        }
        if (action.tool !== "gov-builtin") {
          fold("cannot-tell", [`${tag}: running a ${action.tool} action is not implemented yet, so nothing was checked.`]);
          continue;
        }
        const bad = validateParams(action.params, b.with);
        if (bad.length) { fold("cannot-tell", bad.map((m) => `${tag}: ${m}, so nothing was checked.`)); continue; }

        const out = runBuiltin({ ruleId: id, action: b.action, params: b.with ?? {}, ctx, readDefault: deps.readDefault });
        if (out.verdict === "miss") {
          if (b.on_miss === "fail") fold("fail", out.findings);
          else fold("pass", out.findings.map((f) => `warn: ${f}`));
          if (out.notes?.length) fold("cannot-tell", out.notes);
        } else {
          fold(out.verdict, out.findings);
        }
      }
      return { verdict, findings };
    },
  };
}
