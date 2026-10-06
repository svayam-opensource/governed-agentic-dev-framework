// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE `gov-builtin/*` ACTIONS (rule-model-design.md Q13; W6).
 *
 * The seven predicates of the old `gov:check` become catalog actions behind ONE dispatch. The predicate logic is
 * NOT rewritten: a binding's `with:` is adapted into the old {@link Check} shape and handed to the evaluator that
 * already owns that logic and its fixtures — {@link runDiffChecks} over a changeset (a pull request, a push), or
 * {@link gateVerb} over a {@link WorkspaceView} (a gov verb). Two copies of "what list-membership means" would
 * drift; one cannot.
 *
 * MISS VS CANNOT-TELL. The old evaluators report both "the predicate did not hold" and "the check could not run"
 * (an unreadable list, a bad regex, no branch known) as findings, and with `on_miss=warn` the two are the same
 * shape. So every predicate is run here with `onMiss: "fail"`: a FAILURE is then always a real miss, and a WARNING
 * is always a check that could not run — which this slice reports as `cannot-tell`, never as a pass. The binding's
 * own `on_miss` is applied afterwards, by the runner.
 *
 * Which evaluator runs is decided by the event's PAYLOAD, not its resource name: `changed` (a changeset) or
 * `workspace` (a gov verb). A payload carrying neither is `cannot-tell`.
 *
 * Rules and the documents they cite (`list=`) come from the DEFAULT branch: `readDefault` is injected, and is the
 * only way a predicate reads a document.
 */
import { CHECK_KINDS, type Check, type CheckKind, type GateableVerb } from "../cue-block.js";
import { runDiffChecks, type ChangedFile, type ReadDoc } from "../diff-check.js";
import { gateVerb, type GateResult, type WorkspaceView } from "../verb-gate.js";
import type { EventContext, TestResult } from "../model/contracts.js";

/** The names after `gov-builtin/`. */
export const BUILTIN_ACTIONS: readonly string[] = [...CHECK_KINDS, "test-suite", "rules-propose"];

export interface BuiltinInput {
  /** The rule being checked — every finding names it. */
  readonly ruleId: string;
  /** `gov-builtin/<name>`. */
  readonly action: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly ctx: EventContext;
  /** A document from the DEFAULT branch, or null when unreadable. */
  readonly readDefault: ReadDoc;
}

/** `miss` = the predicate did not hold; the runner turns it into fail or warn by the binding's `on_miss`. */
export interface BuiltinOutcome {
  readonly verdict: "pass" | "miss" | "cannot-tell";
  readonly findings: readonly string[];
  /** On a `miss`: the parts of the check that could not run, kept apart so `on_miss: warn` cannot hide them. */
  readonly notes?: readonly string[];
}

/** One test result, as a test reporter gives it. */
export type { TestResult } from "../model/contracts.js";

const cannot = (findings: string[]): BuiltinOutcome => ({ verdict: "cannot-tell", findings });

/** A YAML list or a comma-separated string → the old attribute's comma form. */
const asAttr = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(",") : String(v));
const asList = (v: unknown): string[] =>
  v === undefined ? [] : (Array.isArray(v) ? v.map(String) : String(v).split(",")).map((s) => s.trim()).filter(Boolean);

export function runBuiltin(input: BuiltinInput): BuiltinOutcome {
  const { ruleId, action, ctx } = input;
  const name = action.startsWith("gov-builtin/") ? action.slice("gov-builtin/".length) : action;
  const tag = `${ruleId} [${action}]`;
  try {
    if ((CHECK_KINDS as readonly string[]).includes(name)) return predicate(name as CheckKind, input, tag);
    if (name === "test-suite") return testSuite(ruleId, ctx, tag);
    if (name === "rules-propose") return cannot([`${tag}: the proposer is not runnable as a check yet, so nothing was checked.`]);
    return cannot([`${tag}: no such gov-builtin action, so nothing was checked.`]);
  } catch (e) {
    // A predicate that throws (a bad regex at a verb, a malformed payload) checked nothing. Said, never fatal.
    return cannot([`${tag}: the check could not run (${e instanceof Error ? e.message : String(e)}), so nothing was checked.`]);
  }
}

function predicate(kind: CheckKind, input: BuiltinInput, tag: string): BuiltinOutcome {
  const { ruleId, action, params, ctx, readDefault } = input;
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (k !== "when" && v !== undefined) attrs[k] = asAttr(v);

  const changed = ctx.payload.changed;
  const workspace = ctx.payload.workspace as WorkspaceView | undefined;
  let result: GateResult;
  if (workspace && typeof workspace.paths === "function") {
    const check: Check = { kind, trigger: { on: "verb", verb: ctx.event as GateableVerb }, attrs, onMiss: "fail" };
    result = gateVerb([{ pol: ruleId, doc: action, section: ctx.event, check }], workspace);
  } else if (Array.isArray(changed)) {
    const globs = asList(params.when);
    const check: Check = { kind, trigger: { on: "files", globs: globs.length ? globs : ["**"] }, attrs, onMiss: "fail" };
    const branch = typeof ctx.payload.branch === "string" ? ctx.payload.branch : undefined;
    result = runDiffChecks([{ pol: ruleId, doc: action, section: ctx.event, check }], changed as ChangedFile[], readDefault, { branch });
  } else {
    return cannot([`${tag}: the ${ctx.resource} · ${ctx.event} event carried neither a changeset nor a workspace, so nothing was checked.`]);
  }

  // The old messages open with `<pol> (<doc> §<section>)`; here that is the rule and the action.
  const where = `${ruleId} (${action} §${ctx.event})`;
  const msg = (m: string): string => (m.startsWith(where) ? tag + m.slice(where.length) : `${tag}: ${m}`);
  const misses = result.failures.map((f) => msg(f.message));
  const notes = result.warnings.map((w) => msg(w.message));
  if (misses.length) return { verdict: "miss", findings: misses, notes };
  if (notes.length) return cannot(notes);
  return { verdict: "pass", findings: [] };
}

/**
 * A spec rule's check (P1 ruling): the suite carries at least one test titled with the GOV id, and none failed.
 * No tagged test is a MISS — a spec rule with no test is the thing the ruling fails the build for. No results at
 * all, or only pending ones, is `cannot-tell`: nothing ran.
 */
function testSuite(ruleId: string, ctx: EventContext, tag: string): BuiltinOutcome {
  const tests = ctx.payload.tests;
  if (!Array.isArray(tests)) return cannot([`${tag}: the event carried no test results, so nothing was checked.`]);
  const id = new RegExp(`(?<![A-Za-z0-9-])${ruleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`);
  const tagged = (tests as TestResult[]).filter((t) => typeof t?.title === "string" && id.test(t.title));
  if (!tagged.length) return { verdict: "miss", findings: [`${tag}: no test is titled with ${ruleId} — add one that fails if the rule is broken.`] };
  const failed = tagged.filter((t) => t.state === "failed");
  if (failed.length) return { verdict: "miss", findings: failed.map((t) => `${tag}: test failed: ${t.title}`) };
  if (!tagged.some((t) => t.state === "passed")) return cannot([`${tag}: every test titled with ${ruleId} is pending, so nothing was checked.`]);
  return { verdict: "pass", findings: [] };
}
