// SPDX-License-Identifier: MIT
/**
 * NEED / GAP — the credential preflight MODEL, and only the model.
 *
 * A command declares the identity and authorizations its ask requires (its NEEDs); the client probes what
 * this machine already satisfies; the unmet subset is the GAP, which the client's `creds` flow fills.
 *
 * Pure by construction: a `Need` states what it is, how a human satisfies it, and a `satisfied(probes)`
 * predicate. The probes are INJECTED, so none of this touches git, gh, or a credential store.
 *
 * WHAT IS DELIBERATELY NOT HERE: the concrete needs. `gitIdentityNeed`, `ghAuthNeed`, `registryTokenNeed`
 * and the assembly of a command's base set all name particular tools, registries and credential keys —
 * that is our grammar, and grammar stays in the client (ADR: three clients, decision 7). `gov-core` holds
 * the shape a need has and the arithmetic of a gap.
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
  /** stable id, e.g. `git-identity`, `npm_token:npm.example.com`. */
  readonly id: string;
  /** one-line human title shown in the NEED/GAP summary. */
  readonly title: string;
  /** where/how to obtain it — shown when this is a GAP. */
  readonly instructions: string;
  /** set when this NEED is satisfied by a value in the credential store (the key it lives under). */
  readonly credKey?: string;
  /** is it already satisfied on this machine? */
  readonly satisfied: (p: NeedProbes) => boolean;
}

/** The GAP = the NEEDs not yet satisfied on this machine, in declared order. */
export function computeGap(need: readonly Need[], probes: NeedProbes): Need[] {
  return need.filter((n) => !n.satisfied(probes));
}
