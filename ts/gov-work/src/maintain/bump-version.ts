// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `bump-version` (SDD Part E, bump-version.sh) — write a release version into the
 * three places that MUST agree (checkVersionSync enforces it): package.json
 * "version", framework/VERSION, .framework-version. The package.json edit is a
 * targeted replace of the top-level "version" value only (preserves formatting).
 * A package-maintenance command — operates on the package repo (cwd), not a gov
 * workspace.
 */
import * as path from "node:path";
import type { Fs } from "../lifecycle/fs-io.js";

/** x.y.z with an optional pre-release suffix. */
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const VERSION_FIELD_RE = /("version"\s*:\s*")[^"]*(")/;

export type BumpResult =
  | { readonly ok: true; readonly version: string; readonly written: readonly string[] }
  | { readonly ok: false; readonly code: number; readonly error: string };

export function bumpVersion(fs: Fs, repoRoot: string, newVersion: string): BumpResult {
  if (!SEMVER_RE.test(newVersion)) {
    return { ok: false, code: 2, error: `'${newVersion}' is not a version (expected x.y.z)` };
  }
  const pkgPath = path.join(repoRoot, "package.json");
  const pkg = fs.readFile(pkgPath);
  if (pkg === null) return { ok: false, code: 1, error: "package.json not found" };
  if (!VERSION_FIELD_RE.test(pkg)) return { ok: false, code: 1, error: 'package.json has no "version" field' };

  fs.writeFile(pkgPath, pkg.replace(VERSION_FIELD_RE, `$1${newVersion}$2`));
  fs.writeFile(path.join(repoRoot, "framework/VERSION"), `${newVersion}\n`);
  fs.writeFile(path.join(repoRoot, ".framework-version"), `${newVersion}\n`);

  return { ok: true, version: newVersion, written: ["package.json", "framework/VERSION", ".framework-version"] };
}
