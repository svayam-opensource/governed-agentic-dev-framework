// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A POLICY DOCUMENT'S SECTIONS, BY SHA (rule-model-design.md Q9; W2-Q8).
 *
 * A section is a numbered heading (`## 4 Data`, `### 4.2 Retention` — {@link headingSection}) and the text up to
 * the next heading that ENDS it:
 *
 *   - any NUMBERED heading, whatever its level — so §4's text stops where §4.2 starts, and an edit to §4.2 never
 *     marks §4's rows stale;
 *   - an UNNUMBERED heading at the same level or higher — so a closing `## Glossary` is not part of §12.3.
 *
 * A deeper unnumbered heading (`#### Why` under `### 4.2`) belongs to the section it sits in. A line inside a fenced
 * code block is never a heading. Text outside every numbered section — the preamble, and anything under an
 * unnumbered heading that ended one — is keyed `""`. Each section's sha is {@link clauseSha} of its text —
 * whitespace-normalised, so a reflow is not a change.
 *
 * THE ONE DEFINITION (integration, 2026-10-06). Propose stamps `source.sha` with it, the policy PR gate checks it,
 * section-owner-approval finds changed sections with it, and the shipped framework store's test re-hashes with it.
 * Nothing else hashes a section.
 *
 * Pure.
 */
import { headingSection } from "../notation.js";
import { clauseSha } from "../cue-block.js";

/** One section of a policy document: its number, its text (heading included) and that text's sha. */
export interface PolicySection {
  readonly section: string;
  readonly text: string;
  readonly sha: string;
}

/** Every section, in document order — the text the proposer reads and the sha a rule row records (Q9). */
export function policySections(text: string): PolicySection[] {
  const bodies = new Map<string, string[]>();
  let current = "";
  let depth = 0; // the heading level of the current numbered section; 0 outside one
  let fence: string | null = null; // the marker that opened the fenced block we are in
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (m && fence === null) fence = m[1]!;
    else if (m && m[1]![0] === fence?.[0] && m[1]!.length >= fence.length) fence = null;
    const level = fence !== null || m ? 0 : (/^(#{1,6})\s+\S/.exec(line)?.[1]!.length ?? 0);
    if (level) {
      const n = headingSection(line);
      if (n !== null) { current = n; depth = level; }
      else if (current !== "" && level <= depth) { current = ""; depth = 0; }
    }
    const list = bodies.get(current) ?? [];
    list.push(line);
    bodies.set(current, list);
  }
  const out: PolicySection[] = [];
  for (const [section, lines] of bodies) {
    const body = lines.join("\n");
    if (section === "" && !body.trim()) continue; // no text outside a numbered section at all
    out.push({ section, text: body, sha: clauseSha(body) });
  }
  return out;
}

/** Section number → sha, in document order. */
export function sectionShas(text: string): Map<string, string> {
  return new Map(policySections(text).map((s) => [s.section, s.sha]));
}

/**
 * The sections whose sha differs between `base` and `head`, sorted by section number. A section present on one
 * side only is changed; `null` (a new or a deleted document) makes every section of the other side changed.
 */
export function changedSections(base: string | null, head: string | null): string[] {
  const a = base === null ? new Map<string, string>() : sectionShas(base);
  const b = head === null ? new Map<string, string>() : sectionShas(head);
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).sort(compareSections);
}

/** `""` first, then numerically by part: 3 < 3.1 < 3.10 < 4. */
export function compareSections(x: string, y: string): number {
  if (x === y) return 0;
  if (x === "") return -1;
  if (y === "") return 1;
  const px = x.split(".").map(Number), py = y.split(".").map(Number);
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    if (px[i] === undefined) return -1;
    if (py[i] === undefined) return 1;
    if (px[i] !== py[i]) return px[i]! - py[i]!;
  }
  return 0;
}
