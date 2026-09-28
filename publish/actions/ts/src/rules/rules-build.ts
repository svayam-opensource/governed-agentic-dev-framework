// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov rules build` — the compiler, as one pure function over documents in and artifacts out.
 *
 * Everything the three modes need is decided here; the verb (`cli/rules-verb.ts`) only reads files, writes
 * files and prints. That split is deliberate: `build` and `check` must agree exactly, because `check`'s whole
 * job is to fail when the committed artifacts differ from what `build` would produce. Two code paths computing
 * "what should be there" is how a freshness check comes to pass on a stale file.
 *
 * WHAT IT PRODUCES, from the numbered prose an organization writes:
 *   · the resident block for the nine agent files — via `harness-render.ts`
 *   · `rule-map.md`, the audit index (deliberately NOT resident: an agent needs the cues, not the index)
 *   · the compile report — counts, ungoverned clauses, diagnostics
 *   · the updated POL lock, or the QUESTIONS that must be answered before one can be written
 *
 * IT NEVER GUESSES A NUMBER. When a clause cannot be matched, the result carries an `ask` and `build` refuses to
 * write, because the two silent alternatives are both wrong months later: reuse the number and a reworded clause
 * inherits an approval it never had; allocate a new one and every existing citation points at a retired rule.
 */
import { parseClauses, formatReport, type Clause, type Diagnostic, type Level } from "./notation.js";
import { parseCueBlocks, staleCues, clauseSha, type CueBlock } from "./cue-block.js";
import { allocate, confirmMatch, formatAsk, type PolLock } from "./pol-lock.js";

/** One policy document, as the builder sees it. */
export interface PolicyDoc {
  /** Workspace-relative path, e.g. `policies/org-policy.md`. */
  readonly path: string;
  readonly text: string;
}

/**
 * How enforceable a clause actually is — the four classes, declared per clause rather than implied.
 *
 * The distinction exists because the policy read as though every clause bound equally, when roughly a third of
 * the framework's own clauses describe what gov DOES in code (editing that prose changes nothing), a third are
 * instructions an agent may or may not follow, and the rest are human process. A reader could not tell them
 * apart. Now `gov doctor` can count them, and a clause marked `implemented` carries "this describes gov, not
 * your choice" on its face.
 */
export type EnforcementClass = "implemented" | "checked" | "cued" | "advisory" | "ungoverned";

export interface MappedClause {
  readonly pol: string | null;
  readonly doc: string;
  readonly section: string;
  readonly level?: Level;
  readonly klass: EnforcementClass;
  /** True when a cue sits on this clause — used to find resident text with no level behind it. */
  readonly hasCue?: boolean;
  /** The first words of the clause, for the audit index. */
  readonly gist: string;
}

export interface BuildResult {
  readonly clauses: readonly Clause[];
  readonly cues: readonly CueBlock[];
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Questions the lock cannot answer for itself. Non-empty ⇒ `build` writes nothing.
   *
   * Each carries the CANDIDATE number, so the caller can print a command that answers it. An ask with no way to
   * answer it is a dead end, and a dead end in a build step gets worked around rather than resolved.
   */
  readonly asks: readonly { readonly message: string; readonly candidate?: string }[];
  readonly lock: PolLock;
  readonly map: readonly MappedClause[];
  readonly report: readonly string[];
}

/** The framework's documents come first, so their cues are read first. Order creates no precedence (§9.1). */
export const frameworkFirst = (docs: readonly PolicyDoc[]): PolicyDoc[] =>
  [...docs].sort((a, b) => Number(a.path.startsWith("policies/")) - Number(b.path.startsWith("policies/")) || a.path.localeCompare(b.path));

/**
 * Which class a clause falls in.
 *
 * `implemented` is inferred from the ACTOR — a clause whose subject is gov describes the program, and rewriting
 * it changes nothing. That inference is why notation rule 7 (a clause names its actor) matters: without it, the
 * classifier could not place roughly half the clauses, and neither could a reader skimming for "is this about
 * me?".
 */
export function classify(clause: Clause, cue: CueBlock | undefined): EnforcementClass {
  // A clause with no modal is not a rule, so it has no enforcement to classify. Calling it "advisory" would
  // have padded that column with 237 paragraphs of ordinary prose and hidden the handful of clauses that
  // genuinely state a requirement nothing holds up — the exact number this report exists to surface.
  if (!clause.level) return "ungoverned";
  if (cue?.check) return "checked";
  const t = clause.text.toLowerCase();
  // "gov MUST refuse", "gov seed issues" — the subject is the program.
  if (/\bgov\b[^.]{0,40}\b(must|shall|refuses?|issues?|renders?|places?|verif|validat|derives?|reports?|compiles?)/.test(t)) {
    return "implemented";
  }
  if (cue) return "cued";
  return "advisory";
}

/** The gist: enough of the clause to recognise it in an index, never the whole thing. */
const gistOf = (clause: Clause): string => {
  const flat = clause.text.replace(/\s+/g, " ").replace(/\*\*\(?(?:C0\d,\s*)?POL-\d{3}[a-z]?\)?\*\*/g, "").trim();
  return flat.length > 90 ? `${flat.slice(0, 87)}…` : flat;
};

/**
 * Compile every document.
 *
 * `lock` is what is on disk; the returned lock is what SHOULD be on disk. When `asks` is non-empty the returned
 * lock is the unchanged input, so a caller that ignores `asks` still cannot write a guess.
 */
export function build(docs: readonly PolicyDoc[], lock: PolLock, confirm: readonly string[] = []): BuildResult {
  const ordered = frameworkFirst(docs);
  const clauses: Clause[] = [];
  const diagnostics: Diagnostic[] = [];
  const cues: CueBlock[] = [];

  for (const doc of ordered) {
    const parsed = parseClauses(doc.path, doc.text);
    clauses.push(...parsed.clauses);
    diagnostics.push(...parsed.diagnostics);
    const blocks = parseCueBlocks(doc.path, doc.text);
    cues.push(...blocks.blocks);
    diagnostics.push(...blocks.diagnostics);
    diagnostics.push(...staleCues(parsed.clauses, blocks.blocks));
  }

  // ── backfill the ordinals a legacy lock has none of ──────────────────────────────────────────────────────
  //
  // An entry written before `ordinal` existed matches any clause in its section, so a section with several
  // clauses asks about each in turn: confirm one, and the next build asks about the next. It converges, after as
  // many builds as there are clauses, which is not a thing to ask of anybody.
  //
  // The documents are right here, so the missing field can be DERIVED rather than interrogated: an entry whose
  // sha still matches a clause exactly gets that clause's ordinal. Entries matching no clause keep none — those
  // are the genuinely reworded ones, and they are what the questions should be about.
  const backfilled: PolLock = {
    ...lock,
    entries: lock.entries.map((e) => {
      if (e.ordinal !== undefined || e.retired) return e;
      const hit = clauses.find((c) => c.doc === e.doc && c.section === e.section && clauseSha(c.text) === e.clauseSha);
      return hit ? { ...e, ordinal: hit.ordinal } : e;
    }),
  };

  // ── numbers ──────────────────────────────────────────────────────────────────────────────────────────────
  // A clause carrying a POL marker in its own text is already numbered; the lock records WHERE that number
  // lives so a later rewording is visible. A clause with a cue but no marker is the case the lock allocates for.
  let current = backfilled;
  const asks: { message: string; candidate?: string }[] = [];
  const map: MappedClause[] = [];

  for (const clause of clauses) {
    // THE NEAREST PRECEDING CLAUSE OWNS THE CUE. Matching on the section instead attributed one cue to every
    // clause under that heading: §2.1 has four clauses and one cue, and the first version reported four as
    // "cued" — inflating the one column a reader would use to decide whether a policy has teeth.
    const cue = [...cues]
      .filter((b) => b.doc === clause.doc && b.line > clause.line)
      .sort((a, b) => a.line - b.line)
      .find((b) => !clauses.some((other) => other.doc === clause.doc && other.line > clause.line && other.line < b.line));
    const marker = /POL-(\d{3}[a-z]?)/.exec(clause.text);
    const pol = marker ? `POL-${marker[1]}` : null;
    const klass = classify(clause, cue);

    if (clause.governed) {
      const id = { doc: clause.doc, section: clause.section, ordinal: clause.ordinal, clauseSha: clauseSha(clause.text) };
      const outcome = allocate(current, id, clause.level);
      if (outcome.action === "ask") {
        // A confirmation names the number, so the owner has said "yes, §4.2 IS the reworded POL-016". That moves
        // the old identity into the entry's history rather than overwriting it — the sha approved in an earlier
        // pull request survives, which is what makes a later audit able to say which text the number was for.
        const candidate = outcome.candidate?.pol;
        if (candidate && confirm.includes(candidate)) current = confirmMatch(current, candidate, id, clause.level);
        else asks.push({ message: formatAsk(id, outcome), ...(candidate ? { candidate } : {}) });
      } else current = outcome.lock;
    }
    map.push({ pol, doc: clause.doc, section: clause.section, ...(clause.level ? { level: clause.level } : {}), klass, ...(cue ? { hasCue: true } : {}), gist: gistOf(clause) });
  }

  const report = [
    ...formatReport(ordered.map((d) => parseClauses(d.path, d.text))),
    "",
    ...classSummary(map),
  ];

  return { clauses, cues, diagnostics, asks, lock: asks.length ? lock : current, map, report };
}

/** The four classes, counted — the line that says how much of a policy has teeth. */
export function classSummary(map: readonly MappedClause[]): string[] {
  const n = (k: EnforcementClass): number => map.filter((m) => m.klass === k).length;
  const governed = map.filter((m) => m.level).length;
  return [
    `  of ${map.length} clauses, ${governed} state a rule and ${n("ungoverned")} are prose (no modal verb — nothing compiled)`,
    "",
    ...(orphanCues(map) ? [`  ⚠ ${orphanCues(map)} cue(s) sit on a clause with NO modal verb — resident text in every agent's`,
      "    context with no compliance level behind it. Level the clause, or drop the cue.", ""] : []),
    `  how the ${governed} rules are held up:`,
    `    ${n("checked")} checked · ${n("cued")} cued · ${n("implemented")} implemented (gov's own behaviour) · ${n("advisory")} advisory`,
    "",
    "  checked     a deterministic test fails the pull request — the only class that binds an agent that never read the rule",
    "  cued        resident in every agent's context, every turn: raises the odds, guarantees nothing",
    "  implemented gov does this in code; editing the words changes nothing except the accuracy of the document",
    "  advisory    neither — write it if it matters, but know that nothing enforces it",
  ];
}

/**
 * Cues attached to prose rather than to a rule.
 *
 * A cue is resident in every agent's context on every turn. One sitting on a clause with no modal verb is text an
 * agent is told to obey that the policy never assigned a level to — so nobody can say whether deviating from it
 * is a hard stop, an exception, or a judgement call. Worth a line in the report: it is cheap to fix and
 * impossible to notice by reading.
 */
export const orphanCues = (map: readonly MappedClause[]): number =>
  map.filter((m) => m.hasCue && !m.level).length;

/**
 * `rule-map.md` — the audit index: every clause, its number, level and class.
 *
 * NOT resident, deliberately. An agent needs the cues; an auditor needs the index; and paying for the index on
 * every turn of every session would be the resident block growing into the document it was invented to replace.
 */
export function renderRuleMap(map: readonly MappedClause[]): string {
  const rows = map.map((m) => `| ${m.pol ?? "—"} | ${m.doc} | §${m.section} | ${m.level ?? "—"} | ${m.klass} | ${m.gist.replace(/\|/g, "\\|")} |`);
  return [
    "<!-- GENERATED by `gov rules build` — do not edit. Every clause of every policy, and how it is enforced. -->",
    "",
    "# Rule map",
    "",
    "One row per clause. `POL` is the citation; `class` is what actually holds it up:",
    "**checked** (a test fails the pull request) · **cued** (resident in every agent's context) ·",
    "**implemented** (gov's own behaviour — editing the prose changes nothing) · **advisory** (nothing enforces it).",
    "",
    "| POL | document | § | level | class | clause |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
