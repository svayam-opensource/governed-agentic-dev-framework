// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * FIRST RUN — from a bare machine to a registered org, in one command (PRJ-43 walkthrough, 2026-08-07).
 *
 * `gov` on a machine with no `org_registry` used to print *"no gov workspace resolved — run `gov setup` /
 * `gov org use`"*: two verbs taught at the moment of failure, and the work handed back. It now asks the one
 * question it actually needs — which governance repo? — and does the rest.
 *
 * ## The order, and why it is that order
 *
 * `gov_home` lives at `~/.<org_slug>/gov_repo`, and **`org_slug` is inside the repo being cloned**. So the
 * destination cannot be computed before the clone exists. Cloning to a temp location and then placing it is
 * not a workaround: the alternative is deriving a slug from the URL and letting `org-config.yaml` disagree
 * with the path it lives at — a second copy of a value, with nothing comparing them, which is the shape
 * behind most of this project's defects.
 *
 * ## Joining versus founding
 *
 * After the clone, exactly one question decides everything: **does it already have `org-config.yaml`?**
 *
 *   yes → JOINING. ~Everyone. The org's identity exists; a newcomer must never be prompted to author it,
 *         because those answers are committed to a repo the whole org reads.
 *   no  → FOUNDING. Once, by one person. This is what `setup` is, and the only path that reaches it.
 *
 * That conditional is why `setup` needs no refuse-on-exists guard: the flow never reaches it for a repo that
 * is already configured.
 *
 * ## With no terminal
 *
 * Print and exit. First run is a human act, once per machine (Policy Owner, 2026-08-07). The accepted
 * consequence is that a fresh CI runner cannot onboard itself; everything downstream IS non-interactive, so
 * if that ever bites, the fix is one flag rather than a redesign.
 */

import * as path from "node:path";

/** What the bootstrap must do next. Pure data — the caller performs it. */
export type BootstrapStep =
  /** nothing to do: an org is registered and active. */
  | { readonly kind: "ready"; readonly org: string }
  /** registered orgs exist but none is active — pick one (or `--org`). */
  | { readonly kind: "choose"; readonly orgs: readonly string[] }
  /** nothing registered: ask for the governance repo and clone it. */
  | { readonly kind: "clone" }
  /** no terminal, and something needs asking. */
  | { readonly kind: "blocked"; readonly reason: string };

export interface RegistryFacts {
  /** orgs already registered on this machine. */
  readonly orgs: readonly string[];
  /** the active org, if one is selected. */
  readonly active: string | null;
  /** is there a terminal to ask in? */
  readonly interactive: boolean;
}

/**
 * The rung the machine is on. Deliberately does NOT look at the filesystem or the network — the caller
 * supplies what it knows, so every branch is decidable in a test.
 */
export function nextStep(f: RegistryFacts): BootstrapStep {
  if (f.active && f.orgs.includes(f.active)) return { kind: "ready", org: f.active };
  if (f.orgs.length === 1) return { kind: "ready", org: f.orgs[0]! };   // one org, none active → it is the answer
  if (f.orgs.length > 1) {
    return f.interactive
      ? { kind: "choose", orgs: f.orgs }
      : { kind: "blocked", reason: `${f.orgs.length} organizations are registered and none is active (${f.orgs.join(", ")}) — choose one with \`gov org use <org>\`, or run \`gov\` in a terminal.` };
  }
  return f.interactive
    ? { kind: "clone" }
    : { kind: "blocked", reason: "no organization is registered on this machine yet — run `gov` in a terminal to set one up." };
}

/**
 * Where a freshly cloned governance repo belongs: `~/.<org_slug>/gov_repo`.
 *
 * The slug is read from the clone's own `org-config.yaml`, so a JOINER lands exactly where the org says,
 * not where a URL suggested. A FOUNDER has no config yet, so the caller passes the slug the setup questions
 * produced — same rule, later input.
 */
export function govHomeFor(homeDir: string, orgSlug: string, join: (...p: string[]) => string = path.join): string {
  return join(homeDir, `.${orgSlug}`, "gov_repo");
}

/** `git@github.com:Svayamtech/svm-prj-work.git` / `https://github.com/Svayamtech/svm-prj-work` → `svm-prj-work`. */
export function repoNameFromUrl(url: string): string | null {
  const m = /([^/:]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m?.[1] ?? null;
}

/** Is this a plausible clone URL? A typo'd answer should fail HERE, not inside git's output. */
export function looksLikeRepoUrl(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(t) && /[/:][^/:]+\/[^/:]+/.test(t);
}
