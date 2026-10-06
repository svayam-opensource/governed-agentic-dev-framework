// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE CHECKS gov RUNS IN-PROCESS — a gov verb about to act, or `gov validate` over a local changeset (P3 cutover,
 * 2026-10-06).
 *
 * A check bound to `gov.verb · close` is a GATE gov runs itself before acting (catalog: renderer `gov-verb`), and
 * `gov validate` previews the changeset predicates a pull request will meet. Both used to read inline `gov:check`
 * comments out of the policy prose; that notation is retired. Both now run the rule rows' bindings through the ONE
 * runner every rendered binding calls (`gov check run`), so a local gate and a CI gate cannot disagree about what a
 * rule means.
 *
 * The result is the verb gate's {@link GateResult}, unchanged, so `formatGate` / `formatDiffChecks` and the
 * callers' refusals read as before: a `fail` verdict is a failure; a `warn:` finding (on_miss: warn) and a
 * `cannot-tell` are warnings — a check that could not run is never silently a pass.
 *
 * Pure over the injected rule set and reader.
 */
import { inForce, type RuleRow } from "../model/rule-row.js";
import type { EventPayload, RuleSet } from "../model/contracts.js";
import type { ReadDoc } from "../diff-check.js";
import type { GateFinding, GateResult } from "../verb-gate.js";
import { createCheckRunner } from "./runner.js";

export interface BoundCheckOptions {
  /** Only bindings whose action passes this run (e.g. the changeset predicates for `gov validate`). */
  readonly action?: (action: string) => boolean;
}

/**
 * Run every in-force rule's bindings on `resource · event`. `rules` null means the stores could not be read —
 * reported as a warning, never as "no rules".
 */
export function runBoundChecks(
  rules: RuleSet | null,
  on: { readonly resource: string; readonly event: string },
  payload: EventPayload,
  readDefault: ReadDoc,
  opts: BoundCheckOptions = {},
): GateResult {
  if (!rules) {
    const w: GateFinding = { pol: "rules", doc: "framework/rules/rules.yaml", section: "", severity: "warn", message: `the rule stores could not be read, so no check on ${on.resource} · ${on.event} ran.` };
    return { ok: true, failures: [], warnings: [w] };
  }
  const keep = (r: RuleRow): RuleRow => ({
    ...r,
    checks: (r.checks ?? []).filter((b) => b.on.resource === on.resource && b.on.event === on.event && (!opts.action || opts.action(b.action))),
  });
  const narrowed: RuleSet = { ...rules, framework: inForce(rules.framework).map(keep), org: inForce(rules.org).map(keep) };
  const bound = [...narrowed.framework, ...narrowed.org].filter((r) => (r.checks ?? []).length > 0);
  if (!bound.length) return { ok: true, failures: [], warnings: [] };

  const runner = createCheckRunner({ rules: narrowed, readDefault });
  const failures: GateFinding[] = [];
  const warnings: GateFinding[] = [];
  for (const row of bound) {
    const v = runner.run(row.id, { resource: on.resource, event: on.event, payload });
    const at = { pol: row.id, doc: row.source.doc, section: row.source.section };
    for (const f of v.findings) {
      const warn = f.startsWith("warn: ");
      const message = warn ? f.slice("warn: ".length) : f;
      if (v.verdict === "fail" && !warn) failures.push({ ...at, severity: "fail", message });
      else warnings.push({ ...at, severity: "warn", message });
    }
  }
  return { ok: failures.length === 0, failures, warnings };
}
