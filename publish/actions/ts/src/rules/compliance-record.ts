// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `compliance.md` HAS TWO HALVES, AND ONLY ONE OF THEM NEEDS A PERSON (design §B14).
 *
 * POL-150 asks a project to record its C01 violations, its C02 exceptions and its C03 deviations. Today the whole
 * file is hand-written, which is why it is unreliable: the half that is verifiable is also the half nobody enjoys
 * writing, so it is the half that gets left out.
 *
 *   DERIVED — every refusal gov issued, every gate that fired, which exception files the project cited, which
 *             checks failed and were fixed. gov already writes all of this to its own run log; it just never read
 *             it back. This module renders that half.
 *   JUDGED  — what was deviated from and why, the context a log cannot hold, a C01 someone caught and resolved.
 *             No machine can write this, and a resident cue asks for it as it happens (POL-150's cue).
 *
 * The two are kept in separately fenced regions so that regenerating the derived half can never touch what a
 * person wrote. That property is the whole reason this is safe to run on every close: if gov could overwrite the
 * judged half, nobody would trust it with the file, and we would be back to hand-writing both.
 *
 * Pure: events in, markdown out.
 */

/** One thing gov did that belongs in the record, read back from its own log. */
export interface ComplianceEvent {
  /** ISO timestamp, as the log holds it. */
  readonly at: string;
  /** What happened, in gov's own vocabulary: `refused`, `gate`, `check-failed`, `exception-cited`. */
  readonly kind: "refused" | "gate" | "check-failed" | "exception-cited";
  /** The clause, when the event names one. */
  readonly pol?: string;
  /** One line, already redacted by the logger — this module never sees a secret because the log never held one. */
  readonly what: string;
  /** The command that produced it, e.g. `merge`. */
  readonly command?: string;
}

export const DERIVED_BEGIN = "<!-- BEGIN gov-derived — generated from this project's run log; do not edit by hand -->";
export const DERIVED_END = "<!-- END gov-derived -->";

/**
 * The derived section.
 *
 * Grouped by kind rather than listed chronologically, because the question people bring to this file is "was
 * anything refused?" and not "what happened at 14:02". The timestamps stay on each line for the reader who does
 * want the sequence.
 */
export function renderDerived(events: readonly ComplianceEvent[]): string {
  const groups: { readonly kind: ComplianceEvent["kind"]; readonly title: string; readonly empty: string }[] = [
    { kind: "refused", title: "Refusals gov issued", empty: "None. gov refused nothing in this project." },
    { kind: "gate", title: "Gates that fired", empty: "None." },
    { kind: "check-failed", title: "Checks that failed and were fixed", empty: "None." },
    { kind: "exception-cited", title: "Exceptions this project relied on", empty: "None." },
  ];
  const lines = [
    DERIVED_BEGIN,
    "",
    "## What gov recorded",
    "",
    "Read back from this project's own run log. This section is regenerated; the section below it is not, and",
    "nothing here can overwrite what a person wrote there.",
    "",
  ];
  for (const g of groups) {
    const mine = events.filter((e) => e.kind === g.kind);
    lines.push(`### ${g.title}`, "");
    if (!mine.length) lines.push(g.empty, "");
    else {
      for (const e of mine) {
        lines.push(`- \`${e.at}\`${e.pol ? ` **${e.pol}**` : ""}${e.command ? ` (\`gov ${e.command}\`)` : ""} — ${e.what}`);
      }
      lines.push("");
    }
  }
  lines.push(DERIVED_END);
  return lines.join("\n");
}

/** The part a person writes, as a starter — headings and what belongs under each, never invented content. */
export function judgedTemplate(): string {
  return [
    "## What a person has to say",
    "",
    "gov cannot write this half. It is the judgement: what was deviated from, why it was reasonable, and what a",
    "reader a year from now would need in order to agree with you.",
    "",
    "### C01 events",
    "",
    "A C01 has no exception, so anything here is something that was caught and resolved. Say how.",
    "",
    "### C02 exceptions exercised",
    "",
    "Which exception, on what, and whether it is still needed — an exception nobody revisits becomes permanent.",
    "",
    "### C03 deviations",
    "",
    "What you did differently and why the rule's intent still holds. \"It was faster\" is a reason; record it as one.",
    "",
  ].join("\n");
}

/**
 * Put the derived half into an existing file without touching the rest.
 *
 * THE FENCE IS REPLACED, NEVER APPENDED. Running this on every close, as gov does, would otherwise grow the file
 * by one copy of the derived section each time — the same defect the harness mirroring had, and the reason
 * `composeTeamFile` is asserted idempotent rather than assumed to be.
 */
export function composeCompliance(existing: string | null, events: readonly ComplianceEvent[]): string {
  const derived = renderDerived(events);
  if (existing === null || existing.trim() === "") {
    return `# Compliance\n\n${derived}\n\n${judgedTemplate()}`;
  }
  const from = existing.indexOf(DERIVED_BEGIN);
  const to = existing.indexOf(DERIVED_END);
  if (from >= 0 && to > from) {
    return existing.slice(0, from) + derived + existing.slice(to + DERIVED_END.length);
  }
  // A hand-written file with no fence: the derived section goes ON TOP and everything a person wrote is kept
  // below, untouched. Guessing where it "should" go inside their prose would be the one way to lose it.
  return `${derived}\n\n${existing.replace(/^#\s+Compliance\s*\n+/, "")}`;
}
