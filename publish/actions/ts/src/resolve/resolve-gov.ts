// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `prjResolveGov` — the deterministic governance-home resolver (SDD-013 / SDD-040).
 *
 * active-org is the anchor; cwd-walk is a cross-check (see types.ts for the full
 * decision table). The function is PURE — it only reads through `ResolveEnv` and
 * never writes, so resolution cannot pollute the registry.
 */
import type { HomeCheckFailure, ResolveEnv, ResolveResult } from "./types.js";

export function prjResolveGov(env: ResolveEnv): ResolveResult {
  // [rule a] active-org is mandatory — no silent fallback.
  const activeOrg = env.readActiveOrg();
  if (!activeOrg) return { ok: false, code: 2, reason: "no-active-org" };

  // cwd-walk: the org whose workspace we're standing in (nearest ancestor), if any.
  const cwdHit = walkForOrg(env);

  if (cwdHit) {
    if (cwdHit.org !== activeOrg) {
      // Standing in a different org's tree than the active one — never guess.
      return { ok: false, code: 2, reason: "org-conflict", cwdOrg: cwdHit.org, activeOrg };
    }
    // Same org: operate on the cwd workspace (project clone or the home itself).
    // Identity is already confirmed — org was read straight from its org-config.
    return { ok: true, home: cwdHit.home, org: activeOrg, via: "cwd" };
  }

  // Outside any workspace: resolve via the registry pointer for active-org.
  const home = env.homeForOrg(activeOrg);
  if (!home) return { ok: false, code: 2, reason: "no-home", activeOrg };

  // [rule b] double-check the pointer against the home's own org-config.
  const detail = confirmHome(env, home, activeOrg);
  if (detail) return { ok: false, code: 2, reason: "pointer-mismatch", home, activeOrg, detail };

  return { ok: true, home, org: activeOrg, via: "active-org" };
}

/** Walk cwd → ancestors for the nearest gov repo; return its org + dir, or null. */
function walkForOrg(env: ResolveEnv): { org: string; home: string } | null {
  for (let dir: string | null = env.cwd; dir !== null; dir = env.parentOf(dir)) {
    const cfg = env.govConfigAt(dir);
    if (cfg !== null) return { org: cfg.org, home: dir };
  }
  return null;
}

/**
 * [rule b] Confirm a registry-resolved home against its own `org-config.yaml`:
 * the org must match, and the home must be canonical (its `gov_workspace` points
 * at itself — this rejects a stray project-clone pointer). Returns the failure,
 * or null when the pointer checks out.
 */
function confirmHome(env: ResolveEnv, home: string, org: string): HomeCheckFailure | null {
  const cfg = env.govConfigAt(home);
  if (cfg === null) return { why: "not-a-gov-repo" };
  if (cfg.org !== org) return { why: "org-mismatch", found: cfg.org };
  if (cfg.govWorkspace !== null && !env.sameHome(cfg.govWorkspace, home)) {
    return { why: "not-canonical", found: cfg.govWorkspace };
  }
  return null;
}

/** Render a resolution failure as an actionable one-line CLI message. */
export function resolveFailureMessage(r: Extract<ResolveResult, { ok: false }>): string {
  switch (r.reason) {
    case "no-active-org":
      return "No active org is set. Run `gov org use <github_org>` to choose one.";
    case "org-conflict":
      return (
        `You're in ${r.cwdOrg}'s workspace but the active org is ${r.activeOrg}. ` +
        `Run \`gov org use ${r.cwdOrg}\` (or cd into a ${r.activeOrg} workspace).`
      );
    case "no-home":
      return (
        `Active org ${r.activeOrg} has no registered gov home. ` +
        `Run \`gov org add ${r.activeOrg} <path-to-gov-repo>\`.`
      );
    case "pointer-mismatch": {
      const base = `The registry points ${r.activeOrg} → ${r.home}, but `;
      const tail =
        r.detail.why === "not-a-gov-repo"
          ? "that path is not a gov repo (no org-config.yaml)."
          : r.detail.why === "org-mismatch"
            ? `its org-config says github_org=${r.detail.found}.`
            : `it is not a canonical gov home (its gov_workspace is ${r.detail.found}).`;
      return base + tail + " Fix it with `gov org add`.";
    }
  }
}
