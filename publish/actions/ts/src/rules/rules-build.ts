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
import { parseCueBlocks, staleCues, clauseSha, cueOwner, citedPols, type CueBlock } from "./cue-block.js";
import { standaloneChecks } from "./diff-check.js";
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
  /** Rule 7's answer for this clause — `unknown` is the backlog the report counts. */
  readonly actor?: string;
  /** True when a cue sits on this clause — used to find resident text with no level behind it. */
  readonly hasCue?: boolean;
  /** The first words of the clause, for the audit index. */
  readonly gist: string;
}

/** Which diagnostics stop a build, and which are a backlog. */
export const WARNING_KINDS = ["actor-unnamed"] as const;
export const isWarning = (d: Diagnostic): boolean => (WARNING_KINDS as readonly string[]).includes(d.kind);

/** Which lock a document's clauses belong in. The framework's numbers and an organization's never mix. */
export const lockOf = (doc: string): "framework" | "org" => (doc.startsWith("framework/") ? "framework" : "org");

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
  /** What SHOULD be on disk, one per tree. Unchanged from the input when `asks` is non-empty. */
  readonly locks: { readonly framework: PolLock; readonly org: PolLock };
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
export function classify(clause: Clause, cue: CueBlock | undefined, hasStandaloneCheck = false): EnforcementClass {
  // A clause with no modal is not a rule, so it has no enforcement to classify. Calling it "advisory" would
  // have padded that column with 237 paragraphs of ordinary prose and hidden the handful of clauses that
  // genuinely state a requirement nothing holds up — the exact number this report exists to surface.
  if (!clause.level) return "ungoverned";
  if (cue?.check || hasStandaloneCheck) return "checked";
  // THE ACTOR DECIDES, since rule 7 (2026-09-28). This used to be a regular expression looking for `gov` next to
  // a verb, which found 4 clauses where a hand reading of the same document found roughly 31 — because most of
  // them name the actor in a previous sentence and refer to it as "it". `actorOf` is the one place that judgement
  // lives now, so improving it improves the report, the rule map and `gov doctor` together.
  if (clause.actor === "gov") return "implemented";
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
export function build(docs: readonly PolicyDoc[], locks: { framework: PolLock; org: PolLock }, confirm: readonly string[] = []): BuildResult {
  const ordered = frameworkFirst(docs);
  const clauses: Clause[] = [];
  const diagnostics: Diagnostic[] = [];
  const cues: CueBlock[] = [];

  // CHECKS WITHOUT A CUE ARE STILL CHECKS. `parseCueBlocks` finds one only as the tail of a stored cue block, and
  // "check only, no cue" is the RIGHT answer for a rule a machine can see in a diff — the seeded org policy both
  // teaches that (§6.3) and uses it (POL-203, the SPDX header, `on_miss=fail`). Those checks already RUN, because
  // `validate` and the verb gate read them separately; what was wrong is that the report did not COUNT them, so
  // `gov doctor` said "3 checked" while five checks fired. A report that undercounts enforcement is the same
  // defect as a policy that overstates it, pointing the other way.
  const checkedSections = new Set<string>();
  for (const doc of ordered) {
    for (const c of standaloneChecks(doc.path, doc.text)) checkedSections.add(`${c.doc}\u0000${c.section}`);
  }

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
  const backfill = (lock: PolLock): PolLock => ({
    ...lock,
    entries: lock.entries.map((e) => {
      if (e.ordinal !== undefined || e.retired) return e;
      const hit = clauses.find((c) => c.doc === e.doc && c.section === e.section && clauseSha(c.text) === e.clauseSha);
      return hit ? { ...e, ordinal: hit.ordinal } : e;
    }),
  });

  // ── numbers ──────────────────────────────────────────────────────────────────────────────────────────────
  // A clause carrying a POL marker in its own text is already numbered; the lock records WHERE that number
  // lives so a later rewording is visible. A clause with a cue but no marker is the case the lock allocates for.
  const current: { framework: PolLock; org: PolLock } = { framework: backfill(locks.framework), org: backfill(locks.org) };
  const asks: { message: string; candidate?: string }[] = [];
  const map: MappedClause[] = [];

  for (const clause of clauses) {
    // A CUE BELONGS TO THE CLAUSE IT CITES — ONE rule, `cueOwner`, shared with the stamper and the staleness
    // check. This was a third copy of "the nearest preceding clause owns the cue", and all three agreed on an
    // answer that was wrong whenever an author put a rationale between the rule and its cue. Inverted here
    // because this loop asks the question the other way round: not "which clause does this cue govern?" but
    // "does any cue govern this clause?".
    //
    // (The earlier note on this line is still worth keeping: matching on the SECTION instead attributed one cue
    // to every clause under that heading, so §2.1's four clauses and one cue reported four as "cued" — inflating
    // the one column a reader uses to decide whether a policy has teeth.)
    const cue = cues.find((b) => b.doc === clause.doc && cueOwner(clauses, b) === clause);
    // The marker in the clause's own text, when it has one. It is passed to `allocate` as the DECLARED number:
    // a clause that already says POL-009c keeps POL-009c, rather than being handed a fresh one.
    const marker = /\*\*\(?(?:C0\d,\s*)?POL-(\d{3}[a-z]?)/.exec(clause.text);
    const pol = marker ? `POL-${marker[1]}` : null;

    // ANCHORING AND COVERAGE ARE DIFFERENT QUESTIONS, and conflating them UNDERCOUNTED enforcement.
    //
    // A cue ANCHORS to one clause — that is the text its hash is compared against. But its header cites a RANGE
    // when one cue carries several rules, and §2.1's does: `POL-011…POL-015`. Those four other clauses came out
    // `advisory` — the class whose definition is "nothing enforces this" — while a C01 cue covering them sat in
    // every agent's context on every turn. Fifteen of the reduced policy's thirty-eight "advisory" clauses were
    // that, which matters because `advisory` is the number a policy gets judged by.
    const covering = cue
      ?? (pol === null ? undefined : cues.find((b) => b.doc === clause.doc && citedPols(b.cite).includes(pol)));
    const klass = classify(clause, covering, checkedSections.has(`${clause.doc}\u0000${clause.section}`));

    // A CLAUSE THAT CARRIES A NUMBER IS LOCKED, GOVERNED OR NOT. A POL number is a citation target: if a
    // document cites one, the lock must know where it lives. Locking only levelled clauses meant §1.7's
    // "(POL-009a)" — prose with no modal — was invisible, so when two new sections pushed it from §1.5 to §1.7 the
    // lock silently kept pointing at §1.5. A citation that still resolves, to the wrong place, is the failure the
    // lock exists to prevent.
    if (clause.governed || pol) {
      const which = lockOf(clause.doc);
      const id = { doc: clause.doc, section: clause.section, ordinal: clause.ordinal, clauseSha: clauseSha(clause.text) };
      const outcome = allocate(current[which], id, clause.level, pol ?? undefined);
      if (outcome.action === "ask") {
        // A confirmation names the number, so the owner has said "yes, §4.2 IS the reworded POL-016". That moves
        // the old identity into the entry's history rather than overwriting it — the sha approved in an earlier
        // pull request survives, which is what makes a later audit able to say which text the number was for.
        const candidate = outcome.candidate?.pol;
        if (candidate && confirm.includes(candidate)) current[which] = confirmMatch(current[which], candidate, id, clause.level);
        else asks.push({ message: formatAsk(id, outcome), ...(candidate ? { candidate } : {}) });
      } else current[which] = outcome.lock;
    }
    map.push({ pol, doc: clause.doc, section: clause.section, ...(clause.level ? { level: clause.level } : {}), klass, actor: clause.actor, ...(cue ? { hasCue: true } : {}), gist: gistOf(clause) });
  }

  // WARNINGS ARE COUNTED, NOT LISTED. Rule 7 fires on 150 clauses in the framework's own policy, and printing
  // each one would bury the notation ERRORS — the handful a person must fix before anything can be written —
  // under a backlog. The rule map holds the detail, per clause, for whoever is working through it.
  const unnamed = diagnostics.filter((d) => d.kind === "actor-unnamed").length;
  const report = [
    ...formatReport(ordered.map((d) => parseClauses(d.path, d.text))),
    "",
    ...classSummary(map),
    ...(unnamed ? ["",
      `  ⚠ ${unnamed} rule(s) name no actor (rule 7) — say whether each is about gov, an agent, or a named role.`,
      "    Until they do, `implemented` under-reports: a rule gov itself carries out reads as merely advisory.",
      "    Every one is listed in agent/harness/rule-map.md.",
    ] : []),
  ];

  return {
    clauses, cues, diagnostics, asks, map, report,
    locks: asks.length ? locks : current,
  };
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
  const rows = map.map((m) => `| ${m.pol ?? "—"} | ${m.doc} | §${m.section} | ${m.level ?? "—"} | ${m.klass} | ${m.actor ?? "—"} | ${m.gist.replace(/\|/g, "\\|")} |`);
  return [
    "<!-- GENERATED by `gov rules build` — do not edit. Every clause of every policy, and how it is enforced. -->",
    "",
    "# Rule map",
    "",
    "One row per clause. `POL` is the citation; `class` is what actually holds it up:",
    "**checked** (a test fails the pull request) · **cued** (resident in every agent's context) ·",
    "**implemented** (gov's own behaviour — editing the prose changes nothing) · **advisory** (nothing enforces it).",
    "",
    "| POL | document | § | level | class | actor | clause |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
