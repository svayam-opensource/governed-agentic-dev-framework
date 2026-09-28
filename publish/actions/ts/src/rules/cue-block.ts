// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE STORED CUE AND ITS CHECK (rules-and-cues-design.md §2.3–§2.5, §4.1; step 4 of §10).
 *
 * A cue is the resident line an agent carries EVERY turn: it names the moment ("you are editing package.json"),
 * the stop condition, and the command that fetches the rest. It is drafted at AUTHORING time, approved in the
 * PR, and stored beside its clause as a marked generated block:
 *
 *     <!-- gov:cue generated clause-sha=8f2a1c4 — approved in PR #214 -->
 *     > **Always in the agent's context** · POL-210 · C02
 *     > TECHNOLOGY CHOICES ARE NOT YOURS. Before adding a dependency — run `gov knowledge search …`.
 *     <!-- gov:check kind=list-membership when=**&#47;package.json,**&#47;go.mod list=policies/x.md on_miss=fail -->
 *
 * WHY IT IS STORED AND NOT GENERATED AT RENDER TIME: an LLM in the compiler produces text that is not
 * byte-stable, so `--check` could never pass twice, `verifyAgentContext` could not tell a ratified render from a
 * drifted one, the text agents obey would appear AFTER approval, and an incident could never be reconstructed
 * because nobody could recover what the agent was actually told. The blockquote is visible on the printed page
 * on purpose: what the agent is told is part of the policy a human reviews.
 *
 * WHY THE CLAUSE HASH EXISTS (§2.5): the cue is approved once; the clause can then be reworded and nothing would
 * notice. The result is the one block guaranteed to be read silently diverging from ratified policy — POL-402's
 * false authority, in the worst possible place. So a stale cue is a POLICY ERROR, not a warning.
 *
 * Pure: text in, blocks and diagnostics out. `node:crypto` is a builtin, so gov still has exactly one dependency.
 */
import { createHash } from "node:crypto";
import { headingSection, type Clause, type Diagnostic, type DiagnosticKind, type Level } from "./notation.js";
import type { ClauseIdentity } from "./pol-lock.js";

/**
 * The predicates. Deliberately few (§4.1): an organization needing more adds its own required CI check, outside
 * gov, rather than gov growing a language.
 *
 * `content-required` is the seventh, added on EVIDENCE (2026-09-26) — which is the process this list is meant to
 * follow. Writing the org starter produced two clauses no other predicate can express: *every source file
 * carries the SPDX header* and *a new file opens with a comment saying what it is for*. `content-forbidden`
 * asserts the ABSENCE of a pattern; both of those assert a PRESENCE.
 */
export const CHECK_KINDS = [
  "naming", "path-scope", "list-membership", "content-forbidden", "content-required", "file-required",
  "frontmatter-required",
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/**
 * THE VERBS A CHECK MAY BE ATTACHED TO (PRJ-121, 2026-09-28).
 *
 * A check used to fire on one thing only: a changed file. That is right for "no unapproved dependency" — adding
 * one IS a file change — and impossible for "a project may not be closed until its learnings are written up",
 * where nothing changed and the trigger is a person running a command.
 *
 * Because it was inexpressible, that requirement was HARDCODED in `close-gate.ts`: gov insisted on a
 * `knowledge-close.md` with five exact headings whether the organization wanted it or not. Removing the
 * hardcoding without adding this trigger would not move the decision to the organization — it would delete the
 * capability, and `gov close` would close a project whose knowledge is one empty `todo.md`.
 *
 * The list is closed on purpose. A check naming a verb that is not here is a DIAGNOSTIC, never silence: an
 * unrecognised trigger that quietly never fires is the exact defect this design keeps finding.
 */
export const GATEABLE_VERBS = ["close", "merge", "task", "seed", "knowledge"] as const;
export type GateableVerb = (typeof GATEABLE_VERBS)[number];

/** What makes a check run: a changed file, or an invoked verb. */
export type Trigger =
  | { readonly on: "files"; readonly globs: readonly string[] }
  | { readonly on: "verb"; readonly verb: GateableVerb };

/**
 * The two predicates that CANNOT mean anything at a verb gate, and why.
 *
 * Both are defined over a changeset: `list-membership` asks "is every ADDED entry approved?", and
 * `content-forbidden` asks "does the CHANGED content contain this?". At the moment someone types `gov close`
 * there is no changeset, so "added" and "changed" have no referent. Left unvalidated, an organization writes
 * `kind=content-forbidden when=verb:close`, gov accepts it, and it never fires — a rule that reads as enforced
 * and is not. Refusing it at parse time costs the author one error message and saves them that.
 */
const DIFF_ONLY_KINDS: readonly CheckKind[] = ["list-membership", "content-forbidden"];

/** The line that makes a cue recognisable to a human skimming the printed policy. */
export const CUE_HEADER = "**Always in the agent's context**";

export interface Check {
  readonly kind: CheckKind;
  /** What makes it run: `when=**\/package.json,**\/go.mod` (files) or `when=verb:close` (a command). */
  readonly trigger: Trigger;
  /** Every other attribute, as written. The vocabulary differs per kind and is the validator's business. */
  readonly attrs: Readonly<Record<string, string>>;
  /**
   * What happens when the predicate does not hold. DEFAULTS TO `fail`: §2.4's third property is that absence
   * of a rule reads as permission unless you say otherwise, and a check whose `on_miss` was forgotten is
   * exactly that — a rule that reads as enforced and is not.
   */
  readonly onMiss: "fail" | "warn";
}

export interface CueBlock {
  readonly doc: string;
  /** The numbered section the cue sits in, for the message. Empty if it sits under no numbered heading. */
  readonly section: string;
  /** `POL-210`, as cited. */
  readonly pol: string;
  /**
   * The citation EXACTLY as the header writes it — `POL-011…POL-015`, not just the first number.
   *
   * A cue may summarise several clauses, and the framework's own §2.1 does. Reconstructing the heading from
   * `pol` alone silently narrowed `POL-011…POL-015` to `POL-011`, which tells an agent to look up one clause
   * when the rule spans five. Caught by diffing the re-rendered harness, which is the argument for diffing it.
   */
  readonly cite: string;
  readonly level: Level;
  /** Absent in a block written before hashes, or by hand — which `staleCues` reports, because it cannot verify. */
  readonly clauseSha?: string;
  /** Where it was ratified, e.g. `PR #214`. */
  readonly approvedIn?: string;
  /** The cue's own lines, `> ` markers stripped, joined with newlines. This is the resident text. */
  readonly cue: string;
  readonly check?: Check;
  /** 1-based line of the `<!-- gov:cue … -->` comment. */
  readonly line: number;
}

/** What `renderCueBlock` needs. A subset of {@link CueBlock}: the document and line are not part of the text. */
export interface RenderableCue {
  readonly pol: string;
  /** The citation as written — a range (`POL-011…POL-015`) survives a round trip; see `CueBlock.cite`. */
  readonly cite?: string;
  readonly level: Level;
  readonly clauseSha?: string;
  readonly approvedIn?: string;
  readonly cue: string;
  readonly check?: Check;
}

/**
 * The clause's identity as a short hash of its NORMALISED text: whitespace collapsed, ends trimmed.
 *
 * Normalising is what makes the hash usable in a markdown document that people reflow: re-wrapping a paragraph
 * at 100 columns, or a trailing space an editor stripped, changes the bytes and changes NOTHING about the rule.
 * If those counted, every reflow would report a stale cue, and a report that cries wolf on formatting is a
 * report whose real stale-cue lines get skimmed past.
 *
 * Seven hex characters of sha256 — the same reasoning as a short git sha: enough for a policy document's worth of
 * clauses, short enough to sit in a comment a human reads and compares.
 */
export const clauseSha = (text: string): string =>
  createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 7);

/** A clause, as the lockfile identifies it. The one place the two modules meet. */
export const identityOf = (clause: Clause): ClauseIdentity => ({
  doc: clause.doc, section: clause.section, clauseSha: clauseSha(clause.text),
});

/** `key=value` and `key="value with spaces"`, in the order written. */
function parseAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([a-z][a-z0-9_-]*)=(?:"([^"]*)"|(\S+))/gi)) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
}

/** A value goes back out quoted only if it must be, so the canonical form stays the form authors write. */
const renderValue = (v: string): string => (/[\s"]/.test(v) ? `"${v.replace(/"/g, "'")}"` : v);

/**
 * Read a `gov:check`'s attributes into a predicate.
 *
 * AN UNKNOWN KIND IS A DIAGNOSTIC, NEVER A THROW. A typo in one `check:` must not abort the compile of every
 * other policy document — §10.5's point is that a check nobody notices is a rule that reads as enforced and is
 * not, so the compiler's job here is to SAY SO, loudly, and keep going to find the rest.
 */
export function parseCheck(attrs: string): { check?: Check; problems: { kind: DiagnosticKind; message: string }[] } {
  const a = parseAttrs(attrs);
  const problems: { kind: DiagnosticKind; message: string }[] = [];
  const { kind, when, on_miss: onMiss, ...rest } = a;

  if (!kind) {
    problems.push({ kind: "malformed-check", message: `gov:check has no kind= — one of: ${CHECK_KINDS.join(" · ")}.` });
    return { problems };
  }
  if (!(CHECK_KINDS as readonly string[]).includes(kind)) {
    problems.push({
      kind: "unknown-check-kind",
      message: `gov:check kind=${kind} is not one of the six predicates (${CHECK_KINDS.join(" · ")}). The vocabulary stays small on purpose: an organization needing more adds its own required CI check, outside gov.`,
    });
    return { problems };
  }
  if (onMiss && onMiss !== "fail" && onMiss !== "warn") {
    problems.push({ kind: "malformed-check", message: `gov:check on_miss=${onMiss} is not fail or warn — read as fail.` });
  }

  // ── the trigger ──────────────────────────────────────────────────────────────────────────────────────────
  const parts = (when ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  const verbs = parts.filter((p) => p.startsWith("verb:"));
  let trigger: Trigger = { on: "files", globs: parts };

  if (verbs.length && verbs.length !== parts.length) {
    // One check, one moment. A mixed trigger would have to mean "on this file change OR when this command runs",
    // which are evaluated at different times against different material — and the author almost certainly meant
    // one of them. Guessing which would be the wrong kind of helpful.
    problems.push({
      kind: "malformed-check",
      message: `gov:check when=${when} mixes a verb trigger with file globs. One check, one trigger — write two checks.`,
    });
  } else if (verbs.length > 1) {
    problems.push({ kind: "malformed-check", message: `gov:check when=${when} names ${verbs.length} verbs. One check, one verb.` });
  } else if (verbs.length === 1) {
    const verb = verbs[0]!.slice("verb:".length);
    if (!(GATEABLE_VERBS as readonly string[]).includes(verb)) {
      problems.push({
        kind: "malformed-check",
        message: `gov:check when=verb:${verb} — gov has no gate on '${verb}'. Gateable verbs: ${GATEABLE_VERBS.join(" · ")}.`,
      });
    } else {
      trigger = { on: "verb", verb: verb as GateableVerb };
      if (DIFF_ONLY_KINDS.includes(kind as CheckKind)) {
        problems.push({
          kind: "malformed-check",
          message: `gov:check kind=${kind} cannot run on verb:${verb} — it is defined over a changeset ("every ADDED entry", "the CHANGED content"), and a command is not one. Attach it to file globs instead.`,
        });
      }
    }
  } else if (!parts.length) {
    // An absent `when=` is not "everything": see `filterByGlobs`. Say so, rather than leaving the author to
    // discover that their check matched nothing.
    problems.push({ kind: "malformed-check", message: "gov:check has no when= — it would match nothing. Give file globs, or verb:<name>." });
  }

  return {
    check: {
      kind: kind as CheckKind,
      trigger,
      attrs: rest,
      onMiss: onMiss === "warn" ? "warn" : "fail",
    },
    problems,
  };
}

const CUE_OPEN = /^\s*<!--\s*gov:cue\b/;
const CHECK_OPEN = /^\s*<!--\s*gov:check\b/;

/** An HTML comment that may wrap over several lines: its inner text, and the line it ends on. */
function readComment(lines: readonly string[], from: number): { inner: string; end: number } {
  let end = from;
  while (end < lines.length && !lines[end]!.includes("-->")) end++;
  const raw = lines.slice(from, Math.min(end + 1, lines.length)).join(" ");
  return { inner: raw.replace(/^\s*<!--\s*/, "").replace(/-->.*$/, "").trim(), end: Math.min(end, lines.length - 1) };
}

/**
 * Every stored cue block in a document, with what it claims to be the cue FOR.
 *
 * Deliberately LENIENT about blank lines between the comment, the blockquote and the check, and STRICT in
 * `renderCueBlock` about emitting exactly one form: a parser that only accepts what it writes turns a person's
 * harmless hand-edit into "no cue found here", which reads as *this clause has no cue* — the one conclusion that
 * must never be reached by accident.
 */
export function parseCueBlocks(doc: string, text: string): { blocks: CueBlock[]; diagnostics: Diagnostic[] } {
  const lines = text.split(/\r?\n/);
  const blocks: CueBlock[] = [];
  const diagnostics: Diagnostic[] = [];
  let section = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const heading = headingSection(line);
    if (heading) { section = heading; i++; continue; }
    if (!CUE_OPEN.test(line)) { i++; continue; }

    const at = i + 1;
    const { inner, end } = readComment(lines, i);
    const attrs = parseAttrs(inner);
    const approved = /approved in\s+([^;—\n]+?)\s*(?:;|—|$)/i.exec(inner);

    let j = end + 1;
    while (j < lines.length && !lines[j]!.trim()) j++;
    const quote: string[] = [];
    while (j < lines.length && lines[j]!.trimStart().startsWith(">")) {
      quote.push(lines[j]!.trimStart().replace(/^>\s?/, ""));
      j++;
    }
    if (!quote.length) {
      diagnostics.push({
        kind: "malformed-cue", doc, section, line: at,
        message: "a gov:cue comment with no cue beneath it: the cue is the blockquote, and it is what the agent is told. Re-draft it and have it approved.",
      });
      i = end + 1;
      continue;
    }

    const header = quote[0]!;
    const pol = /\bPOL-\d+[a-z]?\b/.exec(header)?.[0];
    // Everything between the label and the level: one number, a list, or a range, kept verbatim.
    const cite = /·\s*(.+?)\s*·\s*C0[123]/.exec(header)?.[1]?.trim() ?? pol ?? "";
    const level = /\bC0[123]\b/.exec(header)?.[0] as Level | undefined;
    if (!pol || !level) {
      diagnostics.push({
        kind: "malformed-cue", doc, section, line: at,
        message: `a cue's first line must carry its POL number and its level (\`> ${CUE_HEADER} · POL-210 · C02\`); this one reads "${header}".`,
      });
      i = j;
      continue;
    }

    let k = j;
    while (k < lines.length && !lines[k]!.trim()) k++;
    let check: Check | undefined;
    if (k < lines.length && CHECK_OPEN.test(lines[k]!)) {
      const c = readComment(lines, k);
      const parsed = parseCheck(c.inner.replace(/^gov:check\s*/, ""));
      check = parsed.check;
      for (const p of parsed.problems) diagnostics.push({ kind: p.kind, doc, section, line: k + 1, message: `${pol}: ${p.message}` });
      k = c.end + 1;
    }

    blocks.push({
      doc, section, pol, cite, level, cue: quote.slice(1).join("\n"), line: at,
      ...(attrs["clause-sha"] ? { clauseSha: attrs["clause-sha"] } : {}),
      ...(approved ? { approvedIn: approved[1]!.trim() } : {}),
      ...(check ? { check } : {}),
    });
    i = Math.max(k, j);
  }
  return { blocks, diagnostics };
}

/**
 * Cues whose clause has moved out from under them (§2.5).
 *
 * THE OWNING CLAUSE IS THE ONE DIRECTLY ABOVE — that is the whole convention, and it is why `parseClauses` skips
 * generated blocks rather than treating them as prose. A mismatch is reported as an ERROR: the alternative, a
 * warning, is a line in a build log that scrolls past while every agent in the organization keeps obeying text
 * that no longer matches ratified policy.
 *
 * A cue with NO `clause-sha` is reported too, with a different message. It is not "probably fine": it is a cue
 * whose drift cannot be detected at all, which is the state §2.5 exists to end.
 */
export function staleCues(clauses: readonly Clause[], blocks: readonly CueBlock[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const block of blocks) {
    const owner = clauses
      .filter((c) => c.doc === block.doc && c.line < block.line)
      .reduce<Clause | null>((best, c) => (!best || c.line > best.line ? c : best), null);
    if (!owner) {
      out.push({
        kind: "orphan-cue", doc: block.doc, section: block.section, line: block.line,
        message: `${block.pol}'s cue has no clause above it — a cue governs a clause; on its own it is resident text nobody ratified.`,
      });
      continue;
    }
    if (!block.clauseSha) {
      out.push({
        kind: "stale-cue", doc: block.doc, section: owner.section, line: block.line,
        message: `${block.pol}'s cue carries no clause-sha, so drift from §${owner.section} cannot be detected. Run \`gov rules build\` and have the result approved.`,
      });
      continue;
    }
    const actual = clauseSha(owner.text);
    if (actual !== block.clauseSha) {
      out.push({
        kind: "stale-cue", doc: block.doc, section: owner.section, line: block.line,
        message: `§${owner.section} changed (${block.clauseSha} → ${actual}); ${block.pol}'s cue is stale — re-draft and approve. Every agent is still being told the old text.`,
      });
    }
  }
  return out;
}

/** The canonical `gov:check` line. Attributes are ordered so the bytes depend on the check, not on typing order. */
function renderCheck(check: Check): string {
  const parts = [`kind=${check.kind}`];
  const when = check.trigger.on === "verb" ? `verb:${check.trigger.verb}` : check.trigger.globs.join(",");
  if (when) parts.push(`when=${when}`);
  // The remaining attributes are SORTED: two authors writing `list=` and `pattern=` in a different order must
  // not produce two different bytes for one rule, or `--check` fails on a diff that changes nothing.
  for (const key of Object.keys(check.attrs).sort()) parts.push(`${key}=${renderValue(check.attrs[key]!)}`);
  parts.push(`on_miss=${check.onMiss}`);
  return `<!-- gov:check ${parts.join(" ")} -->`;
}

/**
 * Emit the block exactly as it must appear in the document — ONE canonical form, byte for byte.
 *
 * `--check` compares bytes. If this function's output depended on how the input happened to be spelled, then a
 * ratified render and a drifted one would be indistinguishable, which is the failure that ruled out generating
 * cues at render time in the first place. So: fixed attribute order, one space, `> ` on every cue line, blank
 * cue lines trimmed from the ends, and no trailing newline for the caller to guess about.
 */
export function renderCueBlock(block: RenderableCue): string {
  const head = ["<!-- gov:cue generated"];
  if (block.clauseSha) head.push(`clause-sha=${block.clauseSha}`);
  if (block.approvedIn) head.push(`— approved in ${block.approvedIn}`);
  head.push("-->");

  const cueLines = block.cue.split(/\r?\n/).map((l) => l.trimEnd());
  while (cueLines.length && !cueLines[0]!.trim()) cueLines.shift();
  while (cueLines.length && !cueLines[cueLines.length - 1]!.trim()) cueLines.pop();

  const out = [head.join(" "), `> ${CUE_HEADER} · ${block.cite ?? block.pol} · ${block.level}`];
  for (const l of cueLines) out.push(l ? `> ${l}` : ">");
  if (block.check) out.push(renderCheck(block.check));
  return out.join("\n");
}
