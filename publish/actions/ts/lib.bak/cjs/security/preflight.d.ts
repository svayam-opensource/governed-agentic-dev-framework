/**
 * The security PREFLIGHT — every command computes its NEED/GAP before it runs, and a
 * non-empty GAP blocks with a pointer to `gov-work creds` (SDD credential-seam). On a healthy
 * machine the GAP is empty and this is a silent no-op; it only fires when identity or
 * authorization is genuinely missing — surfacing the fix instead of a downstream error.
 */
import { type Need, type NeedProbes } from "./needs.js";
export interface PreflightResult {
    readonly ok: boolean;
    readonly gap: readonly Need[];
}
/** Compute the GAP for a command's NEEDs against this machine's probes. */
export declare function preflight(needs: readonly Need[], probes: NeedProbes): PreflightResult;
/** The block message shown when a command's GAP is non-empty — points at `gov-work creds`. */
export declare function renderGap(gap: readonly Need[]): string[];
