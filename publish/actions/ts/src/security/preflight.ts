// SPDX-License-Identifier: MIT
/**
 * The PREFLIGHT — every command computes its NEED/GAP before it runs, and a non-empty GAP blocks with
 * the command that fixes it. On a healthy machine the GAP is empty and this is a silent no-op.
 *
 * It no longer points at `gov creds`: gov-work has no credential store, and its two NEEDs are satisfied
 * by the user's own tools. So each NEED carries its own instructions and the block prints those.
 */
import { type Need, type NeedProbes, computeGap } from "./needs.js";

export interface PreflightResult {
  readonly ok: boolean;
  readonly gap: readonly Need[];
}

/** Compute the GAP for a command's NEEDs against this machine's probes. */
export function preflight(needs: readonly Need[], probes: NeedProbes): PreflightResult {
  const gap = computeGap(needs, probes);
  return { ok: gap.length === 0, gap };
}

/** The block message shown when a command's GAP is non-empty. Each NEED says how to satisfy itself —
 *  a generic "run some other command" would be a lie now that no gov command fills these in. */
export function renderGap(gap: readonly Need[]): string[] {
  const lines = [`✗ ${gap.length} unmet requirement(s) for this command:`];
  for (const n of gap) {
    lines.push(`    • ${n.title}`);
    for (const l of n.instructions.split("\n")) lines.push(`        ${l}`);
  }
  lines.push("", "  Then re-run your command.");
  return lines;
}
