// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * NEED / GAP — the security preflight model (SDD credential-seam). Every command declares
 * the identity + authorizations its ask requires (its NEEDs); the CLI probes what's already
 * satisfied on this machine and the unmet subset is the GAP, which `gov creds` then fills.
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
  /** where/how to obtain it — shown by `gov creds` when this is a GAP. */
  readonly instructions: string;
  /** set when this NEED is satisfied by a value in the credential store (the key it lives under). */
  readonly credKey?: string;
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

/** The gov-operate LICENSE — a credential like any other: stored under SVAYAM_GOV_LICENSE and
 *  materialized to GOV_LICENSE at runtime. Needed by every enterprise (plugin) command. */
export const licenseNeed: Need = {
  id: "SVAYAM_GOV_LICENSE",
  title: "your gov-operate license",
  credKey: "SVAYAM_GOV_LICENSE",
  instructions:
    "You need a gov-operate license (a one-time key).\n" +
    "  1. Get it from your Svayam licensing / policy owner.\n" +
    "  2. Paste it below — gov saves it for you.",
  satisfied: (p) => p.hasCred("SVAYAM_GOV_LICENSE"),
};

/** A NEED for an explicitly-named credential key (`gov creds <KEY>`). Known keys get their
 *  tailored instructions; anything else gets a generic paste prompt (still shielded). */
export function credNeedForKey(key: string): Need {
  if (key === licenseNeed.credKey) return licenseNeed;
  return {
    id: key,
    title: `credential ${key}`,
    credKey: key,
    instructions:
      `Provide the value for ${key} (get it from the relevant tool/provider).\n` +
      `  Paste it below — gov saves it for you.`,
    satisfied: (p) => p.hasCred(key),
  };
}

export const ghAuthNeed: Need = {
  id: "gh-auth",
  title: "GitHub CLI authentication",
  instructions: "Authenticate the GitHub CLI in a terminal:\n  gh auth login",
  satisfied: (p) => p.ghAuthOk(),
};

// ── registry publish token — contributed by the deploy path per resolved target ──
/**
 * A NEED for a publish credential to `registry`, stored under `credKey` (the standard key,
 * supplied by the plugin). Instructions SHIELD the developer — where to go, what to do, and
 * paste; no auth-method jargon, no key names. `gov creds` saves the answer for them.
 */
export function registryTokenNeed(registry: string, credKey: string): Need {
  const where = registry === "https://registry.npmjs.org"
    ? "npmjs.com → Account → Access Tokens → Generate a new Automation token"
    : `your registry's token page for ${registry} (ask your admin if you're unsure where)`;
  return {
    id: credKey,
    title: `a publish credential for ${registry}`,
    credKey,
    instructions:
      `You need a publish token for ${registry}.\n` +
      `  1. Get one here:  ${where}\n` +
      `  2. Paste it below — gov saves it for you; there's nothing else to set up.`,
    satisfied: (p) => p.hasCred(credKey),
  };
}

/** Assemble a command's NEEDs: the base set plus any command/plugin-specific extras. */
export function assembleNeeds(extra: readonly Need[] = []): Need[] {
  return [gitIdentityNeed, ghAuthNeed, ...extra];
}

/** The GAP = the NEEDs not yet satisfied on this machine, in declared order. */
export function computeGap(need: readonly Need[], probes: NeedProbes): Need[] {
  return need.filter((n) => !n.satisfied(probes));
}
