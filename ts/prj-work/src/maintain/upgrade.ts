// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `upgrade` (SDD Part E, SDD-051) — planning + guidance. The full self-update
 * (download CLI + overlay framework diffs) is deferred until the Node package is
 * published; today this resolves the target and reports the install command
 * (drift is surfaced by `doctor`). Pure plan; no auto-install.
 */
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PKG = "@svayam-opensource/prj-work";

export type UpgradePlan =
  | { readonly kind: "up-to-date"; readonly version: string }
  | { readonly kind: "install"; readonly version: string; readonly command: string }
  | { readonly kind: "error"; readonly message: string };

export function upgradePlan(current: string, target: string | null): UpgradePlan {
  if (target === null) {
    return { kind: "error", message: `pass an explicit version (x.y.z): 'latest' resolution needs the published package. e.g. prj upgrade 0.8.0` };
  }
  if (!SEMVER_RE.test(target)) return { kind: "error", message: `'${target}' is not a version (expected x.y.z)` };
  if (target === current) return { kind: "up-to-date", version: current };
  return { kind: "install", version: target, command: `npm install -g ${PKG}@${target}` };
}

export function formatUpgradePlan(p: UpgradePlan): string[] {
  switch (p.kind) {
    case "up-to-date":
      return [`upgrade: already on ${p.version}`];
    case "install":
      return [`upgrade → ${p.version}:`, `  ${p.command}`, "  then re-run `prj doctor` to confirm no drift."];
    case "error":
      return [`upgrade: ${p.message}`];
  }
}
