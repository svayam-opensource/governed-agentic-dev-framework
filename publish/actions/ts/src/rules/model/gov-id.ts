// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * GOV IDS — ONE NAMESPACE, TWO ISSUERS (rule-model-design.md Q1, Q7, Q17; 2026-10-06).
 *
 * `GOV-FRM-012` is the framework's; `GOV-<org_slug>-213` is the organization's. The scope is in the id so a
 * reader sees whose rule it is without a lookup, and so the two issuers — the framework at release, each org when
 * its policy PR merges — can never hand out the same id.
 *
 * ONLY THIS CODE ISSUES AN ID. Not the LLM that proposes rules: a model asked twice may number twice, and an id is
 * the thing an audit, an exception file and a commit message all cite. The next number is one past the highest
 * EVER issued in the scope, retired rows included — a retired id is history, and reusing it would make old
 * citations point at a different rule.
 */

/** The framework's scope. Reserved: `gov setup` refuses it as an org slug. */
export const FRAMEWORK_SCOPE = "FRM";

/** An org slug is 2–6 uppercase letters or digits, starting with a letter (org-config.yaml `org_slug`). */
const SCOPE = /^[A-Z][A-Z0-9]{1,5}$/;
const ID = /^GOV-([A-Z][A-Z0-9]{1,5})-(\d{3,})$/;

export interface GovId { readonly scope: string; readonly n: number; }

/** `GOV-SVM-012` → `{ scope: "SVM", n: 12 }`, or null for anything that is not a GOV id. */
export function parseGovId(id: string): GovId | null {
  const m = ID.exec(id);
  return m ? { scope: m[1], n: Number(m[2]) } : null;
}

export const formatGovId = (scope: string, n: number): string => `GOV-${scope}-${String(n).padStart(3, "0")}`;

/** Is this a usable scope? FRM is valid here — it is `gov setup` that keeps an org from choosing it. */
export const isScope = (s: string): boolean => SCOPE.test(s);

/**
 * The next id in `scope`, given every id ever issued (any scope; the others are ignored).
 * Throws on a malformed scope: an id that cannot be parsed back is worse than no id.
 */
export function issueId(everIssued: readonly string[], scope: string): string {
  if (!isScope(scope)) throw new Error(`issueId: "${scope}" is not a valid scope (2–6 uppercase letters/digits, starting with a letter)`);
  let max = 0;
  for (const id of everIssued) {
    const g = parseGovId(id);
    if (g && g.scope === scope && g.n > max) max = g.n;
  }
  return formatGovId(scope, max + 1);
}
