// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE NOTATION: PROSE IN, LEVELS OUT (rules-and-cues-design.md §2, step 1 of §10).
 *
 * An organization writes numbered prose and nothing else — no YAML, no rule ids, no generated file it is
 * expected to edit. The ALL-CAPS modal verb in the clause IS the governance level, declared by the author:
 *
 *     MUST · MUST NOT · SHALL · SHALL NOT → C01      MAY → C02      CAN → C03
 *
 * This deliberately diverges from RFC 2119 (where MAY means optional); the table above is the normative one and
 * appears at the top of the framework policy so an auditor cannot misread MAY as permission.
 *
 * WHY THIS IS THE FIRST THING BUILT: it answers a number neither the Policy Owner nor an agent can guess —
 * *how much of the policy we already have is actually governed*. "§4 has 11 clauses, 7 governed, 4 with no
 * level" turns laxity into something a person can see and decide about. Silently dropping an unlevelled clause
 * would not, which is why rule 6 (no modal → ungoverned, reported, never an error) exists.
 *
 * THE MATCH IS CASE-SENSITIVE AND WORD-BOUNDED, and that is the whole defence against false positives: a policy
 * document is full of the word "must" in ordinary prose ("this must be read alongside…"), and every one of those
 * would otherwise become a C01 rule with a POL number, a cue in every agent's resident context, and a CI check.
 *
 * Everything here is pure: text in, clauses and diagnostics out. The disk and the terminal are the caller's.
 */

/** The three levels. The modal verb declares it; nothing else does. */
export type Level = "C01" | "C02" | "C03";

/**
 * What the compiler refuses to guess about. Every one is an ERROR that fails `gov rules build`; the ungoverned
 * clause list (rule 6) is deliberately NOT in here, because unlevelled prose is legitimate.
 */
export type DiagnosticKind =
  /** rule 2 — two different modals in one clause: two levels, one POL number. Split it. */
  | "split-clause"
  /** rule 4 — `MAY NOT` reads as prohibition in English, not as C02 permission. */
  | "may-not-ambiguous"
  /** rule 5 — `SHOULD` is not a level here, and authors reach for it out of habit. */
  | "should-unsupported"
  /** ADDED (not in §2.2): a requirement outside any numbered section, which cannot be cited or locked. */
  | "unsectioned-requirement"
  /** §2.5 — a cue whose clause has been reworded since it was approved. A policy error, not a warning. */
  | "stale-cue"
  /** §2.5 — a stored cue block with no clause above it to be the cue FOR. */
  | "orphan-cue"
  /** §2.3 — a `gov:cue` block whose header carries no POL number or no level. */
  | "malformed-cue"
  /** §4.1 — a `gov:check` naming a predicate outside the six. */
  | "unknown-check-kind"
  /** §4.1 — a `gov:check` whose attributes cannot be read. */
  | "malformed-check"
  /**
   * RULE 7 — a rule whose ACTOR cannot be found (2026-09-28).
   *
   * Not an error: a warning, and the reason it exists is measurable. A classifier over the framework's own
   * policy could not place 47% of clauses, because they use a pronoun — *"It MUST commit nothing, to any
   * branch"* — with the subject in a previous sentence. If a parser cannot find the actor, neither can a reader
   * skimming for "is this about me?", and neither can an agent deciding whether a rule governs what it is
   * about to do. Naming the actor also makes the enforcement class derivable rather than guessed: a clause
   * whose actor is `gov` describes the program, so editing its prose changes nothing.
   */
  | "actor-unnamed";

export interface Diagnostic {
  readonly kind: DiagnosticKind;
  /** The policy document, as the caller names it (e.g. `policies/approved-technologies.md`). */
  readonly doc: string;
  /** The numbered section the clause is in, e.g. `4.2`. Empty when there is none — which is itself the fault. */
  readonly section: string;
  /** 1-based line in `doc`, so the message can be clicked. */
  readonly line: number;
  /** Addressed to the author, and it always says what to do instead. */
  readonly message: string;
}

/** One paragraph (or list item) of a numbered section, classified. */
/** Who the clause is about. `unknown` is what rule 7 reports. */
export type Actor = "gov" | "agent" | "person" | "unknown";

/**
 * Find the actor a clause names.
 *
 * Deliberately conservative about `person`: an organization writes about roles it invented, so the list cannot
 * be closed, and a clause naming no actor gets `unknown` rather than a guess. A wrong actor would be worse than
 * none — it decides the enforcement class, and `implemented` tells a reader "your words change nothing here".
 */
export function actorOf(text: string): Actor {
  const t = text.replace(/`[^`]*`/g, " ").toLowerCase();
  // gov first: "gov MUST refuse" is about the program even when an agent is mentioned in the same clause.
  if (/\bgov\b|\bthe framework\b|\bthe compiler\b|\bthe renderer\b/.test(t)) return "gov";
  if (/\ban agent\b|\bagents\b|\bthe agent\b|\bevery agent\b|\bno agent\b/.test(t)) return "agent";
  if (/\bthe (policy owner|requester|owner|organization|developer|human|assignee|approver)\b|\ba human\b|\bhumans\b|\brepresentatives?\b/.test(t)) return "person";
  return "unknown";
}

export interface Clause {
  readonly doc: string;
  /** `4.2`, from the heading above it. */
  readonly section: string;
  /** 1-based position within its section — stable while the section's text is stable. */
  readonly ordinal: number;
  /** 1-based line where the clause starts. */
  readonly line: number;
  /** The clause as written, newlines kept. Hashing normalises; display truncates. */
  readonly text: string;
  /**
   * The canonical modal token found first, e.g. `MUST NOT`. Present but with NO `level` when the modal was
   * rejected (`MAY NOT`, `SHOULD`): that clause is not governed, and it is also not "prose with no modal" —
   * the author tried to state a level and the compiler would not guess. The report keeps the two apart.
   */
  readonly modal?: string;
  readonly level?: Level;
  /** True only when a modal mapped to a level. `!governed` covers rejected modals AND rule 6 prose. */
  readonly governed: boolean;
  /** Rule 7: who the clause is about. `unknown` is reported, never guessed at. */
  readonly actor: Actor;
}

export interface ParseResult {
  readonly doc: string;
  readonly clauses: readonly Clause[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * ORDER IS LOAD-BEARING, TWICE OVER.
 *
 * 1. `MAY NOT` and `SHOULD NOT` come before the bare `MAY` / `SHOULD`, and `MUST NOT` before `MUST`. A regex
 *    alternation is tried left to right at each position, so the longest reading wins there and nowhere else:
 *    put `MAY` first and "MAY NOT" compiles to a C02 PERMISSION — the exact misreading rule 4 exists to stop.
 * 2. `\s+` between the words, not a space: a clause wraps across lines, and `MAY\nNOT` is still `MAY NOT`.
 */
const MODAL_RE = /\b(?:MUST\s+NOT|SHALL\s+NOT|MAY\s+NOT|SHOULD\s+NOT|MUST|SHALL|MAY|CAN|SHOULD)\b/g;

/** The modal vocabulary: what each canonical token means, or why it is refused. */
const MODALS: Readonly<Record<string, { readonly level?: Level; readonly reject?: DiagnosticKind }>> = {
  // Rule 3: negation keeps the level. A prohibition is how C01 is actually written.
  "MUST": { level: "C01" },
  "MUST NOT": { level: "C01" },
  "SHALL": { level: "C01" },
  "SHALL NOT": { level: "C01" },
  "MAY": { level: "C02" },
  "CAN": { level: "C03" },
  "MAY NOT": { reject: "may-not-ambiguous" },
  "SHOULD": { reject: "should-unsupported" },
  "SHOULD NOT": { reject: "should-unsupported" },
};

const REJECTION: Readonly<Record<string, string>> = {
  "may-not-ambiguous":
    'MAY NOT is refused: in English it reads as prohibition, not as C02 permission, and the compiler will not guess. Write MUST NOT (C01), or "is not required to".',
  "should-unsupported":
    "SHOULD is not a level here: use MAY (C02 — always applies, a deviation needs an approved exception) or CAN (C03 — apply intelligently, record the deviation).",
};

/**
 * Every modal in a clause, canonicalised (`MAY\n NOT` → `MAY NOT`), in the order written, without repeats.
 *
 * INLINE CODE IS A MENTION, NOT A USE, and this is not hypothetical: §1.3 of the framework's own policy is the
 * list of these very rules — *"`MAY NOT` is rejected. In English it usually means prohibition…"*. Read naively,
 * the document that DEFINES the notation reports a split-clause, a may-not-ambiguous and a should-unsupported
 * error against itself, and the exemplar an adopter copies is the one document that cannot compile. Same
 * reasoning as the skipped fences and tables: a policy has to be able to talk about its own vocabulary.
 */
function modalsIn(clauseText: string): string[] {
  const text = clauseText.replace(/`[^`\n]*`/g, " ");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(MODAL_RE)) {
    const token = m[0].replace(/\s+/g, " ");
    if (!seen.has(token)) { seen.add(token); out.push(token); }
  }
  return out;
}

/**
 * The section number a heading declares, or null. `### 4.2 Approved technologies` → `4.2`; `## 7. Data` → `7`
 * (the trailing dot is typography, not part of the number a person cites).
 */
export function headingSection(line: string): string | null {
  const h = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
  if (!h) return null;
  const num = /^(\d+(?:\.\d+)*)\.?(?=\s|$)/.exec(h[2]!);
  return num ? num[1]! : null;
}

/** A heading's depth (`###` → 3), or 0 if the line is not a heading. */
function headingDepth(line: string): number {
  const h = /^(#{1,6})\s+\S/.exec(line);
  return h ? h[1]!.length : 0;
}

const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** A markdown table: its rows are a vocabulary or a matrix, never a clause. See the note in `blockKind`. */
const isTableBlock = (lines: readonly string[]): boolean =>
  lines.length >= 2 && lines.every((l) => l.trimStart().startsWith("|"));

/**
 * WHAT IS NOT A CLAUSE — each exclusion is a false positive that was going to happen.
 *
 * - **A `gov:cue` / `gov:check` block.** The cue is generated text, stored beside its clause and deliberately
 *   written in ALL-CAPS imperatives ("TECHNOLOGY CHOICES ARE NOT YOURS"). Parsed as a clause it would compile
 *   the machine's own output into a second rule, and its `· C02` header would read as the level of a clause
 *   nobody wrote. Any HTML comment is skipped with it: an author's aside is not policy.
 * - **A blockquote.** The stored cue IS a blockquote, and when a blank line separates it from its comment that
 *   is all there is to recognise it by. Quoted material is somebody else's words either way.
 * - **A table.** §2.1's own modal table — `| MUST · MUST NOT | C01 |` — is REQUIRED to appear at the top of
 *   every policy document. Read as a clause it carries four modals at three levels, so the first thing the
 *   compiler would report about the exemplar document is a split-clause error in the normative table.
 */
function blockKind(lines: readonly string[]): "clause" | "skip" {
  const first = lines[0]!.trimStart();
  if (first.startsWith("<!--")) return "skip";
  if (lines.every((l) => l.trimStart().startsWith(">"))) return "skip";
  if (isTableBlock(lines)) return "skip";
  return "clause";
}

/**
 * A paragraph that is a list becomes ONE CLAUSE PER ITEM. Policies are written in lists, and rule 2 is about a
 * clause carrying two levels — not about a section carrying several one-level bullets. Joined into a single
 * clause, an ordinary five-bullet list of requirements would report as a split-clause error and no bullet could
 * hold a POL number of its own.
 */
function itemsOf(lines: readonly string[], startLine: number): { text: string; line: number }[] {
  const firstItem = LIST_ITEM_RE.exec(lines[0]!);
  if (!firstItem) return [{ text: lines.join("\n"), line: startLine }];
  const indent = firstItem[1]!.length;
  const out: { text: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = LIST_ITEM_RE.exec(l);
    // A nested bullet or a wrapped line belongs to the item above it — same clause, so the level it states is
    // read together with the sentence that introduced it.
    if (m && m[1]!.length === indent) out.push({ text: m[3]!, line: startLine + i });
    else if (out.length) out[out.length - 1] = { ...out[out.length - 1]!, text: `${out[out.length - 1]!.text}\n${l}` };
    else out.push({ text: l, line: startLine + i });
  });
  return out;
}

/** The paragraph-shaped pieces of a document, each with the numbered section it sits in. */
function blocksOf(text: string): { section: string; startLine: number; lines: string[] }[] {
  const lines = text.split(/\r?\n/);
  const blocks: { section: string; startLine: number; lines: string[] }[] = [];
  let section = "";
  let sectionDepth = 0;
  let cur: string[] = [];
  let curStart = 0;
  const flush = (): void => {
    if (cur.length) blocks.push({ section, startLine: curStart, lines: cur });
    cur = [];
  };

  let i = 0;
  // Front matter is metadata (`domain:`, `compliance:`) and would otherwise parse as the document's first clause.
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]!.trim() !== "---") i++;
    i++;
  }

  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const fence = /^(```|~~~)/.exec(trimmed);
    if (fence) {
      // A fenced block is a sample, a mermaid diagram or a shell transcript. `MUST` inside an example of the
      // notation is an example OF the notation, not an instance of it.
      flush();
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) i++;
      continue;
    }
    const depth = headingDepth(raw);
    if (depth) {
      flush();
      const num = headingSection(raw);
      if (num) { section = num; sectionDepth = depth; }
      else if (depth <= sectionDepth) {
        // An UNNUMBERED heading at the same level or shallower ends the numbered section; a deeper one (`#### Why`
        // under `### 4.2`) does not. The alternative — any unnumbered heading clearing the section — silently
        // drops every clause written under a sub-heading, and rule 6's whole point is that nothing is silent.
        section = "";
        sectionDepth = depth;
      }
      continue;
    }
    if (!trimmed) { flush(); continue; }
    if (!cur.length) curStart = i + 1;
    cur.push(raw);
  }
  flush();
  return blocks;
}

/**
 * Parse one policy document into clauses, and report what the compiler will not guess about.
 *
 * `doc` is the document's name as citations and the report should print it — the workspace-relative path.
 */
export function parseClauses(doc: string, text: string): ParseResult {
  const clauses: Clause[] = [];
  const diagnostics: Diagnostic[] = [];
  const ordinals = new Map<string, number>();

  for (const block of blocksOf(text)) {
    if (blockKind(block.lines) === "skip") continue;
    for (const item of itemsOf(block.lines, block.startLine)) {
      const modals = modalsIn(item.text);

      // A requirement OUTSIDE a numbered section (§2 makes a clause "a paragraph inside a numbered section").
      // Not one of the six rules: added because the alternative is the failure the design fears most — governed
      // prose that the compiler cannot see, and therefore cannot number, cue, check or report as ungoverned.
      if (!block.section) {
        const levelled = modals.find((m) => MODALS[m]?.level);
        if (levelled) {
          diagnostics.push({
            kind: "unsectioned-requirement", doc, section: "", line: item.line,
            message: `${levelled} outside a numbered section: give the section a number (\`### 4.2 …\`) so the clause can be allocated a POL number and cited.`,
          });
        }
        continue;
      }

      const ordinal = (ordinals.get(block.section) ?? 0) + 1;
      ordinals.set(block.section, ordinal);

      // Rule 2, ON LEVELS RATHER THAN MODALS (corrected 2026-09-26 by running it over the corpus).
      //
      // The rule was first implemented as "two different modals is an error", which is what the notation's
      // prose says. Run against the framework's own rewritten policy it produced 12 split-clause errors, and
      // 10 of them were pairs at the SAME level — `MUST … MUST NOT …` (§4.2, §6.2, §6.5, §9.9) or
      // `MUST … SHALL NOT …` (§2.2, §4.3, §5.3, §7.3, §8.5, §9.6). Each already carried one POL number,
      // because a prohibition stated alongside the obligation it qualifies IS one rule at one level: "the id
      // MUST be issued by seed, and MUST NOT be assigned by hand" is a single clause an author would never
      // think to split, and splitting it would leave two POL numbers nobody cites separately.
      //
      // What cannot share a clause is two LEVELS: `MAY … SHALL NOT …` compiles to one number at C02 and one
      // at C01, and neither the POL number nor the cue can say which half it means. Only §9.5 and §10.1 were
      // that, and both are genuine defects the author should fix.
      //
      // So: the diagnostic fires on distinct levels. As written before, `gov rules build` failed on the
      // exemplar that defines the notation — which is the kind of rule that gets switched off rather than
      // obeyed.
      const levels = [...new Set(modals.map((m) => MODALS[m]?.level).filter((l): l is Level => Boolean(l)))];
      if (levels.length > 1) {
        diagnostics.push({
          kind: "split-clause", doc, section: block.section, line: item.line,
          message: `two levels in one clause (${modals.join(", ")} → ${levels.join(", ")}) — one clause, one level: split it so each has its own clause and POL number.`,
        });
      }
      // Rule 7 — a RULE must name its actor. Unlevelled prose is exempt: it is not a rule, so there is nobody
      // for it to be about. Reported as a warning-shaped diagnostic rather than an error, because the framework's
      // own policy has 90-odd clauses to fix and a hard failure would mean nobody could build until they were all
      // done — which is how a good rule gets switched off.
      if (levels.length === 1 && actorOf(item.text) === "unknown") {
        diagnostics.push({
          kind: "actor-unnamed", doc, section: block.section, line: item.line,
          message: "this clause states a rule but names no actor. Say who it is about — `gov`, `an agent`, or a "
            + "named role — so a reader (and an agent, and the classifier) can tell whether it applies to them. "
            + "A pronoun whose subject is in a previous sentence is what this rule exists to catch.",
        });
      }
      // Every rejected modal is reported wherever it appears, not only when it comes first: a clause reading
      // "MUST do X and MAY NOT do Y" has both faults and the author should hear about both.
      for (const m of modals) {
        const kind = MODALS[m]?.reject;
        if (kind) diagnostics.push({ kind, doc, section: block.section, line: item.line, message: REJECTION[kind]! });
      }

      // Rule 6: no modal is NOT an error. The clause is kept, ungoverned, and listed in the report.
      const modal = modals[0];
      const level = levels[0];
      clauses.push({
        doc, section: block.section, ordinal, line: item.line, text: item.text,
        ...(modal ? { modal } : {}), ...(level ? { level } : {}), governed: Boolean(level), actor: actorOf(item.text),
      });
    }
  }
  return { doc, clauses, diagnostics };
}

/** One line of a clause, short enough for a list: whitespace collapsed, cut at `max`. */
export function snippet(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const countBy = (clauses: readonly Clause[], level: Level): number => clauses.filter((c) => c.level === level).length;

/**
 * THE COMPILE REPORT — the artifact step 1 exists to produce (§10.1).
 *
 * Per document: how many clauses, how many governed and at which levels, how many not. Then every notation
 * error, each locating itself by document · section · line. Then the ungoverned list, because a count alone
 * ("4 clauses with no level") tells a Policy Owner nothing they can act on — the four sentences do.
 *
 * `ungoverned` in the COUNTS means "carries no level", so `clauses = governed + ungoverned` always holds. The
 * LIST beneath it holds only clauses with no modal at all: a rejected `MAY NOT` or `SHOULD` is already an error
 * above, with a message, and printing it twice teaches the reader to skim the section that matters.
 */
export function formatReport(results: readonly ParseResult[]): string[] {
  if (!results.length) return ["", "  no policy documents scanned.", ""];

  const clauses = results.flatMap((r) => r.clauses);
  const diagnostics = results.flatMap((r) => r.diagnostics);
  const governed = clauses.filter((c) => c.governed);
  const out = [
    "",
    `  ${results.length} document${results.length === 1 ? "" : "s"} · ${clauses.length} clause${clauses.length === 1 ? "" : "s"} · ${governed.length} governed · ${clauses.length - governed.length} ungoverned`,
    "",
  ];

  for (const r of results) {
    const g = r.clauses.filter((c) => c.governed);
    out.push(`  ${r.doc}`);
    out.push(
      `     ${r.clauses.length} clauses, ${g.length} governed (C01 ${countBy(r.clauses, "C01")} · C02 ${countBy(r.clauses, "C02")} · C03 ${countBy(r.clauses, "C03")}), ${r.clauses.length - g.length} ungoverned`,
    );
  }

  if (diagnostics.length) {
    out.push("", `  notation errors (${diagnostics.length})`, "");
    for (const d of diagnostics) {
      out.push(`     ${d.doc} §${d.section || "-"}:${d.line}  ${d.kind}`);
      out.push(`        ${d.message}`);
    }
  }

  const ungoverned = clauses.filter((c) => !c.modal);
  if (ungoverned.length) {
    out.push("", `  ungoverned clauses (${ungoverned.length}) — prose with no modal: legitimate, or a requirement nobody levelled`, "");
    let group = "";
    for (const c of ungoverned) {
      if (c.doc !== group) { out.push(`     ${c.doc}`); group = c.doc; }
      out.push(`        §${c.section}:${c.line}  ${snippet(c.text)}`);
    }
  }

  out.push("", "  the modal verb is the level:  MUST · SHALL → C01   MAY → C02   CAN → C03", "");
  return out;
}
