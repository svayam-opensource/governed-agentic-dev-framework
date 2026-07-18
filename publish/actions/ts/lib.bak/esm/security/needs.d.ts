/**
 * NEED / GAP — the security preflight model (SDD credential-seam). Every command declares
 * the identity + authorizations its ask requires (its NEEDs); the CLI probes what's already
 * satisfied on this machine and the unmet subset is the GAP, which `gov-work creds` then fills.
 *
 * This module is PURE: a `Need` states what it is, how to satisfy it (human instructions),
 * and a `satisfied(probes)` predicate. Probes are INJECTED (git/gh/credential-store lookups),
 * so the whole thing is testable without touching the environment. The real probe adapter
 * lives with the command layer.
 */
/** Injected environment lookups a NEED's `satisfied` predicate may consult. */
export interface NeedProbes {
    /** `git config <key>` (e.g. `user.email`), or undefined if unset. */
    readonly gitConfig: (key: string) => string | undefined;
    /** is the GitHub CLI authenticated (`gh auth status` ok)? */
    readonly ghAuthOk: () => boolean;
    /** does the active identity's credential store hold this key? */
    readonly hasCred: (key: string) => boolean;
}
/** One security requirement of a command's ask. */
export interface Need {
    /** stable id, e.g. `git-identity`, `npm_token:npm.svayamtech.com`. */
    readonly id: string;
    /** one-line human title shown in the NEED/GAP summary. */
    readonly title: string;
    /** short, plain name shown to the end user ("Provide '<label>' value"). Falls back to a
     *  de-jargoned `title` when unset. */
    readonly label?: string;
    /** where/how to obtain it — shown by `gov-work creds` when this is a GAP. */
    readonly instructions: string;
    /** ordered, plain "how to get this value" steps. When unset, derived from `instructions`. */
    readonly steps?: readonly string[];
    /** set when this NEED is satisfied by a value in the credential store (the key it lives under). */
    readonly credKey?: string;
    /** is it already satisfied on this machine? */
    readonly satisfied: (p: NeedProbes) => boolean;
}
/** The plain name shown to the end user — the explicit `label`, else the `title` with any
 *  parenthetical jargon (e.g. "(HMAC — …)") stripped. */
export declare function displayName(need: Pick<Need, "label" | "title">): string;
/** Turn a where/instructions blob into ordered, plain "how to get it" steps: one per line,
 *  expanding arrow-paths ("A → B → C") into separate steps and dropping list numbering and the
 *  paste boilerplate. Used when a NEED doesn't declare explicit `steps`. */
export declare function deriveSteps(need: Pick<Need, "steps" | "instructions">): string[];
export declare const gitIdentityNeed: Need;
/** A NEED for an explicitly-named credential key (`gov-work creds <KEY>`) — a generic, shielded
 *  paste prompt. (gov-work is a credential MANAGER; it doesn't know what any given key is for.) */
export declare function credNeedForKey(key: string): Need;
export declare const ghAuthNeed: Need;
/**
 * A NEED for a publish credential to `registry`, stored under `credKey` (the standard key,
 * supplied by the plugin). Instructions SHIELD the developer — where to go, what to do, and
 * paste; no auth-method jargon, no key names. `gov-work creds` saves the answer for them.
 */
export declare function registryTokenNeed(registry: string, credKey: string): Need;
/** Assemble a command's NEEDs: the base set plus any command/plugin-specific extras. */
export declare function assembleNeeds(extra?: readonly Need[]): Need[];
/** The GAP = the NEEDs not yet satisfied on this machine, in declared order. */
export declare function computeGap(need: readonly Need[], probes: NeedProbes): Need[];
