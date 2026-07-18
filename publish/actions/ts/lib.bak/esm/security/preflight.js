// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * The security PREFLIGHT — every command computes its NEED/GAP before it runs, and a
 * non-empty GAP blocks with a pointer to `gov-work creds` (SDD credential-seam). On a healthy
 * machine the GAP is empty and this is a silent no-op; it only fires when identity or
 * authorization is genuinely missing — surfacing the fix instead of a downstream error.
 */
import { computeGap } from "./needs.js";
/** Compute the GAP for a command's NEEDs against this machine's probes. */
export function preflight(needs, probes) {
    const gap = computeGap(needs, probes);
    return { ok: gap.length === 0, gap };
}
/** The block message shown when a command's GAP is non-empty — points at `gov-work creds`. */
export function renderGap(gap) {
    const lines = [`✗ ${gap.length} unmet security NEED(s) for this command:`];
    for (const n of gap)
        lines.push(`    • ${n.title}`);
    lines.push("", "  Resolve them with:  gov-work creds", "  then re-run your command.");
    return lines;
}
