// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov rules build` — ONE PURE FUNCTION FROM THE RULE ROWS TO THE GENERATED FILES (P3 cutover, 2026-10-06).
 *
 * The build used to be a compiler over policy prose: it parsed numbered clauses, matched them against a POL lock,
 * read inline `gov:cue` / `gov:check` comments, and stopped to ask when a clause had been reworded. All of that is
 * retired (rule-model-design.md Q10, Q11, Q21). Policy prose is never touched by gov; the rules are the rows of the
 * two stores (`framework/rules/rules.yaml`, `policies/rules.yaml`), and the build only RENDERS them:
 *
 *   · the nine agent files — the session protocol with the resident tier in place (cues/resident.ts, W7)
 *   · `agent/harness/rule-map.md` — every revision of every rule, with its derived class (model/rule-map.ts, W8)
 *
 * Every producer calls this: `gov rules build|check`, the lifecycle builds at setup/upgrade/sync, and the
 * publisher's `agent/render-harness.mjs`. `check` fails exactly when the committed files differ from what this
 * returns, so there is one notion of "what should be there".
 *
 * STALE ROWS (Q9). A row records the sha of the section it was extracted from. When that section's text moves on,
 * the row is pending re-review — `gov rules propose` re-reads it and the owner keeps, revises or retires it. The
 * build never guesses: it reports which rows are stale and renders the rows as they stand.
 *
 * Pure: rows and text in, files and findings out.
 */
import { renderAll, type RenderFailure } from "./harness-render.js";
import { renderRuleMap, summariseRuleSet } from "./model/rule-map.js";
import { residentRows, RESIDENT_CAP } from "./cues/resident.js";
import { inForce, type RuleRow } from "./model/rule-row.js";
import { sectionShas } from "./checks/sections.js";
import type { RuleSet } from "./model/contracts.js";
import type { RuleClass } from "./model/catalog.js";

/** Where the generated files go, relative to the governance repository (or to `publish/content/`). */
export const HARNESS_DIR = "agent/harness";
export const RULE_MAP_PATH = `${HARNESS_DIR}/rule-map.md`;

export interface BuiltFile {
  /** Relative to the governance repository: `agent/harness/CLAUDE.md`, `agent/harness/rule-map.md`. */
  readonly path: string;
  readonly content: string;
}

/** The nine harness files and the rule map, or why they cannot be rendered (an empty or over-cap resident tier). */
export function buildArtifacts(protocolBody: string, rules: RuleSet): { readonly files: readonly BuiltFile[] } | RenderFailure {
  const rendered = renderAll(protocolBody, rules);
  if ("error" in rendered) return rendered;
  return {
    files: [
      ...rendered.files.map((f) => ({ path: `${HARNESS_DIR}/${f.path}`, content: f.content })),
      { path: RULE_MAP_PATH, content: renderRuleMap(rules) },
    ],
  };
}

/** An in-force row whose source section has moved on — pending re-review by `gov rules propose`. */
export interface StaleRow {
  readonly id: string;
  readonly doc: string;
  readonly section: string;
  /** The sha the row records. */
  readonly was: string;
  /** The section's sha now; `null` when the section (or the whole document) is gone. */
  readonly now: string | null;
}

/**
 * In-force rows whose `source.sha` differs from their section's current sha. `readDoc` reads a document from the
 * SAME place the rows came from (a ref, or the working tree); `null` = the document is not there.
 */
export function staleRows(rules: Pick<RuleSet, "framework" | "org">, readDoc: (doc: string) => string | null): StaleRow[] {
  const shas = new Map<string, Map<string, string> | null>();
  const shaOf = (doc: string, section: string): string | null => {
    if (!shas.has(doc)) {
      const text = readDoc(doc);
      shas.set(doc, text === null ? null : sectionShas(text));
    }
    return shas.get(doc)?.get(section) ?? null;
  };
  const out: StaleRow[] = [];
  for (const r of inForce([...rules.framework, ...rules.org]) as RuleRow[]) {
    const now = shaOf(r.source.doc, r.source.section);
    if (now !== r.source.sha) out.push({ id: r.id, doc: r.source.doc, section: r.source.section, was: r.source.sha, now });
  }
  return out;
}

/** One line per stale row, for a report. */
export const formatStaleRow = (s: StaleRow): string =>
  `${s.id}  ${s.doc} §${s.section}  ${s.now === null ? `section gone (row says ${s.was})` : `${s.was} → ${s.now}`}`;

/** The numbers a person reads first: how many rules, held up by what, and what the resident tier costs. */
export function summaryLines(rules: RuleSet): string[] {
  const counts = summariseRuleSet(rules);
  const total = Object.values(counts).reduce((n, k) => n + k, 0);
  const classes = (Object.keys(counts) as RuleClass[]).map((k) => `${k} ${counts[k]}`).join(" · ");
  return [
    `  ${total} rule(s) in force — ${inForce(rules.framework).length} framework · ${inForce(rules.org).length} organization (policy version ${rules.orgVersion})`,
    `    ${classes}`,
    `  ${residentRows(rules).length} resident cue(s) in every agent's context (cap ${RESIDENT_CAP})`,
  ];
}
