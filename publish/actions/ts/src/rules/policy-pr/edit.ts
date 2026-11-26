// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ONE POLICY EDIT FROM THE WEB, WRITTEN AS A POLICY PULL REQUEST THE GATE PASSES (F127 slice G3, 2026-11-20).
 *
 * gov-licence's write side (Edit / Add / Stop / Enforce now on the Policies page) prepares the head of a branch in
 * the organization's gov repo with this, then opens or updates the pull request. Everything the gate
 * ({@link judgePolicyPr}) demands is written here, by the same writers `gov rules propose` uses:
 *
 *   prose     the cited section of the policy document carries the statement (added, reworded) — so the row's
 *             `source.sha` is the section's real sha, and every other open row citing that section is refreshed
 *             in place (Q17)
 *   rows      policies/rules/rules.yaml: add = a new id (gov issues it); revise = close the open row and open its
 *             successor; close (Stop) = end the open row; enforce-now = end a future-dated row and open the same
 *             rule starting today; annotate = fill the statement or chapter in place (a patch)
 *   then      VERSION bump, frozen snapshot, stamps, CHANGELOG entry with "Sections reviewed"
 *             ({@link finishPolicyChange}) — once the pull request number is known
 *
 * RULINGS (Policy Owner, 2026-11-20): rules.yaml holds APPROVED rules only — nothing is written for a rejected
 * proposal (it is a closed pull request, never a row). Enforce now = end the future-dated row and add a revision
 * starting today. A web-added rule's technical expectation is drafted from its statement by `gov rules propose`;
 * until then the row carries the statement as its expectation and the result says `needsDraft`.
 *
 * Pure over the injected trees: `base` (the default branch) is read only; `head` is the branch being prepared.
 * Run twice with the same input, the second run writes nothing new.
 */
import { createIdIssuer } from "../model/store-io.js";
import { isChapter, parseRuleStore, type Actor, type Chapter, type Level, type RuleRow } from "../model/rule-row.js";
import { compareSections, headingSection, policySections, sectionShas } from "../checks/sections.js";
import { POLICY_PR_PATHS, readVersion } from "./gate.js";
import { dumpStore } from "./write.js";
import { finishPolicyChange, type FinishResult } from "../propose/write-result.js";
import type { TreeReader, TreeWriter } from "./tree.js";

const FRAMEWORK_RULES = "framework/rules/rules.yaml";

/** What a person asked for on the Policies page. Org rules only; a framework rule is never edited. */
export type PolicyEdit =
  | {
    readonly kind: "add";
    /** The policy document and numbered section the clause is written in, e.g. `policies/org-policy.md`, `3.4`. */
    readonly doc: string;
    readonly section: string;
    /** The heading text when the section does not exist yet (it is then created). */
    readonly sectionTitle?: string;
    readonly statement: string;
    readonly chapter: Chapter;
    readonly level: Level;
    readonly actor: readonly Actor[];
    /** The technical wording. Absent: the statement stands in until `gov rules propose` drafts one (`needsDraft`). */
    readonly expectation?: string;
    /** YYYY-MM-DD it takes effect; absent or not later than today = today. */
    readonly effectiveFrom?: string;
  }
  | {
    readonly kind: "revise";
    readonly id: string;
    readonly statement?: string;
    readonly chapter?: Chapter;
    readonly level?: Level;
    readonly actor?: readonly Actor[];
    readonly expectation?: string;
    readonly effectiveFrom?: string;
  }
  /** Stop: the rule's open row ends with this change; no successor. */
  | { readonly kind: "close"; readonly id: string }
  /** A rule approved for a later date takes effect today: its future row ends, the same rule opens starting today. */
  | { readonly kind: "enforce-now"; readonly id: string }
  /** The statement or chapter filled or reworded in place — presentation only, a patch. */
  | { readonly kind: "annotate"; readonly id: string; readonly statement?: string; readonly chapter?: Chapter };

export interface PolicyEditInput {
  readonly base: TreeReader;
  readonly head: TreeWriter;
  readonly edit: PolicyEdit;
  /** YYYY-MM-DD — the date of the commit that carries the change. */
  readonly today: string;
  /** The organization's id scope (org_slug, upper case), e.g. `SVM`. */
  readonly scope: string;
  /** The pull request's author (GitHub login). */
  readonly author: string;
  /** The pull request. Absent: rows, prose, VERSION and snapshot are written; stamps and the CHANGELOG wait for it. */
  readonly pr?: number;
}

export interface PolicyEditResult {
  readonly ok: boolean;
  /** Why nothing was written (ok false). */
  readonly problems: readonly string[];
  /** The rule's id (issued here for an add). */
  readonly id?: string;
  /** True when the row's expectation is still its statement, for `gov rules propose` to draft. */
  readonly needsDraft: boolean;
  /** Every path written, repo-relative. */
  readonly wrote: readonly string[];
  /** The policy version this change makes. */
  readonly version?: string;
  readonly lines: readonly string[];
}

const fail = (...problems: string[]): PolicyEditResult => ({ ok: false, problems, needsDraft: false, wrote: [], lines: [] });

/** The markdown heading for a section number: `3` → `##`, `3.4` → `###`. */
const hashesFor = (section: string): string => "#".repeat(Math.min(6, section.split(".").length + 1));

/**
 * `doc` with `statement` written into §`section`: replacing `previous` where the section has it verbatim, else
 * appended as the section's last paragraph; a missing section is created (in number order) under `title`.
 */
export function writeStatementInto(doc: string, section: string, statement: string, previous?: string, title?: string): string {
  const lines = doc.split("\n");
  const sections = policySections(doc);
  const current = sections.find((s) => s.section === section);
  if (current) {
    if (previous && current.text.includes(previous)) {
      const at = doc.indexOf(current.text);
      return doc.slice(0, at) + current.text.replace(previous, statement) + doc.slice(at + current.text.length);
    }
    if (current.text.includes(statement)) return doc;
    const at = doc.indexOf(current.text);
    const body = current.text.replace(/\s*$/, "");
    const tail = current.text.slice(body.length);
    return doc.slice(0, at) + `${body}\n\n${statement}${tail || "\n"}` + doc.slice(at + current.text.length);
  }
  const block = [`${hashesFor(section)} ${section} ${title ?? "Policy"}`, "", statement, ""];
  const next = lines.findIndex((l) => { const n = headingSection(l); return n !== null && compareSections(n, section) > 0; });
  if (next < 0) return `${doc.replace(/\s*$/, "")}\n\n${block.join("\n")}`;
  return [...lines.slice(0, next), ...block, ...lines.slice(next)].join("\n");
}

/** Apply one edit to the head and finish the policy pull request around it. */
export function applyPolicyEdit(i: PolicyEditInput): PolicyEditResult {
  const { head, edit, today } = i;
  const rulesText = head.read(POLICY_PR_PATHS.rules) ?? "[]\n";
  let rows: RuleRow[];
  try { rows = parseRuleStore(rulesText); } catch (e) { return fail(`${POLICY_PR_PATHS.rules} does not parse: ${(e as Error).message}`); }
  const open = (id: string): number => rows.findIndex((r) => r.id === id && r.end === null);
  const stamp = { version: readVersion(i.base), date: today };   // placeholder: finishPolicyChange stamps the real one
  const startOn = (d?: string) => ({ ...stamp, date: d && d > today ? d : today });
  if ("chapter" in edit && edit.chapter !== undefined && !isChapter(edit.chapter)) return fail(`chapter ${String(edit.chapter)} is not 1 to 8`);
  if ("statement" in edit && edit.statement !== undefined && !edit.statement.trim()) return fail("a statement is plain-English text, not empty");

  const written = new Set<string>();
  /** Write `statement` into doc §section, refresh the sha of every open row citing it; returns the new sha. */
  const prose = (doc: string, section: string, statement: string, previous?: string, title?: string): string | null => {
    const text = head.read(doc);
    if (text === null && !doc.startsWith("policies/")) return null;
    const next = writeStatementInto(text ?? "", section, statement, previous, title);
    if (next !== text) { head.write(doc, next); written.add(doc); }
    const sha = sectionShas(next).get(section) ?? null;
    if (sha !== null) rows = rows.map((r) => (r.end === null && r.source.doc === doc && r.source.section === section ? { ...r, source: { ...r.source, sha } } : r));
    return sha;
  };

  let id: string | undefined;
  let needsDraft = false;
  switch (edit.kind) {
    case "add": {
      if (!edit.doc.startsWith("policies/")) return fail(`${edit.doc}: an organization's rule is written in a policy under policies/`);
      const sha = prose(edit.doc, edit.section, edit.statement, undefined, edit.sectionTitle);
      if (sha === null) return fail(`${edit.doc} §${edit.section} could not be written`);
      let framework: RuleRow[] = [];
      try { framework = parseRuleStore(head.read(FRAMEWORK_RULES) ?? "[]"); } catch { /* ids are issued from the org store alone */ }
      id = createIdIssuer([...new Set([...framework, ...rows].map((r) => r.id))]).next(i.scope);
      needsDraft = !edit.expectation?.trim();
      rows.push({
        id, source: { doc: edit.doc, section: edit.section, sha },
        expectation: needsDraft ? edit.statement : edit.expectation!, statement: edit.statement, chapter: edit.chapter,
        actor: [...edit.actor], level: edit.level, start: startOn(edit.effectiveFrom), end: null,
      });
      break;
    }
    case "revise": {
      const k = open(edit.id);
      if (k < 0) return fail(`${edit.id} has no open row to revise`);
      const was = rows[k]!;
      if (edit.statement !== undefined && edit.statement !== was.statement) prose(was.source.doc, was.source.section, edit.statement, was.statement);
      const cur = rows[k]!;   // its sha may have been refreshed by the prose
      needsDraft = edit.statement !== undefined && edit.expectation === undefined && cur.expectation === was.statement;
      rows[k] = { ...was, end: stamp };   // history keeps the text it was approved against
      rows.push({
        ...cur, end: null, start: startOn(edit.effectiveFrom),
        ...(edit.statement !== undefined ? { statement: edit.statement } : {}),
        ...(edit.chapter !== undefined ? { chapter: edit.chapter } : {}),
        ...(edit.level !== undefined ? { level: edit.level } : {}),
        ...(edit.actor !== undefined ? { actor: [...edit.actor] } : {}),
        ...(edit.expectation !== undefined ? { expectation: edit.expectation } : needsDraft ? { expectation: edit.statement! } : {}),
      });
      id = edit.id;
      break;
    }
    case "close": {
      const k = open(edit.id);
      if (k < 0) return fail(`${edit.id} has no open row to close`);
      rows[k] = { ...rows[k]!, end: stamp };
      id = edit.id;
      break;
    }
    case "enforce-now": {
      const k = open(edit.id);
      if (k < 0) return fail(`${edit.id} has no open row`);
      const was = rows[k]!;
      if (!(was.start.date > today)) return fail(`${edit.id} is already in force (from ${was.start.date})`);
      rows[k] = { ...was, end: stamp };
      rows.push({ ...was, start: startOn(), end: null });
      id = edit.id;
      break;
    }
    case "annotate": {
      const k = open(edit.id);
      if (k < 0) return fail(`${edit.id} has no open row`);
      rows[k] = { ...rows[k]!, ...(edit.statement !== undefined ? { statement: edit.statement } : {}), ...(edit.chapter !== undefined ? { chapter: edit.chapter } : {}) };
      id = edit.id;
      break;
    }
  }

  const next = dumpStore(rulesText, rows);
  if (next !== rulesText) { head.write(POLICY_PR_PATHS.rules, next); written.add(POLICY_PR_PATHS.rules); }
  const finished: FinishResult = finishPolicyChange({ base: i.base, head, today, author: i.author, ...(i.pr !== undefined ? { pr: i.pr } : {}) });
  for (const f of finished.wrote) written.add(f);
  return {
    ok: finished.ok, problems: finished.ok ? [] : finished.lines, id, needsDraft,
    wrote: [...written].sort(), ...(finished.version !== undefined ? { version: finished.version } : {}), lines: finished.lines,
  };
}
