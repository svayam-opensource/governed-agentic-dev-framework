// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * FINDING WHAT THE ORGANIZATION KNOWS, without deploying anything (Policy Owner, 2026-09-23, tier 0).
 *
 * The knowledge is already on every machine: `gov_repo` is a clone. What was missing was a way to read it that
 * is not `cd` and `grep` — and the policy that was removed with it demanded a portal (a site, PDF exports and a
 * vector store) that the framework never shipped, so every adopter was non-compliant on day one.
 *
 * So: search the markdown that is there. No index server, no embedding service, no secrets, no network — and
 * no new dependency: the CLI still has exactly one. It works offline, in a container, on a plane, and it cannot
 * drift from the repository, because it IS the repository.
 *
 * WHAT IT SEARCHES: org knowledge (`knowledge/`), the org's policies (`policies/`), the framework's own
 * documents (`framework/`), and every project's knowledge (`projects/<id>/knowledge/`) — the four places the
 * knowledge layers actually live.
 *
 * Everything here is pure: text in, results out. The disk, the cache and the terminal are the caller's.
 */

/** One document, as the index holds it. */
export interface Doc {
  /** Path relative to the workspace, e.g. `knowledge/architecture/decisions.md`. */
  readonly path: string;
  readonly text: string;
}

export interface Hit {
  readonly path: string;
  /** The nearest heading above the matching line — where in the document it is. */
  readonly heading: string;
  /** The matching line, trimmed. */
  readonly line: string;
  readonly lineNo: number;
  readonly score: number;
}

/** A document's headings, with the line each starts on — so a hit can say where it is. */
export function headingsOf(text: string): { readonly line: number; readonly heading: string }[] {
  const out: { line: number; heading: string }[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(l);
    if (m) out.push({ line: i + 1, heading: m[2]! });
  });
  return out;
}

const headingAt = (heads: readonly { line: number; heading: string }[], lineNo: number): string => {
  let cur = "";
  for (const h of heads) { if (h.line > lineNo) break; cur = h.heading; }
  return cur;
};

/** The first line of prose under the heading at `at` — what a section actually says. */
function firstProse(lines: readonly string[], at: number): { line: string; lineNo: number } {
  for (let j = at + 1; j < Math.min(lines.length, at + 8); j++) {
    const l = lines[j]!;
    if (!l.trim() || /^#{1,6}\s/.test(l)) continue;
    return { line: l, lineNo: j + 1 };
  }
  return { line: lines[at]!, lineNo: at + 1 };      // an empty section: the heading is all there is
}

/** The terms a query asks for: words, lower-cased. A quoted "phrase" is one term. */
export function termsOf(query: string): string[] {
  const out: string[] = [];
  for (const m of query.matchAll(/"([^"]+)"|(\S+)/g)) out.push((m[1] ?? m[2] ?? "").toLowerCase());
  return out.filter(Boolean);
}

/**
 * Rank documents against a query. EVERY term must appear somewhere in the document (a search for two words
 * should not return everything containing either), and a document scores by WHERE they appear: a heading is
 * worth more than a path, a path more than a line of prose, because that is the order in which a reader would
 * have looked.
 */
export function search(docs: readonly Doc[], query: string, limit = 20): Hit[] {
  const terms = termsOf(query);
  if (!terms.length) return [];
  const hits: Hit[] = [];

  for (const doc of docs) {
    const lower = doc.text.toLowerCase();
    const path = doc.path.toLowerCase();
    if (!terms.every((t) => lower.includes(t) || path.includes(t))) continue;   // every term, somewhere

    const heads = headingsOf(doc.text);
    const lines = doc.text.split(/\r?\n/);
    let best: Hit | null = null;
    const pathScore = terms.reduce((n, t) => n + (path.includes(t) ? 2 : 0), 0);
    // A project's own knowledge is what the person is most likely to mean when they are standing in it; the
    // caller decides that by ordering `docs`, not this function — ranking must not know about cwd.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const l = line.toLowerCase();
      const matched = terms.filter((t) => l.includes(t));
      if (!matched.length) continue;
      const isHeading = /^#{1,6}\s/.test(line);
      const score = matched.length * (isHeading ? 3 : 1) + pathScore + (matched.length === terms.length ? 2 : 0);
      if (!best || score > best.score) {
        // A HEADING match is the strongest signal of where the answer lives, and the weakest thing to print:
        // "## Restricted" only repeats what the heading column already said. So the heading locates the hit and
        // the first line of prose beneath it is what the reader gets.
        const body = isHeading ? firstProse(lines, i) : { line, lineNo: i + 1 };
        best = { path: doc.path, heading: isHeading ? line.replace(/^#{1,6}\s+/, "") : headingAt(heads, i + 1), line: body.line.trim(), lineNo: body.lineNo, score };
      }
    }
    // A document whose PATH matches but whose text does not (searching "billing" for `projects/PRJ-9-billing/`)
    // is still an answer — the best one, sometimes.
    if (!best && pathScore) best = { path: doc.path, heading: headingsOf(doc.text)[0]?.heading ?? "", line: "", lineNo: 1, score: pathScore };
    if (best) hits.push(best);
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

/** What `gov knowledge search` prints: where it is, what it says, and how to open it. */
export function formatHits(hits: readonly Hit[], query: string): string[] {
  if (!hits.length) {
    return ["", `  nothing matches '${query}'.`, "  `gov knowledge list` shows what there is.", ""];
  }
  const out = ["", `  ${hits.length} result${hits.length === 1 ? "" : "s"} for '${query}'`, ""];
  for (const h of hits) {
    out.push(`  ${h.path}${h.heading ? `  ·  ${h.heading}` : ""}`);
    if (h.line) out.push(`     ${h.line.length > 120 ? `${h.line.slice(0, 117)}…` : h.line}`);
  }
  out.push("", "  read one:  gov knowledge show <path>", "");
  return out;
}

/** The documents there are, by folder — the answer to "what is here?". */
export function formatList(docs: readonly Doc[], prefix?: string): string[] {
  const paths = docs.map((d) => d.path).filter((p) => !prefix || p.startsWith(prefix)).sort();
  if (!paths.length) return ["", `  nothing under '${prefix ?? ""}'.`, ""];
  const out = ["", `  ${paths.length} document${paths.length === 1 ? "" : "s"}${prefix ? ` under ${prefix}` : ""}`, ""];
  let group = "";
  for (const p of paths) {
    const dir = p.slice(0, p.lastIndexOf("/") + 1) || "(root)";
    if (dir !== group) { out.push(`  ${dir}`); group = dir; }
    out.push(`     ${p.slice(dir === "(root)" ? 0 : dir.length)}`);
  }
  out.push("", "  search:  gov knowledge search <text>", "");
  return out;
}

/** One document, as a person reads it in a terminal: its path, then its text. */
export function formatDoc(doc: Doc): string[] {
  return ["", `  ${doc.path}`, "", ...doc.text.split(/\r?\n/).map((l) => `  ${l}`), ""];
}

/** The machine-readable answer (`--json`), for an agent's retrieval — no vector store, no service. */
export const hitsJson = (hits: readonly Hit[], query: string): string =>
  JSON.stringify({ query, results: hits.map((h) => ({ path: h.path, heading: h.heading, line: h.line, lineNo: h.lineNo, score: h.score })) }, null, 2);
