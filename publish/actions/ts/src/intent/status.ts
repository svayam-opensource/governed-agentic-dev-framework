// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT gov WRITES INTO AN ARTIFACT (PRJ-121 intent 03, D2, spec §2.1/§2.3).
 *
 * - The Status line, replaced in place: every other byte of the file is left as it was.
 * - STALE: a spec changed after its plan was approved re-opens SPEC and marks the plan stale (§2.1 re-entry).
 *   The caller supplies the two instants (the plan's approval, the spec's last change); this is a pure compare.
 * - The forward link: when a `releases/<unit>/<version>/deploy.md` names this project and intent in its
 *   "Included intents" table, `build.md`'s "Shipped in" section lists `releases/<unit>/<version>`.
 *
 * Pure except {@link releasesNaming}, which reads through an injected tree.
 */
import { fail, ok, type Result } from "../ports/result.js";
import type { TreeReader } from "./scan.js";

const FENCE = /^\s*(```|~~~)/;
const STATUS_LINE = /^\*\*Status\b/;

/** Split keeping each line's own ending, so a rewrite can leave CRLF files CRLF. */
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
const ending = (line: string): string => (line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "");

/** Replace the artifact's first Status line (outside code fences) with `line`. No Status line → refused. */
export function replaceStatusLine(text: string, line: string): Result<string> {
  const ls = lines(text);
  let fence = false;
  for (let i = 0; i < ls.length; i++) {
    if (FENCE.test(ls[i])) { fence = !fence; continue; }
    if (!fence && STATUS_LINE.test(ls[i])) {
      ls[i] = line + ending(ls[i]);
      return ok(ls.join(""));
    }
  }
  return fail("the artifact has no **Status** line to replace");
}

export const staleStatusLine = (why: string): string => `**Status: STALE (${why})**`;

const instant = (iso: string, what: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`${what}: not a time: ${JSON.stringify(iso)}`);
  return t;
};
const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

export type Staleness = { readonly stale: false } | { readonly stale: true; readonly why: string };

/** A plan is stale when its spec changed AFTER the plan was approved. An unapproved plan is never stale. */
export function planStaleness(i: { readonly planApprovedAt: string | null; readonly specChangedAt: string }): Staleness {
  if (i.planApprovedAt === null) return { stale: false };
  const approved = instant(i.planApprovedAt, "plan approval time");
  const changed = instant(i.specChangedAt, "spec change time");
  if (changed <= approved) return { stale: false };
  return { stale: true, why: `spec changed ${day(changed)} after the plan was approved ${day(approved)}` };
}

export interface IncludedIntent { readonly project: string; readonly intent: string; readonly issues: string }

/** `##` sections outside fences: heading → [start line index of body, end exclusive]. */
function sectionSpan(ls: readonly string[], heading: string): { start: number; end: number } | null {
  let fence = false;
  let start = -1;
  for (let i = 0; i < ls.length; i++) {
    if (FENCE.test(ls[i])) { fence = !fence; continue; }
    if (fence || !ls[i].startsWith("## ")) continue;
    if (start >= 0) return { start, end: i };
    if (ls[i].slice(3).trim() === heading) start = i + 1;
  }
  return start >= 0 ? { start, end: ls.length } : null;
}

const cell = (c: string): string => c.trim().replace(/^\[([^\]]*)\]\([^)]*\)$/, "$1").replace(/^`(.*)`$/, "$1").trim();

/** Rows of a deploy.md "Included intents" table. Template placeholders (`<PRJ>`) are not rows. */
export function includedIntents(deployText: string): IncludedIntent[] {
  const ls = lines(deployText);
  const span = sectionSpan(ls, "Included intents");
  if (!span) return [];
  const out: IncludedIntent[] = [];
  let header = true;
  for (const raw of ls.slice(span.start, span.end)) {
    const l = raw.trim();
    if (!l.startsWith("|")) continue;
    const cells = l.replace(/^\||\|$/g, "").split("|").map(cell);
    if (header) { header = false; continue; }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const [project = "", intent = "", issues = ""] = cells;
    if (!project || !intent || project.startsWith("<") || intent.startsWith("<")) continue;
    out.push({ project, intent, issues });
  }
  return out;
}

/** Every `releases/<unit>/<version>` whose deploy.md names `project` + `intent`, sorted. */
export async function releasesNaming(tree: TreeReader, project: string, intent: string): Promise<string[]> {
  const out: string[] = [];
  for (const unit of (await tree.list("releases")) ?? []) {
    for (const version of (await tree.list(`releases/${unit}`)) ?? []) {
      const dir = `releases/${unit}/${version}`;
      const text = await tree.read(`${dir}/deploy.md`);
      if (text !== null && includedIntents(text).some((r) => r.project === project && r.intent === intent)) out.push(dir);
    }
  }
  return out.sort();
}

/**
 * Fill build.md's "Shipped in" with one `- \`releases/<unit>/<version>\`` bullet per release, keeping any already
 * listed and dropping the template placeholder. Idempotent; the rest of the file is byte-identical.
 */
export function fillShippedIn(buildText: string, releases: readonly string[]): Result<string> {
  const ls = lines(buildText);
  const span = sectionSpan(ls, "Shipped in");
  if (!span) return fail('build.md has no "## Shipped in" section');
  const body = ls.slice(span.start, span.end);
  const eol = ending(ls[span.start - 1]) || "\n";
  const bullet = (r: string): string => `- \`${r}\``;
  // A "<…>" line is the template's placeholder (an HTML comment is not); it goes once a release is listed.
  const kept = body.filter((l) => l.trim() !== "" && !(l.trim().startsWith("<") && !l.trim().startsWith("<!--")));
  const have = new Set(kept.map((l) => l.trim()));
  const added = releases.filter((r) => !have.has(bullet(r))).map((r) => bullet(r) + eol);
  if (!added.length) return ok(buildText);
  // Keep the section's trailing blank lines (the gap before the next heading).
  let tail = body.length;
  while (tail > 0 && body[tail - 1].trim() === "") tail--;
  const next = [...kept.map((l) => (ending(l) ? l : l + eol)), ...added, ...body.slice(tail)];
  return ok([...ls.slice(0, span.start), ...next, ...ls.slice(span.end)].join(""));
}
