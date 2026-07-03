// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Types for `prjResolveGov` — the deterministic governance-home resolver
 * (SDD-013 / SDD-040) and the CLI-local multi-home registry (SDD-041 / SDD-042).
 *
 * The resolver is a PURE function over a small `ResolveEnv` port so it is unit
 * testable without touching the real filesystem (dependency inversion). The real
 * fs/cwd-backed adapter is a separate concern (node-env).
 */

/** One entry in the multi-home registry: a GitHub org → its gov-repo home path. */
export interface GovHome {
  readonly org: string;
  readonly home: string;
}

/** A read of the CLI-local registry (`${XDG_CONFIG_HOME:-~/.config}/prj/*`). */
export interface RegistrySnapshot {
  /** Homes from `gov-workspaces` (`<org>\t<home>` per line). */
  readonly homes: readonly GovHome[];
  /** The `active-org` selection, if any. */
  readonly activeOrg: string | null;
  /** The legacy single-path `gov-workspace` pointer, migrated once (SDD-041). */
  readonly legacyPointer: string | null;
}

/**
 * The outside world the resolver depends on. All methods are deterministic and
 * side-effect-free except `writeRegistry` (self-heal + legacy migration).
 */
export interface ResolveEnv {
  /** The current working directory (absolute). */
  readonly cwd: string;
  /** Parent of `path`, or null at the filesystem root. */
  parentOf(path: string): string | null;
  /**
   * If `path` is a gov repo — it has an `org-config.yaml` with a non-empty
   * `github_org`, and is NOT inside a `.bases/` base clone — return that
   * `github_org`; otherwise null.
   */
  govOrgAt(path: string): string | null;
  /** Read the CLI-local registry. */
  readRegistry(): RegistrySnapshot;
  /** Persist homes (self-heal a discovered home; migrate the legacy pointer). */
  writeHomes(homes: readonly GovHome[]): void;
}

/** How a successful resolution was reached (for diagnostics / tests). */
export type ResolveVia = "cwd-walk" | "active-org" | "single-home";

/**
 * Result of `prjResolveGov`. Exit codes mirror the bash CLI: rc=2 = ambiguous
 * (needs `prj org use <org>` or `cd` into a workspace), rc=1 = nothing resolved.
 */
export type ResolveResult =
  | { readonly ok: true; readonly home: string; readonly org: string; readonly via: ResolveVia }
  | { readonly ok: false; readonly code: 2; readonly reason: "ambiguous"; readonly candidates: readonly GovHome[] }
  | { readonly ok: false; readonly code: 1; readonly reason: "none" };
