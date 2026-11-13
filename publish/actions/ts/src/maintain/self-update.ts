// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov self-update` — gov installs a newer gov in place (PRJ-121 F55, Policy Owner ruling A, 2026-11-12).
 *
 * gov is installed by install.sh / install.ps1 on its OWN private Node, and they install it with THAT Node's npm into
 * that Node's prefix (`~/.local/share/gov/node`, `%LOCALAPPDATA%\gov\node`). A plain `npm install -g` install is the
 * same shape on the user's own Node. So the update is always "the npm beside the Node gov runs on, install -g": it
 * lands exactly where the running gov came from, with no PATH guess and no elevation. The one exception is the
 * Windows MSI (`%LOCALAPPDATA%\Programs\gov`), which only winget or a newer MSI replaces — gov says so instead.
 *
 * Which version: an explicit one, or a dist-tag — `latest`, or `next` for the pre-release line. With neither, gov
 * stays on its own line: a `-next.N` gov follows `next`, a release follows `latest`.
 *
 * After the client, the org's governance repository still carries the old framework content: gov says to run
 * `gov upgrade --pr` there (it is a reviewed pull request, never done silently).
 */
import * as path from "node:path";
import { PACKAGE_NAME } from "../package-identity.js";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export type InstallKind = "npm" | "msi";

/** How the running gov was installed: the MSI's per-user program folder, or an npm prefix (installers, npm -g). */
export function installKindOf(packageRoot: string, platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>): InstallKind {
  if (platform !== "win32" || !env.LOCALAPPDATA) return "npm";
  const msiRoot = path.win32.join(env.LOCALAPPDATA, "Programs", "gov").toLowerCase();
  const here = path.win32.normalize(packageRoot).toLowerCase();
  return here === msiRoot || here.startsWith(`${msiRoot}\\`) ? "msi" : "npm";
}

/** The npm that sits beside the Node gov runs on (`<dir>/npm`, or `npm.cmd` on Windows). */
export function npmBeside(nodeExecPath: string, platform: NodeJS.Platform): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(p.dirname(nodeExecPath), platform === "win32" ? "npm.cmd" : "npm");
}

export interface TargetInput {
  readonly current: string;
  /** An explicit version, or null. */
  readonly version: string | null;
  /** `--next` / `--latest`, or null: follow the running gov's own line. */
  readonly tag: "next" | "latest" | null;
  /** The registry's dist-tags; null when they could not be read. */
  readonly distTags: Readonly<Record<string, string>> | null;
}

export type Target = { readonly ok: true; readonly version: string; readonly via: string } | { readonly ok: false; readonly message: string };

/** The version to install: explicit, or the dist-tag (named, or the running gov's own line). */
export function resolveTarget(t: TargetInput): Target {
  if (t.version !== null) {
    return SEMVER.test(t.version) ? { ok: true, version: t.version, via: "the version you named" } : { ok: false, message: `'${t.version}' is not a version (expected x.y.z or x.y.z-next.n)` };
  }
  const tag = t.tag ?? (/-next\.\d+$/.test(t.current) ? "next" : "latest");
  if (!t.distTags) return { ok: false, message: `could not read ${PACKAGE_NAME}'s versions from the registry — name a version: gov self-update <x.y.z>` };
  const v = t.distTags[tag];
  if (!v || !SEMVER.test(v)) return { ok: false, message: `the registry has no '${tag}' version of ${PACKAGE_NAME}` };
  return { ok: true, version: v, via: `the '${tag}' line` };
}

export type SelfUpdatePlan =
  | { readonly kind: "up-to-date"; readonly version: string }
  | { readonly kind: "install"; readonly from: string; readonly to: string; readonly via: string; readonly npm: string; readonly args: readonly string[] }
  | { readonly kind: "msi"; readonly from: string; readonly to: string }
  | { readonly kind: "error"; readonly message: string };

export function selfUpdatePlan(o: {
  readonly target: Target; readonly current: string; readonly kind: InstallKind; readonly npm: string; readonly registry?: string;
}): SelfUpdatePlan {
  if (!o.target.ok) return { kind: "error", message: o.target.message };
  if (o.target.version === o.current) return { kind: "up-to-date", version: o.current };
  if (o.kind === "msi") return { kind: "msi", from: o.current, to: o.target.version };
  const scope = PACKAGE_NAME.startsWith("@") ? PACKAGE_NAME.split("/")[0] : null;
  const registry = o.registry ? ["--registry", o.registry, ...(scope ? [`--${scope}:registry=${o.registry}`] : [])] : [];
  return {
    kind: "install", from: o.current, to: o.target.version, via: o.target.via, npm: o.npm,
    args: ["install", "-g", ...registry, `${PACKAGE_NAME}@${o.target.version}`],
  };
}

/** What comes after the client: the governance repository's content, by reviewed pull request. */
export const AFTER_UPDATE = [
  "Next, in your organization's governance repository, bring its framework content to this gov:",
  "  gov upgrade --pr      (opens a pull request for you to review; `gov upgrade` alone shows what it would change)",
];

export function formatSelfUpdatePlan(p: SelfUpdatePlan, dryRun: boolean): string[] {
  switch (p.kind) {
    case "up-to-date":
      return [`gov self-update: already on ${p.version}.`];
    case "error":
      return [`gov self-update: ${p.message}`];
    case "msi":
      return [
        `gov self-update: ${p.from} → ${p.to}. This gov is the Windows installer (MSI); only winget or a newer MSI replaces it:`,
        "  winget upgrade Svayam.Gov",
        ...AFTER_UPDATE,
      ];
    case "install":
      return [
        `gov self-update: ${p.from} → ${p.to} (${p.via}), into the same place this gov was installed:`,
        `  ${[p.npm, ...p.args].join(" ")}`,
        ...(dryRun ? ["(dry run — nothing was installed; run without --dry-run to install)"] : []),
      ];
  }
}
