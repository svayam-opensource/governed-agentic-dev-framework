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
import { isPaidAction } from "../model/catalog.js";
import type { CheckRunner, CheckVerdict, EventContext, RuleSet } from "../model/contracts.js";
import type { ReadDoc } from "../diff-check.js";
import { runBuiltin, type BuiltinOutcome } from "./builtin.js";
import { landedByPr, type GithubPorts } from "./gh-actions.js";
import { validateParams } from "./params.js";
import { runOrgAction, ORG_TOOLS, type ActionExecutor } from "./executor.js";
import { ghActionOutcome, isOrgGhAction } from "./gh-org-actions.js";
import type { PolicyPrInput } from "../policy-pr/gate.js";

/** A verdict, plus the reviews a gate asks the workflow to request (section-owner-approval). */
/** Kept as an alias: requestReview is now on CheckVerdict itself (pinned 2026-10-06). */
export type RunVerdict = CheckVerdict;

export interface CheckRunnerDeps {
  /** Both stores and the merged catalog from the DEFAULT branch; null = could not be read (never "no rules"). */
  readonly rules: RuleSet | null;
  /** A document from the DEFAULT branch (what `list=` points at), or null. */
  readonly readDefault: ReadDoc;
  /** GitHub, for `gh-action/*` actions. Absent → those actions are `cannot-tell`. */
  readonly github?: GithubPorts;
  /**
   * `gov-builtin/policy-pr-gate` (W5): the gov repo's trees at the pull request's base and head, its number and its
   * date. Built by `gov check run` for the gov repo's pull_request; absent → that action is `cannot-tell`.
   */
  readonly policyPr?: PolicyPrInput;
  /** `gov-builtin/rules-propose`: the proposer's outcome on this pull request, run by the CLI beforehand. */
  readonly propose?: BuiltinOutcome;
  /**
   * Org `bash`/`python` actions (executor.ts): every file under a folder of the DEFAULT branch, the process runner,
   * the parent env the child's allow-list is taken from, and the checkout the action runs in. Any absent → those
   * actions are `cannot-tell`.
   */
  readonly listDefault?: (dir: string) => readonly string[] | null;
  readonly executor?: ActionExecutor;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly repoDir?: string;
  /**
   * Org `gh-action/*` actions (gh-org-actions.ts): each rendered step's outcome, by `ghActionKey`. Absent → they
   * run in CI only, and here are `cannot-tell`.
   */
  readonly ghActionOutcomes?: Readonly<Record<string, string>>;
  /**
   * PAID ACTIONS (spec 02 §5, X15): the paid module's outcomes, run by the CLI beforehand (they are async), keyed by
   * {@link paidKey}. A binding to a declared-paid action with no outcome here is `needs-subscription`. An
   * `observeOnly` outcome (the LLM judge, Q22) is shown and recorded but never moves the verdict.
   */
  readonly paidOutcomes?: ReadonlyMap<string, PaidOutcome>;
}

export interface PaidOutcome {
  readonly verdict: "pass" | "fail" | "cannot-tell";
  readonly findings: readonly string[];
  readonly observeOnly?: boolean;
}

/** The key of one rule's paid binding in {@link CheckRunnerDeps.paidOutcomes}. */
export const paidKey = (ruleId: string, action: string): string => `${ruleId}|${action}`;

type Outcome = "pass" | "fail" | "cannot-tell" | "needs-subscription";
// needs-subscription folds like cannot-tell (never a pass), and a real cannot-tell or fail outranks it (X15).
const RANK: Record<Outcome, number> = { pass: 0, "needs-subscription": 1, "cannot-tell": 2, fail: 3 };

export function createCheckRunner(deps: CheckRunnerDeps): CheckRunner & { run(id: string, ctx: EventContext): RunVerdict } {
  return {
    run(id: string, ctx: EventContext): RunVerdict {
      const cannot = (finding: string): CheckVerdict => ({ verdict: "cannot-tell", findings: [finding] });
      const rules = deps.rules;
      if (!rules) return cannot(`${id}: the rule stores could not be read from the default branch, so nothing was checked.`);

      const row = inForce([...rules.framework, ...rules.org]).find((r) => r.id === id);
      if (!row) return cannot(`${id}: no rule in force has this id, so nothing was checked.`);

      const bindings = (row.checks ?? []).filter((b) => b.on.resource === ctx.resource && b.on.event === ctx.event);
      if (!bindings.length) return cannot(`${id}: binds no check on ${ctx.resource} · ${ctx.event}, so nothing was checked.`);

      let verdict: Outcome = "pass";
      const findings: string[] = [];
      const review = new Set<string>();
      const per: { action: string; verdict: Outcome }[] = [];
      let current: Outcome = "pass";
      const fold = (o: Outcome, f: readonly string[]) => {
        if (RANK[o] > RANK[verdict]) verdict = o;
        if (RANK[o] > RANK[current]) current = o;
        findings.push(...f);
      };

      for (const [i, b] of bindings.entries()) {
        // Each binding's own outcome, closed when the next one starts (the loop body `continue`s freely).
        if (i > 0) per.push({ action: bindings[i - 1]!.action, verdict: current });
        current = "pass";
        const tag = `${id} [${b.action}]`;
        // The paid module's outcome first: its pack actions live in ITS catalogs, which open gov need not carry.
        const paid = deps.paidOutcomes?.get(paidKey(id, b.action));
        if (paid) {
          if (paid.observeOnly) fold("pass", paid.findings.map((f) => `observe-only: ${f}`));
          else fold(paid.verdict, paid.findings);
          continue;
        }
        const action = rules.catalog.actions.find((a) => a.id === b.action);
        if (!action) { fold("cannot-tell", [`${tag}: the catalog has no such action, so nothing was checked.`]); continue; }
        if (isPaidAction(action)) {
          fold("needs-subscription", [`${tag}: needs a subscription — this binding is recorded, not run (gov-check is not installed here).`]);
          continue;
        }
        if (action.tool === "llm") {
          // Q22: an LLM verdict never blocks — and in this slice it never runs, so it is never a pass either.
          fold("cannot-tell", [`${tag}: LLM judge not implemented, so nothing was checked.`]);
          continue;
        }
        const org = (ORG_TOOLS as readonly string[]).includes(action.tool);
        const orgGh = action.tool === "gh-action" && isOrgGhAction(b.action);
        const runnable = action.tool === "gov-builtin" || org || orgGh || b.action === "gh-action/landed-by-pr";
        if (!runnable) {
          fold("cannot-tell", [`${tag}: running a ${action.tool} action is not implemented yet, so nothing was checked.`]);
          continue;
        }
        const bad = validateParams(action.params, b.with);
        if (bad.length) { fold("cannot-tell", bad.map((m) => `${tag}: ${m}, so nothing was checked.`)); continue; }

        let out: BuiltinOutcome;
        if (action.tool === "gov-builtin") {
          out = runBuiltin({ ruleId: id, action: b.action, params: b.with ?? {}, ctx, readDefault: deps.readDefault, rules, ...(deps.policyPr ? { policyPr: deps.policyPr } : {}), ...(deps.propose ? { propose: deps.propose } : {}) });
        } else if (orgGh) {
          out = ghActionOutcome(tag, b, deps.ghActionOutcomes);
        } else if (org) {
          out = runOrgAction({
            ruleId: id, action, params: b.with ?? {}, ctx, readDefault: deps.readDefault,
            ...(deps.listDefault ? { listDefault: deps.listDefault } : {}), ...(deps.executor ? { executor: deps.executor } : {}),
            ...(deps.env ? { env: deps.env } : {}), ...(deps.repoDir !== undefined ? { repoDir: deps.repoDir } : {}),
          });
        } else if (!deps.github) {
          fold("cannot-tell", [`${tag}: GitHub is not reachable from here, so nothing was checked.`]);
          continue;
        } else {
          out = landedByPr({ ruleId: id, params: b.with ?? {}, ctx }, deps.github);
        }
        for (const h of out.requestReview ?? []) review.add(h);
        if (out.verdict === "miss") {
          if (b.on_miss === "fail") fold("fail", out.findings);
          else fold("pass", out.findings.map((f) => `warn: ${f}`));
          if (out.notes?.length) fold("cannot-tell", out.notes);
        } else {
          fold(out.verdict, out.findings);
        }
      }
      per.push({ action: bindings[bindings.length - 1]!.action, verdict: current });
      return review.size ? { verdict, findings, bindings: per, requestReview: [...review].sort() } : { verdict, findings, bindings: per };
    },
  };
}
