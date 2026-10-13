// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE T8 RELOCATION EXEMPTION (PRJ-121 intent 01, spec §3.5).
 *
 * A rule store is append-only: a row is closed, never edited (gate.ts `checkAppendOnly`). Two in-place edits are
 * allowed. The first is the sha refresh (Q17, `isShaRefresh`). The second is this one: the file a row cites MOVED,
 * and nothing it says changed. A move is how the framework rearranges its tree after 2.0.0 without a major version,
 * so this is a feature of the store, not a migration.
 *
 * A row `now` is the row `was` relocated when ALL of these hold:
 *
 *   - both are open;
 *   - they differ only in `source.doc`, `source.section`, `source.sha` and path-valued `with:` params of their
 *     checks — every other byte is the same;
 *   - each changed path is a DECLARED relocation: a move the upgrade recorded (`framework/upgrade-moves.json`,
 *     a file or a directory), or a specification split that gov itself names ({@link SPEC_SPLITS});
 *   - a split renumbers the chapter by its map and keeps the minor numbers (`4.2` → `1.2`); a plain move keeps
 *     the section number;
 *   - the section's body — normalised like a section sha, WITHOUT its heading line (a renumbered heading is not a
 *     change) — is the same text in the old document and the new one, and each row's sha is its section's sha
 *     in its own document.
 *
 * Pure: the documents come through `readDoc`.
 */
import { clauseSha, policySections } from "../checks/sections.js";
import type { RuleRow } from "../model/rule-row.js";
import type { TreeReader } from "./tree.js";
import { MOVE_RECORD_PATH } from "../../maintain/upgrade-sync.js";

/**
 * One declared relocation. `from` / `to` are repo-relative; a directory ends with `/` and carries every file under
 * it. `sections` (a split only) maps a chapter number of the old document to its number in the new one; a chapter
 * absent from the map did not go to this document. No map: every section keeps its number.
 */
export interface Relocation {
  readonly from: string;
  readonly to: string;
  readonly sections?: Readonly<Record<string, string>>;
}

/** Which side of the change a document is read from: `was` the base, `now` the head. */
export type DocSide = "was" | "now";
export type ReadDoc = (path: string, side: DocSide) => string | null;

/** The framework specification as one file, before the split (spec §3.5). */
export const SPEC_BEFORE_SPLIT = "framework/docs/specs/framework-specification.md";
/** Where its chapters went: the parent keeps its numbers; the build chapters 4, 5, 6, 8 become 1–4. */
export const SPEC_PARENT = "framework/framework-specification.md";
export const SPEC_BUILD = "framework/build/build-specification.md";
export const SPEC_BUILD_CHAPTERS: Readonly<Record<string, string>> = { 4: "1", 5: "2", 6: "3", 8: "4" };
const PARENT_CHAPTERS: Readonly<Record<string, string>> = Object.fromEntries(
  ["1", "2", "3", "7", "9", "10", "11", "12"].map((c) => [c, c]));

/** The specification splits gov knows. A split is declared here, in gov, never by the org's tree. */
export const SPEC_SPLITS: readonly Relocation[] = [
  { from: SPEC_BEFORE_SPLIT, to: SPEC_PARENT, sections: PARENT_CHAPTERS },
  { from: SPEC_BEFORE_SPLIT, to: SPEC_BUILD, sections: SPEC_BUILD_CHAPTERS },
];

/** Where `path` lands under `m`, or null when `m` does not carry it. */
export function relocatedPath(path: string, m: Relocation): string | null {
  if (m.from.endsWith("/")) return path.startsWith(m.from) ? `${m.to.endsWith("/") ? m.to : `${m.to}/`}${path.slice(m.from.length)}` : null;
  return path === m.from ? m.to : null;
}

/** The number `section` takes under `m`: the chapter mapped, the minor numbers kept. Null: not this document's. */
export function relocatedSection(section: string, m: Relocation): string | null {
  if (!m.sections) return section;
  const [chapter, ...rest] = section.split(".");
  const to = m.sections[chapter!];
  return to === undefined ? null : [to, ...rest].join(".");
}

/** Is `to` the path `from` reached by one of `moves`? */
const movedTo = (from: string, to: string, moves: readonly Relocation[]): boolean =>
  from !== to && moves.some((m) => relocatedPath(from, m) === to);

/** A section's text without its heading line, normalised as a section sha is — or null when it is not there. */
export function sectionBody(text: string, section: string): { body: string; sha: string } | null {
  const s = policySections(text).find((x) => x.section === section);
  if (!s) return null;
  const lines = s.text.split(/\r?\n/);
  return { body: lines.slice(1).join("\n").replace(/\s+/g, " ").trim(), sha: clauseSha(s.text) };
}

/** A row as one canonical string, keys sorted, so two rows compare by value. */
function canon(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}

/** A `with:` value changed only by a declared move: equal, or a path (or a list of paths) each relocated. */
function sameOrMoved(a: unknown, b: unknown, moves: readonly Relocation[]): boolean {
  if (canon(a) === canon(b)) return true;
  if (typeof a === "string" && typeof b === "string") return movedTo(a, b, moves);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameOrMoved(x, b[i], moves));
  return false;
}

/** The checks match but for path-valued `with:` params that a declared move explains. */
function checksRelocated(was: RuleRow, now: RuleRow, moves: readonly Relocation[]): boolean {
  const a = was.checks ?? [], b = now.checks ?? [];
  if (a.length !== b.length) return false;
  return a.every((c, i) => {
    const d = b[i]!;
    if (canon({ ...c, with: undefined }) !== canon({ ...d, with: undefined })) return false;
    const wa = c.with ?? {}, wb = d.with ?? {};
    const keys = new Set([...Object.keys(wa), ...Object.keys(wb)]);
    return [...keys].every((k) => k in wa && k in wb && sameOrMoved(wa[k], wb[k], moves));
  });
}

/** The source moved under a declared relocation, the section renumbered as that relocation says. */
function sourceRelocated(was: RuleRow, now: RuleRow, moves: readonly Relocation[]): boolean {
  return moves.some((m) => relocatedPath(was.source.doc, m) === now.source.doc && relocatedSection(was.source.section, m) === now.source.section);
}

/** The cited section reads the same in both documents, heading aside, and each row's sha is its own section's. */
function sameBody(was: RuleRow, now: RuleRow, readDoc: ReadDoc): boolean {
  const a = readDoc(was.source.doc, "was"), b = readDoc(now.source.doc, "now");
  if (a === null || b === null) return false;
  const x = sectionBody(a, was.source.section), y = sectionBody(b, now.source.section);
  return !!x && !!y && x.sha === was.source.sha && y.sha === now.source.sha && x.body === y.body;
}

/**
 * Is `now` the row `was` relocated — the one in-place edit a declared move or a specification split allows?
 * See the file comment for the conditions. Identical rows are not a relocation.
 */
export function isRelocation(was: RuleRow, now: RuleRow, moves: readonly Relocation[], readDoc: ReadDoc): boolean {
  if (was.end !== null || now.end !== null) return false;
  if (canon(was) === canon(now)) return false;
  const rest = (r: RuleRow): string => canon({ ...r, source: undefined, checks: undefined });
  if (rest(was) !== rest(now)) return false;
  if (!checksRelocated(was, now, moves)) return false;
  if (canon(was.source) === canon(now.source)) return true; // only a `with:` path moved; the cited text did not
  if (was.source.doc === now.source.doc) return false; // a section renumbered in place is a revision, not a move
  return sourceRelocated(was, now, moves) && sameBody(was, now, readDoc);
}

/**
 * The relocations a head tree declares: every move its record names (`framework/upgrade-moves.json` — `{ move }`
 * objects or the bare `"<from> → <to>"` strings), and gov's own {@link SPEC_SPLITS}. Pure over the tree.
 */
export function declaredRelocations(head: TreeReader): Relocation[] {
  const out: Relocation[] = [...SPEC_SPLITS];
  const text = head.read(MOVE_RECORD_PATH);
  if (text === null) return out;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return out; /* a record that does not parse declares no move: an in-place edit is then refused */ }
  if (!Array.isArray(raw)) return out;
  for (const e of raw) {
    const id = typeof e === "string" ? e : e && typeof e === "object" && typeof (e as { move?: unknown }).move === "string" ? (e as { move: string }).move : null;
    const m = id === null ? null : /^(.+?) → (.+)$/.exec(id);
    if (m) out.push({ from: m[1]!.trim(), to: m[2]!.trim() });
  }
  return out;
}

/** The `readDoc` over a pull request's two trees: `was` from the base, `now` from the head. */
export const readDocFrom = (base: TreeReader, head: TreeReader): ReadDoc =>
  (path, side) => (side === "was" ? base : head).read(path);
