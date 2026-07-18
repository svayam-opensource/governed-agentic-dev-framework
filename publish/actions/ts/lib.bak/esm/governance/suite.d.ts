/**
 * The assembled validation suite (SDD-032) — the concrete validator set behind
 * `gov-work validate` and the close test-merge gate. `runSuite` returns a shape
 * compatible with close's injected `gate` ({ ok, failures }), so the dispatcher
 * can wire it in directly: `close({ …, gate: () => runSuite(ctx) }, …)`.
 */
import { type Validator, type ValidateContext } from "./validate.js";
/**
 * The core test-merge validators. `privacy` is publish-branch-only (it needs
 * main's org-config values) so it is added separately by the publish gate, not
 * here.
 */
export declare const CORE_VALIDATORS: readonly Validator[];
/** Run the suite; returns `{ ok, failures }` (close-gate compatible). */
export declare function runSuite(ctx: ValidateContext, validators?: readonly Validator[]): {
    readonly ok: boolean;
    readonly failures: readonly string[];
};
