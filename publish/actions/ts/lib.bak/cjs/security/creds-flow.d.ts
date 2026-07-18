/**
 * `gov-work creds` — the interactive GAP-filler (SDD credential-seam, client half). It NEVER
 * acquires anything itself: for each unmet NEED it prints WHERE to go and WHAT to bring
 * back, takes what the user pastes, and PLACES it in the per-user store — the user does
 * the acquisition in the real tool (Authentik, npmjs, …).
 *
 * This is the PURE flow: prompt, probes, store-writer and print are all injected, so it's
 * fully testable. The readline + real git/gh/store wiring is a thin shell (cli/main.ts).
 */
import { type Need, type NeedProbes } from "./needs.js";
export interface CredsFlowDeps {
    readonly defaultIdentity: string;
    readonly needs: readonly Need[];
    /** prompt with an optional default; returns the (trimmed) answer or the default. */
    readonly prompt: (question: string, def?: string) => Promise<string>;
    readonly print: (line: string) => void;
    readonly listIdentities: () => string[];
    readonly identityExists: (identity: string) => boolean;
    /** probes bound to a given identity's store (so the GAP is per-identity). */
    readonly makeProbes: (identity: string) => NeedProbes;
    /** place a pasted value under the chosen identity (store is line-preserving). */
    readonly setCred: (identity: string, key: string, value: string) => void;
    /** is stdin a REAL interactive TTY? Secrets are only accepted when true — a piped /
     *  agent-driven session cannot provide a credential (it's the human's to enter). */
    readonly interactive: boolean;
}
export interface CredsFlowResult {
    readonly identity: string;
    /** stored-cred NEEDs filled this run (ids). */
    readonly filled: readonly string[];
    /** NEEDs still unmet after this run (ids) — e.g. environment fixes the user must run. */
    readonly stillMissing: readonly string[];
}
/**
 * Select the identity. The default is ALWAYS the logged-in user. If MULTIPLE personas are
 * already configured under the preferences dir, offer a numbered menu — Enter keeps the
 * default, a number picks an alternate persona, or a typed name selects/creates one.
 */
export declare function selectIdentity(d: CredsFlowDeps): Promise<{
    identity: string;
    isNew: boolean;
}>;
/** Run the full flow: pick identity, compute GAP, walk each unmet NEED, re-probe, report. */
export declare function runCreds(d: CredsFlowDeps): Promise<CredsFlowResult>;
