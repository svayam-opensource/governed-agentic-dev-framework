// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * POL-408 front matter for PROJECT knowledge — `projects/<id>/knowledge/**.md`.
 *
 * `checkKnowledge` validates the ORG tree (`knowledge/**`) and always has. Project knowledge was never
 * scanned by anything, which surfaced on 2026-08-07 in the plainest possible way: a markdown formatter
 * destroyed a doc's front matter — turning `domain: development` into an `##` heading and deleting the
 * closing `---` — and `gov validate` reported PASS. A requirement nothing checks is a convention, and this
 * one had been resting on care for months.
 *
 * ## Why this checks CHANGED files only
 *
 * Measured before writing it: 221 project knowledge docs, **16 compliant**. 152 carry no front matter at
 * all and 53 have invalid fields, across projects that closed long ago. Validating all of them would fail
 * every push and every close gate in the repository — a check nobody can satisfy is switched off within the
 * week, and we would be back to no check at all.
 *
 * So the scope is the Policy Owner's own rule: knowledge docs are **born compliant, not retrofitted**. A doc
 * you touch must be valid; a doc you did not touch is history. `ctx.changedFiles` carries the scope — when
 * it is absent (a plain `gov validate` with no diff) this validator passes silently rather than guessing,
 * because inventing a scope would make the result depend on where it ran.
 *
 * A retrofit sweep of the other 205 is a separate, deliberate act. This makes the number stop growing.
 */
import type { ValidateContext, ValidationResult } from "./validate.js";

/** The POL-408 taxonomy, identical to the org-tree checker's — one policy, one set of valid values. */
const DOMAINS = new Set([
  "policies", "legal", "architecture/system", "architecture/data", "development",
  "testing", "deployment", "infrastructure", "support", "compliance", "navigation",
]);
const LAYERS = new Set(["mandate", "procedure", "pattern", "use-case", "spec", "compliance", "path"]);
const COMPLIANCE = new Set(["C01", "C02", "C03", "instructional", "descriptive", "evidence"]);
const STATUSES = new Set(["current", "draft", "superseded"]);

/**
 * The ADR lifecycle words, and what POL-408 calls them instead (Policy Owner, 2026-08-07: ADRs use the
 * POL-408 taxonomy; the taxonomy does not grow to meet them). Four docs in this repo said `accepted` or
 * `proposed`, so the mapping is named IN THE ERROR rather than left for the author to guess — the same
 * mistake would otherwise be made once per ADR, forever.
 */
const ADR_STATUS_HINT: Readonly<Record<string, string>> = {
  accepted: "current", proposed: "draft", rejected: "superseded", deprecated: "superseded", ruled: "current",
};

const FM_RE = /^---\n([\s\S]*?)\n---\n/;
const PROJECT_DOC_RE = /^projects\/[^/]+\/knowledge\/.*\.md$/;

/** Working files that carry no taxonomy: the carry-forward list, the compliance ledger, session handoffs. */
const EXEMPT = new Set(["todo.md", "compliance.md", "HANDOFF.md"]);

/** Parse a leading `---\n…\n---\n` block into key→value. Null when there is no parseable front matter —
 *  which is the case the formatter produced, and the case that used to pass. */
function frontMatter(text: string): Record<string, string> | null {
  const m = FM_RE.exec(text);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (line.includes(":") && !line.trimStart().startsWith("#")) {
      const i = line.indexOf(":");
      fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return fm;
}

/** Is this a project knowledge doc this validator governs? */
export function isProjectDoc(rel: string): boolean {
  const base = rel.split("/").pop() ?? "";
  if (!PROJECT_DOC_RE.test(rel) || EXEMPT.has(base)) return false;
  return base !== "TEMPLATE.md" && !/-template\.md$/.test(base) && !rel.includes("/templates/");
}

/** The POL-408 errors in one doc's text, `[]` when it is valid. Pure — the file list and the reading are
 *  the caller's, so this is testable on a string. */
export function pol408Errors(rel: string, text: string): string[] {
  const fm = frontMatter(text);
  if (fm === null) {
    return [`${rel}: missing or unparseable front-matter (POL-408) — it must open with a '---' block and close with '---'`];
  }
  const errors: string[] = [];
  for (const [key, allowed] of [["domain", DOMAINS], ["layer", LAYERS], ["compliance", COMPLIANCE], ["status", STATUSES]] as const) {
    if (!allowed.has(fm[key] ?? "")) {
      const got = fm[key] ?? "";
      const adr = key === "status" ? ADR_STATUS_HINT[got.toLowerCase()] : undefined;
      errors.push(`${rel}: front-matter ${key}='${got}' invalid (POL-408) — one of: ${[...allowed].join(", ")}`
        + (adr ? `. ADRs use the POL-408 taxonomy: '${got}' → '${adr}'` : ""));
    }
  }
  if (!fm.owner) errors.push(`${rel}: front-matter owner missing (POL-408)`);
  return errors;
}

export function checkProjectKnowledge(ctx: ValidateContext): ValidationResult {
  // No declared scope → nothing to judge. NOT "check everything": that would make a local `gov validate`
  // fail on 205 historical docs while CI passed, and a check whose verdict depends on where it ran is worse
  // than no check. The caller that knows the diff passes it.
  const scope = ctx.changedFiles;
  if (!scope) return { name: "project-knowledge", ok: true, errors: [] };

  const errors: string[] = [];
  for (const rel of scope.filter(isProjectDoc)) {
    const text = ctx.fs.readFile(`${ctx.repoRoot}/${rel}`);
    if (text === null) continue;   // deleted in this change — nothing to validate
    errors.push(...pol408Errors(rel, text));
  }
  return { name: "project-knowledge", ok: errors.length === 0, errors };
}
