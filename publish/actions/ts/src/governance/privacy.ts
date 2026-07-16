// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Privacy check (SDD-032) — port of check_privacy.py. The inverse of the
 * placeholder check: verify none of main's org-specific org-config.yaml values
 * have leaked into the publish-branch content. `makePrivacyValidator` closes over
 * main's org-config text (the caller supplies it, e.g. `git show main:…`) and
 * scans `ctx.files`.
 */
import * as path from "node:path";
import type { ValidateContext, ValidationResult, Validator } from "./validate.js";
import { readTopLevelScalar } from "../resolve/node-env.js";

/** Keys whose values are scanned for leaks. */
const PRIVATE_KEYS = [
  "org_name", "org_short_name", "org_slug", "org_slug_lower", "github_org",
  "workspace_repo", "policy_owner_email", "policy_owner_github", "legal_owner_github",
  "infra_owner_github", "system_arch_owner_github", "data_arch_owner_github",
];

/** Generic values — never considered org-specific. */
const GENERIC_VALUES = new Set([
  "", "main", "dev", "master", "YYYY-MM-DD", "Your Organization Name", "YourOrg",
  "ORG", "org", "your-github-org", "000-org-prj", "you@example.com", "@your-github-handle",
]);

const PLACEHOLDER_VALUE_PATTERNS = [/^@[a-z-]*-tbd$/, /^\{\{[A-Za-z_]+\}\}$/, /^\d{4}-\d{2}-\d{2}$/];

const SCAN_SUFFIXES = new Set([".md", ".yaml", ".yml", ".sh", ".py"]);
const SCAN_NAMES = new Set(["CODEOWNERS", "prj"]);
const ALLOWED_FILES = new Set(["setup.sh", "org-config.yaml"]);
/** Legitimate framework-author attribution: these keys in these files aren't leaks. */
const ATTRIBUTION_KEYS = new Set(["org_name", "org_short_name"]);
const ATTRIBUTION_FILES = new Set(["LICENSE", "README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md"]);

function isGeneric(value: string): boolean {
  if (GENERIC_VALUES.has(value)) return true;
  return PLACEHOLDER_VALUE_PATTERNS.some((p) => p.test(value));
}

/** Extract non-generic {key, value} pairs from main's org-config.yaml text. */
export function privateValuesFromOrgConfig(mainConfigText: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const key of PRIVATE_KEYS) {
    const value = readTopLevelScalar(mainConfigText, key);
    if (value && !isGeneric(value)) out.push({ key, value });
  }
  return out;
}

function scannable(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.some((p) => p.startsWith("."))) return false; // skip dotfiles/dirs
  const name = parts[parts.length - 1];
  if (ALLOWED_FILES.has(name)) return false;
  const dot = name.lastIndexOf(".");
  const suffix = dot >= 0 ? name.slice(dot) : "";
  return SCAN_SUFFIXES.has(suffix) || SCAN_NAMES.has(name);
}

/** Build a privacy Validator that scans for leaks of main's org-config values. */
export function makePrivacyValidator(mainConfigText: string): Validator {
  const values = privateValuesFromOrgConfig(mainConfigText);
  return (ctx: ValidateContext): ValidationResult => {
    const errors: string[] = [];
    if (values.length === 0) return { name: "privacy", ok: true, errors };
    for (const rel of ctx.files ?? []) {
      if (!scannable(rel)) continue;
      const name = rel.split("/").pop() ?? rel;
      const text = ctx.fs.readFile(path.join(ctx.repoRoot, rel));
      if (text === null || text.includes("\0")) continue;
      const lines = text.split(/\r?\n/);
      for (const { key, value } of values) {
        if (ATTRIBUTION_KEYS.has(key) && ATTRIBUTION_FILES.has(name)) continue; // legit attribution
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(value)) errors.push(`${rel}:${i + 1}: leak of ${key}='${value}'`);
        }
      }
    }
    return { name: "privacy", ok: errors.length === 0, errors };
  };
}
