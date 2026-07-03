// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Secret / credential scanner (SDD-032, POL-143) — port of check_secrets.py.
 * HIGH signal, LOW false-positive: patterns match only structurally-distinctive
 * credential shapes. An inline `pragma: allowlist secret` on the line suppresses
 * a finding. Scans `ctx.files` (tracked text files); binary content is skipped.
 */
import * as path from "node:path";
import type { ValidateContext, ValidationResult } from "./validate.js";

const ALLOWLIST_MARKER = "pragma: allowlist secret";

/** A placeholder value is not a secret (guards the generic assignment patterns). */
const PLACEHOLDER_RE =
  /^(?:|\s*|x+|\.\.\.|-+|\*+|changeme|example|placeholder|your[-_].*|my[-_].*|some[-_].*|redacted|dummy|sample|test(?:ing)?|fake|none|null|nil|true|false|\$\{[^}]+\}|\{\{[^}]+\}\}|\$[A-Za-z_][A-Za-z0-9_]*|<[^>]+>)$/i;

/** High-signal credential shapes: a match anywhere on a non-allowlisted line. */
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private key block", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/],
  ["GitHub fine-grained PAT", /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["AWS access key id", /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
];

/** `password = "…"` / `api_key: '…'` — gated on the value not being a placeholder. */
const ASSIGNMENT_RE =
  /\b(?:password|passwd|pwd|api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*(["'])([^"']{6,})\1/i;

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_RE.test(value.trim());
}

export function checkSecrets(ctx: ValidateContext): ValidationResult {
  const errors: string[] = [];
  for (const rel of ctx.files ?? []) {
    const text = ctx.fs.readFile(path.join(ctx.repoRoot, rel));
    if (text === null || text.includes("\0")) continue; // missing or binary
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(ALLOWLIST_MARKER)) continue;
      const snippet = line.trim().slice(0, 120);
      for (const [label, pat] of PATTERNS) {
        if (pat.test(line)) errors.push(`${rel}:${i + 1}: ${label}: ${snippet}`);
      }
      const m = ASSIGNMENT_RE.exec(line);
      if (m && !isPlaceholder(m[2])) errors.push(`${rel}:${i + 1}: hardcoded credential: ${snippet}`);
    }
  }
  return { name: "secrets", ok: errors.length === 0, errors };
}
