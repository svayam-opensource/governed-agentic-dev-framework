// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ORG `gh-action` CHECK ACTIONS: CI ONLY (PRJ-121 intent 05, Item 8 part 2; Policy Owner ruling Q9, 2026-10-12).
 *
 * An organization's `gh-action/<name>` is a GitHub Action in `policies/actions/<name>/` (its own `action.yml`). gov
 * cannot run it in its own process, so the renderer (render-github.ts) emits a `uses:` step for it in the rule's job:
 *
 *   - its code is the DEFAULT branch's copy — the governance repo checked out apart (`.gov-actions`, or `.gov` in a
 *     code repo's job), never the checkout under review, so a pull request cannot run its own new action (Q8, Q13);
 *   - the step is `continue-on-error`, and its outcome is handed to `gov check run` in {@link GH_ACTION_OUTCOMES_ENV};
 *   - `gov check run` folds that outcome like any action's — success → pass, failure → a miss (`on_miss` applies),
 *     anything else → cannot-tell — so the job's conclusion IS the rule's verdict.
 *
 * Locally there is no step: `gov check run` says cannot-tell "runs in CI only".
 *
 * `gh-action/landed-by-pr` is the framework's own, implemented inside gov (gh-actions.ts): never rendered as a step.
 */
import type { CheckBinding } from "../model/catalog.js";
import type { BuiltinOutcome } from "./builtin.js";

/** The gh-action ids gov implements itself. Every other `gh-action/*` is an org action. */
export const FRAMEWORK_GH_ACTIONS: readonly string[] = ["gh-action/landed-by-pr"];

/** The env var the rendered job hands the steps' outcomes in: JSON, {@link ghActionKey} → outcome. */
export const GH_ACTION_OUTCOMES_ENV = "GOV_GH_ACTION_OUTCOMES";

export const isOrgGhAction = (action: string): boolean => action.startsWith("gh-action/") && !FRAMEWORK_GH_ACTIONS.includes(action);

/** `<name>` of `gh-action/<name>` — its folder under `policies/actions/`. */
export const ghActionName = (action: string): string => action.slice("gh-action/".length);

/** Keys sorted, at every depth: one `with:` always spells one way. */
const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
      : v;

/** One binding's step, as the renderer and the runner both name it: the action and its parameters. */
export const ghActionKey = (b: Pick<CheckBinding, "action" | "with">): string => `${b.action} ${JSON.stringify(stable(b.with ?? {}))}`;

/** The outcomes from the env, or undefined when absent or unreadable (then: not run by a step). */
export function parseGhActionOutcomes(text: string | undefined): Readonly<Record<string, string>> | undefined {
  if (!text) return undefined;
  try {
    const o = JSON.parse(text) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  } catch {
    return undefined; // unreadable: treated as "no step ran it" — cannot-tell, never a pass
  }
}

/** The verdict of one org gh-action binding, from its step's outcome. */
export function ghActionOutcome(tag: string, b: Pick<CheckBinding, "action" | "with">, outcomes: Readonly<Record<string, string>> | undefined): BuiltinOutcome {
  const o = outcomes?.[ghActionKey(b)];
  if (o === undefined) {
    return { verdict: "cannot-tell", findings: [`${tag}: a gh-action runs in CI only (a step of the rendered gov-checks workflow), so nothing was checked here. If this is CI, re-render the workflow with \`gov check install\`.`] };
  }
  if (o === "success") return { verdict: "pass", findings: [] };
  if (o === "failure") return { verdict: "miss", findings: [`${tag}: the action's step failed — its log, in this job, says why.`] };
  return { verdict: "cannot-tell", findings: [`${tag}: the action's step ended "${o || "unknown"}", so nothing was checked.`] };
}
