// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Types for `prjResolveGov` — the deterministic governance-home resolver
 * (SDD-013 / SDD-040) and the CLI-local multi-home registry (SDD-041 / SDD-042).
 *
 * Resolution model (active-org is the anchor; cwd-walk is a cross-check):
 *   O1 = active-org      — the developer's declared current org (mandatory)
 *   O2 = cwd-walk org    — the org whose workspace cwd sits in, or none
 *
 *   O1 unset                → hardstop (choose an org)                 [rule a]
 *   O2 present and O2 ≠ O1   → hardstop (conflict — pick the org)
 *   O2 == O1                → resolve to the cwd workspace
 *   O2 == none              → resolve to O1's registry home, double-checked [rule b]
 *   O1 set but no home       → hardstop (register a home)
 *
 * The resolver is PURE and SIDE-EFFECT-FREE — it only reads. The registry is
 * populated by `gov org add` / setup, never by resolution (no self-heal), so a
 * transient project-clone path can never pollute it.
 */

/** One entry in the multi-home registry: a GitHub org → its gov-repo home path. */
export interface GovHome {
  readonly org: string;
  readonly home: string;
}

/** The fields the resolver reads from a directory's `org-config.yaml`. */
export interface GovConfig {
  /** `github_org` — the org this gov repo belongs to. */
  readonly org: string;
  /** `gov_workspace` — the canonical home path this config records, expanded to
   *  an absolute path; null if the field is absent. */
  readonly govWorkspace: string | null;
}

/**
 * The outside world the resolver depends on — all READ-ONLY. Path/filesystem
 * mechanics (fs, realpath, `~` expansion, `.bases` skipping) live in the adapter
 * (node-env); the resolver stays pure over this port.
 */
export interface ResolveEnv {
  /** The current working directory (absolute). */
  readonly cwd: string;
  /** Parent of `path`, or null at the filesystem root. */
  parentOf(path: string): string | null;
  /**
   * If `path` is a gov repo — it has an `org-config.yaml` with a non-empty
   * `github_org`, and is NOT inside a `.bases/` base clone — return its config;
   * otherwise null.
   */
  govConfigAt(path: string): GovConfig | null;
  /** The `active-org` selection (`~/.config/prj/active-org`), or null if unset. */
  readActiveOrg(): string | null;
  /** The registry home for `org` (`gov-workspaces`), or null if unregistered. */
  homeForOrg(org: string): string | null;
  /** True if two home paths denote the same directory (realpath/`~`-aware). */
  sameHome(a: string, b: string): boolean;
}

/** How a successful resolution was reached. */
export type ResolveVia = "cwd" | "active-org";

/** Why a registry-home double-check (rule b) failed. */
export interface HomeCheckFailure {
  readonly why: "not-a-gov-repo" | "org-mismatch" | "not-canonical";
  /** The conflicting value found (the actual org, or the actual gov_workspace). */
  readonly found?: string;
}

/**
 * Result of `prjResolveGov`. Every failure is rc=2 — a hardstop asking the
 * developer to choose/set/register an org (never a silent guess).
 */
export type ResolveResult =
  | { readonly ok: true; readonly home: string; readonly org: string; readonly via: ResolveVia }
  | { readonly ok: false; readonly code: 2; readonly reason: "no-active-org" }
  /** contract R4 — a PROJECT operation run outside any project workspace. Never falls back to the mirror. */
  | { readonly ok: false; readonly code: 2; readonly reason: "not-in-a-project"; readonly activeOrg: string }
  | {
      readonly ok: false;
      readonly code: 2;
      readonly reason: "org-conflict";
      readonly cwdOrg: string;
      readonly activeOrg: string;
    }
  | { readonly ok: false; readonly code: 2; readonly reason: "no-home"; readonly activeOrg: string }
  | {
      readonly ok: false;
      readonly code: 2;
      readonly reason: "pointer-mismatch";
      readonly home: string;
      readonly activeOrg: string;
      readonly detail: HomeCheckFailure;
    };
