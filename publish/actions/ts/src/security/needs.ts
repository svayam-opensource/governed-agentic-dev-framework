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

export const ghAuthNeed: Need = {
  id: "gh-auth",
  title: "GitHub CLI authentication",
  instructions: "Authenticate the GitHub CLI in a terminal:\n  gh auth login",
  satisfied: (p) => p.ghAuthOk(),
};

// ── registry publish token — contributed by the deploy path per resolved target ──
export type RegistryScheme = "oidc" | "token";
/** The credential-store key a registry's publish token lives under. */
export const registryCredKey = (registry: string): string => `npm_token:${registry}`;

/** A NEED for a publish token to `registry`; `scheme` shapes the acquisition instructions. */
export function registryTokenNeed(registry: string, scheme: RegistryScheme): Need {
  const key = registryCredKey(registry);
  return {
    id: key,
    title: `publish token for ${registry}`,
    credKey: key,
    instructions: scheme === "oidc"
      ? `${registry} is OIDC-fronted. In your IdP (Authentik), authenticate and copy an access\n` +
        `token for the registry audience, then paste it here. Do NOT run \`npm login\` — the\n` +
        `front wants a bearer token, not a registry account.`
      : `Create a publish/automation token for ${registry}\n` +
        `  (e.g. npmjs.com → Account → Access Tokens → Generate New Token → Automation),\n` +
        `then paste it here.`,
    satisfied: (p) => p.hasCred(key),
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
