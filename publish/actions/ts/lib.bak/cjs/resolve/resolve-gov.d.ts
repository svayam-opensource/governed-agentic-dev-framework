/**
 * `prjResolveGov` — the deterministic governance-home resolver (SDD-013 / SDD-040).
 *
 * active-org is the anchor; cwd-walk is a cross-check (see types.ts for the full
 * decision table). The function is PURE — it only reads through `ResolveEnv` and
 * never writes, so resolution cannot pollute the registry.
 */
import type { ResolveEnv, ResolveResult } from "./types.js";
export declare function prjResolveGov(env: ResolveEnv): ResolveResult;
/** Render a resolution failure as an actionable one-line CLI message. */
export declare function resolveFailureMessage(r: Extract<ResolveResult, {
    ok: false;
}>): string;
