// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `prjResolveGov` — the deterministic governance-home resolver (SDD-013 / SDD-040).
 *
 * Ordered strategy (first match wins):
 *   1. cwd-walk  — nearest ancestor of cwd that is a gov repo (`org-config.yaml`
 *                  with a `github_org`, skipping `.bases/*`). Self-heals the
 *                  discovered {org, home} into the registry.
 *   2. active-org — the `active-org` selection, if it maps to a registered home.
 *   3. single    — exactly one home registered.
 *   4. ambiguous — rc=2 (`prj org use <org>` or cd into a workspace).
 * Nothing at all registered and no cwd match → rc=1 (none).
 *
 * Legacy back-compat (SDD-041): if no `gov-workspaces` homes exist yet but the
 * legacy single-path `gov-workspace` pointer does and resolves to a gov repo,
 * it is migrated once into the registry and used.
 *
 * Pure over `ResolveEnv` — the only side effect is `writeHomes` (self-heal /
 * legacy migration), invoked exactly when the registry actually changes.
 */
import type { GovHome, ResolveEnv, ResolveResult } from "./types.js";
import { homeForOrg, upsertHome } from "./registry.js";

export function prjResolveGov(env: ResolveEnv): ResolveResult {
  // (1) cwd-walk — deterministic from where the developer stands.
  for (let dir: string | null = env.cwd; dir !== null; dir = env.parentOf(dir)) {
    const org = env.govOrgAt(dir);
    if (org !== null) {
      selfHeal(env, org, dir);
      return { ok: true, home: dir, org, via: "cwd-walk" };
    }
  }

  // Load (and, if needed, migrate) the registry once for steps 2–4.
  const { homes, activeOrg } = loadHomes(env);

  // (2) active-org — explicit selection wins over a lone home.
  if (activeOrg !== null) {
    const home = homeForOrg(homes, activeOrg);
    if (home !== null) {
      return { ok: true, home, org: activeOrg, via: "active-org" };
    }
  }

  // (3) single home registered.
  if (homes.length === 1) {
    return { ok: true, home: homes[0].home, org: homes[0].org, via: "single-home" };
  }

  // (4) ambiguous vs. none.
  if (homes.length > 1) {
    return { ok: false, code: 2, reason: "ambiguous", candidates: homes };
  }
  return { ok: false, code: 1, reason: "none" };
}

/** Ensure {org, home} is in the registry, writing only when it actually changes. */
function selfHeal(env: ResolveEnv, org: string, home: string): void {
  const { homes } = env.readRegistry();
  if (homes.some((h) => h.org === org && h.home === home)) return; // already current
  env.writeHomes(upsertHome(homes, org, home));
}

/**
 * Registry homes for steps 2–4, migrating the legacy single-path pointer once
 * if there are no homes yet. Returns the (possibly migrated) homes + activeOrg.
 */
function loadHomes(env: ResolveEnv): { homes: readonly GovHome[]; activeOrg: string | null } {
  const snap = env.readRegistry();
  if (snap.homes.length > 0 || snap.legacyPointer === null) {
    return { homes: snap.homes, activeOrg: snap.activeOrg };
  }
  // Migrate the legacy pointer — but only if it still names a real gov repo.
  const org = env.govOrgAt(snap.legacyPointer);
  if (org === null) {
    return { homes: snap.homes, activeOrg: snap.activeOrg };
  }
  const migrated = upsertHome(snap.homes, org, snap.legacyPointer);
  env.writeHomes(migrated);
  return { homes: migrated, activeOrg: snap.activeOrg };
}
