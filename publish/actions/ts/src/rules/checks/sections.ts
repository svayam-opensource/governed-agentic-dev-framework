// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A POLICY DOCUMENT'S SECTIONS, BY SHA (rule-model-design.md Q9; W2-Q8).
 *
 * A section is a numbered heading (`## 4 Data`, `### 4.2 Retention` — {@link headingSection}) and the text up to
 * the NEXT NUMBERED HEADING, whatever its level — so §4's text stops where §4.2 starts, and an edit to §4.2 never
 * marks §4's rows stale. An unnumbered heading belongs to the section it sits in; a line inside a fenced code block
 * is never a heading. Text before the first numbered heading is the preamble, keyed `""`. Each section's sha is
 * {@link clauseSha} of its text — whitespace-normalised, so a reflow is not a change.
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
  let fence: string | null = null; // the marker that opened the fenced block we are in
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (m && fence === null) fence = m[1]!;
    else if (m && m[1]![0] === fence?.[0] && m[1]!.length >= fence.length) fence = null;
    const n = fence !== null || m ? null : headingSection(line);
    if (n !== null) current = n;
    const list = bodies.get(current) ?? [];
    list.push(line);
    bodies.set(current, list);
  }
  const out: PolicySection[] = [];
  for (const [section, lines] of bodies) {
    const body = lines.join("\n");
    if (section === "" && !body.trim()) continue; // no preamble at all
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
