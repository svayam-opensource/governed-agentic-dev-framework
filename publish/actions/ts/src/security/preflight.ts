// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * The security PREFLIGHT — every command computes its NEED/GAP before it runs, and a
 * non-empty GAP blocks with a pointer to `gov creds` (SDD credential-seam). On a healthy
 * machine the GAP is empty and this is a silent no-op; it only fires when identity or
 * authorization is genuinely missing — surfacing the fix instead of a downstream error.
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

/** The block message shown when a command's GAP is non-empty — points at `gov creds`. */
export function renderGap(gap: readonly Need[]): string[] {
  const lines = [`✗ ${gap.length} unmet security NEED(s) for this command:`];
  for (const n of gap) lines.push(`    • ${n.title}`);
  lines.push("", "  Resolve them with:  gov creds", "  then re-run your command.");
  return lines;
}
