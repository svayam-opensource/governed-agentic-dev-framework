// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * "SECTIONS REVIEWED" — the changelog's record that propose read each added or changed policy section
 * (Policy Owner, 2026-10-07: GOV-FRM-467 starts from the policy text; rule-model-design.md "gate starts from the prose").
 *
 * One line per section, written by propose's writers and read by the gate:
 *
 *   - policies/org-policy.md §2.2 (a1b2c3d) → no rule
 *   - policies/org-policy.md §3 (e4f5a6b) → GOV-SVM-001 revised, GOV-SVM-007 added
 *   - policies/org-policy.md §5 → removed (rules retired: GOV-SVM-004)
 *
 * The sha is the section's ({@link clauseSha} via sections.ts) at the time of review: a section edited again after
 * it was reviewed has a new sha and is demanded again.
 *
 * Pure.
 */
import { compareSections } from "../checks/sections.js";

export type ReviewedChange = "added" | "revised" | "retired" | "kept";

export type ReviewOutcome =
  | { readonly kind: "no-rule" }
  | { readonly kind: "rules"; readonly rules: readonly { readonly id: string; readonly change: ReviewedChange }[] }
  | { readonly kind: "removed"; readonly retired: readonly string[] };

export interface SectionReview {
  readonly doc: string;
  readonly section: string;
  /** The section's sha in the head; null for a section the change removed. */
  readonly sha: string | null;
  readonly outcome: ReviewOutcome;
}

export const REVIEWED_HEADING = "**Sections reviewed**";

export function renderReviewLine(r: SectionReview): string {
  const where = `- ${r.doc} §${r.section}${r.sha === null ? "" : ` (${r.sha})`}`;
  const o = r.outcome;
  if (o.kind === "no-rule") return `${where} → no rule`;
  if (o.kind === "removed") return `${where} → removed (${o.retired.length ? `rules retired: ${o.retired.join(", ")}` : "no rules"})`;
  return `${where} → ${o.rules.map((x) => `${x.id} ${x.change}`).join(", ")}`;
}

const LINE = /^- (.+?) §(\d+(?:\.\d+)*)(?: \(([0-9a-f]{7,})\))? → (.+)$/;
const CHANGES = new Set<string>(["added", "revised", "retired", "kept"]);

/** The review lines in an entry's text, in order. Lines that do not parse are ignored. */
export function parseReviewedLines(entry: string): SectionReview[] {
  const out: SectionReview[] = [];
  for (const line of entry.split(/\r?\n/)) {
    const m = LINE.exec(line.trimEnd());
    if (!m) continue;
    const [, doc, section, sha, rest] = m as unknown as [string, string, string, string | undefined, string];
    let outcome: ReviewOutcome | null = null;
    if (rest === "no rule") outcome = { kind: "no-rule" };
    else if (rest === "removed (no rules)") outcome = { kind: "removed", retired: [] };
    else if (rest.startsWith("removed (rules retired: ") && rest.endsWith(")")) {
      outcome = { kind: "removed", retired: rest.slice("removed (rules retired: ".length, -1).split(", ").filter(Boolean) };
    } else {
      const rules = rest.split(", ").map((p) => p.split(" "));
      if (rules.every((p) => p.length === 2 && CHANGES.has(p[1]!))) {
        outcome = { kind: "rules", rules: rules.map(([id, change]) => ({ id: id!, change: change as ReviewedChange })) };
      }
    }
    if (outcome) out.push({ doc, section, sha: sha ?? null, outcome });
  }
  return out;
}

export const reviewKey = (r: Pick<SectionReview, "doc" | "section">): string => `${r.doc}\u0000${r.section}`;

/** Sorted by document, then section number — the order the entry lists them. */
export function sortReviews(rs: Iterable<SectionReview>): SectionReview[] {
  return [...rs].sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : compareSections(a.section, b.section)));
}
