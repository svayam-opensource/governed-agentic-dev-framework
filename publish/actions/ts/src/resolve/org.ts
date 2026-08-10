// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov org add|use|list|remove` (SDD Part D) — manage the CLI-local multi-home
 * registry that the resolver reads. `add` validates that the home really is that
 * org's gov repo (via govConfigAt) before recording it, so the resolver's rule-b
 * pointer check can trust it. Pure over the RegistryStore + a gov-repo probe.
 */
import type { RegistryStore } from "./registry-store.js";
import type { GovConfig, GovHome } from "./types.js";
import { homeForOrg, removeOrg, upsertHome } from "./registry.js";

export interface OrgDeps {
  readonly store: RegistryStore;
  /** Probe a path's gov config (the resolver's `govConfigAt`). */
  govConfigAt(path: string): GovConfig | null;
}

export type OrgResult =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly code: number; readonly message: string };

/** Register (or update) a gov home for `org` at the absolute `homePath`. */
export function orgAdd(deps: OrgDeps, org: string, homePath: string): OrgResult {
  const cfg = deps.govConfigAt(homePath);
  if (cfg === null) return { ok: false, code: 1, message: `'${homePath}' is not a gov repo (no org-config.yaml, or a .bases clone).` };
  if (cfg.org !== org) return { ok: false, code: 1, message: `'${homePath}' belongs to org '${cfg.org}', not '${org}'.` };
  deps.store.writeHomes(upsertHome(deps.store.readHomes(), org, homePath));
  return { ok: true, lines: [`Registered ${org} → ${homePath}`] };
}

/** Select the active org (must already be registered). */
export function orgUse(deps: OrgDeps, org: string): OrgResult {
  if (homeForOrg(deps.store.readHomes(), org) === null) {
    return { ok: false, code: 1, message: `Org '${org}' is not registered — add it first: prj org add ${org} <home>.` };
  }
  deps.store.writeActiveOrg(org);
  return { ok: true, lines: [`Active org → ${org}`] };
}

/** List registered homes, marking the active one. */
export function orgList(deps: OrgDeps): OrgResult {
  const homes = deps.store.readHomes();
  const active = deps.store.readActiveOrg();
  if (homes.length === 0) return { ok: true, lines: ["No orgs registered. Add one: prj org add <org> <home>."] };
  const lines = homes.map((h: GovHome) => `${h.org === active ? "* " : "  "}${h.org}\t${h.home}`);
  return { ok: true, lines: ["Registered gov homes (* = active):", ...lines] };
}

/** Remove an org's home; clears active-org if it was the one removed. */
export function orgRemove(deps: OrgDeps, org: string): OrgResult {
  const homes = deps.store.readHomes();
  if (homeForOrg(homes, org) === null) return { ok: false, code: 1, message: `Org '${org}' is not registered.` };
  deps.store.writeHomes(removeOrg(homes, org));
  if (deps.store.readActiveOrg() === org) deps.store.clearActiveOrg();
  return { ok: true, lines: [`Removed ${org}`] };
}
