// SPDX-License-Identifier: MIT
/**
 * NEED / GAP — the preflight model for gov-work's OWN two requirements: a git commit identity and an
 * authenticated `gh`. Both are the USER'S OWN TOOLS, not secrets gov stores.
 *
 * gov-work needs no identity provider and keeps no credential store (ADR: three clients, 2026-08-06).
 * Sessions, OIDC, stored credentials and the Vault client belong to the deploy path — gov-cicd and
 * gov-infra — so `credNeedForKey`, `registryTokenNeed` and the `hasCred` probe left with them. What
 * remains is a check that the user's own tooling is configured, which is why nothing here can be
 * "filled in" by gov: it points at `git config` and `gh auth login`.
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
}

/** One security requirement of a command's ask. */
export interface Need {
  /** stable id, e.g. `git-identity`, `npm_token:npm.svayamtech.com`. */
  readonly id: string;
  /** one-line human title shown in the NEED/GAP summary. */
  readonly title: string;
  /** how the USER satisfies it (their own tool) — printed verbatim when this is a GAP. */
  readonly instructions: string;
  /** is it already satisfied on this machine? */
  readonly satisfied: (p: NeedProbes) => boolean;
}

// ── base NEEDs — required by essentially every command ───────────────────────
export const gitIdentityNeed: Need = {
  id: "git-identity",
  title: "git commit identity (user.name + user.email)",
  instructions:
    "Set your commit identity (once, globally):\n" +
    "  git config --global user.name  \"Your Name\"\n" +
    "  git config --global user.email \"you@your-org\"",
  satisfied: (p) => !!p.gitConfig("user.name") && !!p.gitConfig("user.email"),
};

export const ghAuthNeed: Need = {
  id: "gh-auth",
  title: "GitHub CLI authentication",
  instructions: "Authenticate the GitHub CLI in a terminal:\n  gh auth login",
  satisfied: (p) => p.ghAuthOk(),
};

/** gov-work's NEEDs: git identity + gh auth. There is no "extra" any more — a plugin's credential
 *  requirements are that plugin's business now, not something gov-work collects on its behalf. */
export function assembleNeeds(): Need[] {
  return [gitIdentityNeed, ghAuthNeed];
}

/** The GAP = the NEEDs not yet satisfied on this machine, in declared order. */
export function computeGap(need: readonly Need[], probes: NeedProbes): Need[] {
  return need.filter((n) => !n.satisfied(probes));
}
