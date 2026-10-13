// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov autorun` — ONE RUN of the lifecycle engine (spec 03 §3, I03.1):
 *
 *   lock project ─► read items ─► classify each ─► for each item whose gate PASSED: run its one prep step
 *   report every item (stage, whom it waits on) ─► record the run ─► unlock
 *
 * The prep steps (draft an artifact with a headless agent, create the plan's task issues, build a task) are
 * INJECTED as `step` — this module is the orchestration and its stop rules, nothing vendor-shaped:
 *   - a C01 event halts the WHOLE run: nothing further runs, non-zero exit (§3.3, Q10)
 *   - any other failure stops that item only; the rest continue
 *   - run budget: items started and CRs opened (Q11); serial
 *   - never merges, closes or sends — `classify` yields only prep steps (§3.4)
 */
import { classify, type Classification, type ItemFacts } from "./classify.js";
import { acquireLock, releaseLock, type LockFs } from "./lock.js";
import { RunBudget, type Budget } from "./budget.js";
import { reportLine, type ItemResult } from "./report.js";
import { recordPath, recordStamp } from "./record.js";

export type StepOutcome =
  | { readonly kind: "ok"; readonly cr?: string; readonly detail?: string }
  | { readonly kind: "c01"; readonly id: string; readonly detail: string }
  | { readonly kind: "failed"; readonly detail: string };

export interface AutorunDeps {
  readonly project: string;
  /** Is there a lifecycle in policies/active/? None → autorun says so and does nothing (spec 03 §2.1). */
  readonly lifecycleActive: boolean;
  readonly items: () => Promise<ItemFacts[]>;
  /** Run one prep step for one item (with the per-item wall-clock budget). */
  readonly step: (c: Classification, budget: Budget) => Promise<StepOutcome>;
  readonly lockFs: LockFs;
  readonly stateDir: string;
  readonly now: () => Date;
  readonly runId: string;
  readonly budget: Budget;
  /** Commit the run record and the decisions line (Q12). */
  readonly record: (path: string, text: string, decisionsLine: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface AutorunOptions { readonly intent?: string; readonly dryRun?: boolean }

export async function runAutorun(d: AutorunDeps, o: AutorunOptions): Promise<{ code: number; lines: string[] }> {
  if (!d.lifecycleActive) {
    return { code: 0, lines: ["no lifecycle is adopted (policies/active/ai-sdlc-lifecycle.md) — autorun does nothing."] };
  }
  const started = d.now();
  const lock = acquireLock(d.lockFs, d.stateDir, d.project, d.runId, started, d.budget.itemMinutes * d.budget.runItems * 60_000);
  if (!lock.ok) return { code: 1, lines: [lock.message] };
  try {
    const all = await d.items();
    const wanted = o.intent ? all.filter((i) => i.id.startsWith(`${o.intent!.padStart(2, "0")}-`) || i.id === o.intent) : all;
    const budget = new RunBudget(d.budget);
    const lines: string[] = [`autorun ${d.runId} · ${d.project}${o.dryRun ? " · dry run" : ""}`];
    const results: [Classification, ItemResult][] = [];
    let halted: string | null = null, advanced = 0, failed = 0;

    for (const f of wanted) {
      const c = classify(f);
      if (!c.next) { results.push([c, { kind: "waiting" }]); continue; }
      if (halted) { results.push([c, { kind: "not-started", why: "the run halted on a C01 event" }]); continue; }
      if (o.dryRun) { results.push([c, { kind: "would", step: c.next }]); continue; }
      const out = budget.exhausted();
      if (out) { results.push([c, { kind: "not-started", why: out }]); continue; }
      budget.itemStarted();
      const r = await d.step(c, d.budget);
      if (r.kind === "c01") { halted = `${r.id} — ${r.detail}`; results.push([c, { kind: "halted", detail: halted }]); continue; }
      if (r.kind === "failed") { failed++; results.push([c, { kind: "failed", detail: r.detail }]); continue; }
      advanced++;
      if (r.cr) budget.crOpened();
      results.push([c, { kind: "advanced", detail: r.cr ?? r.detail ?? "" }]);
    }

    for (const [c, r] of results) lines.push(`  ${reportLine(c, r)}`);
    if (!results.length) lines.push("  nothing found to run on.");
    if (halted) lines.push(`HALT: a C01 event stopped the run (${halted}). Nothing was committed for that item.`);

    if (!o.dryRun) {
      const day = started.toISOString().slice(0, 10);
      const text = [
        `# autorun ${recordStamp(started)}`,
        "",
        `Gov-Autorun: ${d.runId}`,
        `Project: ${d.project}`,
        "",
        ...results.map(([c, r]) => `- ${reportLine(c, r)}`),
        ...(halted ? ["", `HALT (C01): ${halted}`] : []),
        "",
      ].join("\n");
      const decision = `- ${day} autorun ${d.runId}: ${advanced} advanced, ${failed} failed${halted ? ", HALTED (C01)" : ""} — ${recordPath(d.project, started)}`;
      const rec = await d.record(recordPath(d.project, started), text, decision);
      lines.push(rec.ok ? `recorded: ${recordPath(d.project, started)}` : `✗ the run record could not be committed: ${rec.reason}`);
      if (!rec.ok) failed++;
    }
    return { code: halted ? 2 : failed ? 1 : 0, lines };
  } finally {
    releaseLock(d.lockFs, d.stateDir, d.project, d.runId);
  }
}
