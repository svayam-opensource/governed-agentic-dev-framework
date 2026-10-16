// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * RUN BUDGETS (spec 03 §3.3, Q11): per item a wall-clock ceiling; per run a ceiling on items and on change requests.
 * Set in `policies/governance.yaml` under `autorun:`; `--max-minutes` may LOWER the item ceiling, never raise it —
 * the organization's number is a ceiling, not a default.
 */
import yaml from "js-yaml";

export interface Budget { readonly itemMinutes: number; readonly runItems: number; readonly runCrs: number }
export const DEFAULT_BUDGET: Budget = { itemMinutes: 30, runItems: 10, runCrs: 10 };

const KEYS: Readonly<Record<keyof Budget, string>> = { itemMinutes: "item_minutes", runItems: "run_items", runCrs: "run_crs" };

export function readBudget(governanceText: string | null | undefined, flags: { maxMinutes?: number } = {}): { budget: Budget; problems: string[] } {
  const problems: string[] = [];
  const out: Record<keyof Budget, number> = { ...DEFAULT_BUDGET };
  let block: Record<string, unknown> = {};
  if (governanceText && governanceText.trim()) {
    try {
      const doc = yaml.load(governanceText) as Record<string, unknown> | null;
      const a = doc && typeof doc === "object" ? doc.autorun : undefined;
      if (a && typeof a === "object" && !Array.isArray(a)) block = a as Record<string, unknown>;
      else if (a !== undefined && a !== null) problems.push("autorun: should be a mapping — using the defaults");
    } catch {
      // Reported, not thrown: gov doctor names the YAML error itself; autorun runs on the defaults.
      problems.push("governance.yaml is not valid YAML — autorun uses the default budgets");
    }
  }
  for (const k of Object.keys(KEYS) as (keyof Budget)[]) {
    const v = block[KEYS[k]];
    if (v === undefined) continue;
    if (typeof v === "number" && Number.isInteger(v) && v > 0) out[k] = v;
    else problems.push(`autorun.${KEYS[k]}: '${String(v)}' is not a positive whole number — using ${out[k]}`);
  }
  if (flags.maxMinutes !== undefined) {
    if (flags.maxMinutes > 0 && flags.maxMinutes <= out.itemMinutes) out.itemMinutes = flags.maxMinutes;
    else problems.push(`--max-minutes ${flags.maxMinutes} is above the organization's ${out.itemMinutes} (or not positive) — using ${out.itemMinutes}`);
  }
  return { budget: out, problems };
}

/** Counts one run against its ceilings. */
export class RunBudget {
  private items = 0;
  private crs = 0;
  constructor(readonly budget: Budget) {}
  canStartItem(): boolean { return this.items < this.budget.runItems; }
  canOpenCr(): boolean { return this.crs < this.budget.runCrs; }
  itemStarted(): void { this.items++; }
  crOpened(): void { this.crs++; }
  /** Why the run stopped early, or null. */
  exhausted(): string | null {
    if (!this.canStartItem()) return `run budget reached: ${this.items} items (ceiling ${this.budget.runItems})`;
    if (!this.canOpenCr()) return `run budget reached: ${this.crs} change requests (ceiling ${this.budget.runCrs})`;
    return null;
  }
}
