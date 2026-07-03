// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Version-sync validator (SDD-032) — port of check_version_sync.py. The package
 * version must agree across three places, or installs + the downgrade guard
 * misbehave:
 *   1. package.json "version"   (source of truth)
 *   2. framework/VERSION
 *   3. .framework-version       (install marker)
 * The README's jsDelivr diagram URLs must stay on the FLOATING `@latest` tag
 * (assets ship in the tarball) — an exact pin would silently go stale.
 */
import * as path from "node:path";
import type { ValidateContext, ValidationResult } from "./validate.js";

/** jsDelivr URLs for this package in the README; captures the version spec. */
const README_PIN_RE = /cdn\.jsdelivr\.net\/npm\/@svayam-opensource\/prj@([^/]+)\//g;

export function checkVersionSync(ctx: ValidateContext): ValidationResult {
  const errors: string[] = [];
  const read = (rel: string): string | null => ctx.fs.readFile(path.join(ctx.repoRoot, rel));

  const pkgText = read("package.json");
  if (pkgText === null) return { name: "version-sync", ok: false, errors: ["package.json not found"] };

  let version: string;
  try {
    version = ((JSON.parse(pkgText) as { version?: string }).version ?? "").trim();
  } catch (e) {
    return { name: "version-sync", ok: false, errors: [`package.json does not parse: ${(e as Error).message}`] };
  }
  if (!version) return { name: "version-sync", ok: false, errors: ["package.json: no 'version' field"] };

  for (const rel of ["framework/VERSION", ".framework-version"]) {
    const got = read(rel);
    if (got === null) {
      errors.push(`${rel}: missing (expected to equal package.json ${version})`);
    } else if (got.trim() !== version) {
      errors.push(`${rel}: '${got.trim()}' != package.json '${version}'`);
    }
  }

  const readme = read("README.md");
  if (readme !== null) {
    for (const m of readme.matchAll(README_PIN_RE)) {
      if (m[1] !== "latest") {
        errors.push(`README.md: jsDelivr URL is pinned to @${m[1]}; use @latest (assets float with the release)`);
      }
    }
  }

  return { name: "version-sync", ok: errors.length === 0, errors };
}
