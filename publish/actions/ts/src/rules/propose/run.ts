// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov rules propose` — THE ENGINE (rule-model-design.md Q2, Q5, Q9, Q16–Q18, W2-Q8, P1 "Propose trigger"; W4).
 *
 * One implementation, two triggers: run by hand (terminal channel) or as the action bound to
 * `vcs.gov-repo · pull_request(base=default)` (PR-comment channel). This is the pure core both call.
 *
 *   for each section of each policy document
 *     its rows carry its current sha ............ skip (ONE RUN PER SECTION SHA — Q16)
 *     changed, or new, or rows stale ............ interview (interview.ts)
 *     gone from the document .................... its rules retire (no model: there is no prose left to read)
 *   all settled → applyVerdicts with gov's IdIssuer (ids NEVER from the model) → rows, ownership, changelog draft,
 *   and the version bump the P1 ruling sets: a rule added/revised/retired, or who-owns-what changed → minor;
 *   prose only (sha refreshes included) → patch.
 *   any answer pending → BLOCKED, nothing produced (in CI the PR stays blocked until the owner replies).
 *
 * W5 owns the files (VERSION, snapshot, CHANGELOG.md); this returns their content.
 *
 * Pure over its ports.
 */
import { log } from "../../log.js";
import { inForce, type RuleRow, type Stamp } from "../model/rule-row.js";
import type { IdIssuer, Proposer, RuleSet, SectionOwnership, SectionVerdict } from "../model/contracts.js";
import { applyVerdicts } from "../model/revise.js";
import { policySections, sectionShas } from "../checks/sections.js";
import { ownershipDiffers } from "../checks/ownership.js";
import type { ModelPort } from "./model-port.js";
import type { ProposedRow, ProposalQuestion } from "./parse.js";
import { interviewSection, type InterviewChannel, type QA, type SectionOutcome } from "./interview.js";

const PGM = "gov-work:rules:propose";

export interface PolicyDoc {
  /** Repo-relative path, as rule rows cite it (`policies/org-policy.md`). */
  readonly doc: string;
  /** The text under review; null when the document is deleted. */
  readonly head: string | null;
  /** The text on the default branch; null when the document is new there. */
  readonly base: string | null;
}

export interface ProposeDeps {
  readonly docs: readonly PolicyDoc[];
  /** The stores as the DEFAULT branch has them. */
  readonly set: RuleSet;
  readonly model: ModelPort;
  readonly channel: InterviewChannel;
  readonly issuer: IdIssuer;
  /** The stamp the new revisions carry: the version this PR bumps to, today, the PR. */
  readonly at: Stamp;
  readonly maxRounds?: number;
  /** Also interview unchanged sections that have no rules yet (first extraction of a seeded policy). */
  readonly all?: boolean;
}

export type RuleChange = "added" | "revised" | "retired" | "kept";

export interface ChangelogDraft {
  readonly rules: readonly { readonly id: string; readonly change: RuleChange; readonly expectation: string }[];
  readonly qa: readonly { readonly doc: string; readonly section: string; readonly q: string; readonly a: string }[];
}

export type Bump = "minor" | "patch" | "none";

export interface OpenSection { readonly doc: string; readonly section: string; readonly questions: readonly ProposalQuestion[]; readonly problems?: readonly string[]; }

export type ProposeResult =
  | {
    readonly status: "ready";
    /** The whole org store after this proposal. */
    readonly rows: readonly RuleRow[];
    /** The whole ownership table after this proposal. */
    readonly ownership: readonly SectionOwnership[];
    readonly changelogDraft: ChangelogDraft;
    readonly bump: Bump;
    /** Sections interviewed (or retired), by sha. */
    readonly sections: readonly { readonly doc: string; readonly section: string; readonly sha: string }[];
  }
  | { readonly status: "blocked"; readonly open: readonly OpenSection[] }
  | { readonly status: "failed"; readonly open: readonly OpenSection[]; readonly problems: readonly string[] };

type Body = Omit<RuleRow, "id" | "start" | "end">;

/** A row's meaning, without its history or provenance — what decides kept vs revised. */
const meaning = (r: Pick<RuleRow, "expectation" | "actor" | "level" | "cue" | "checks">): string =>
  JSON.stringify({ e: r.expectation, a: [...r.actor].sort(), l: r.level, c: r.cue ?? null, k: r.checks ?? [] });


interface Work {
  readonly doc: string;
  readonly section: string;
  readonly sha: string;
  readonly rows: readonly RuleRow[];
  readonly outcome: SectionOutcome | "removed";
}

export async function runPropose(deps: ProposeDeps): Promise<ProposeResult> {
  const { set } = deps;
  const orgInForce = inForce(set.org);
  const fwInForce = inForce(set.framework);
  const roles = set.roles ? Object.keys(set.roles) : undefined;
  const work: Work[] = [];

  for (const d of deps.docs) {
    const head = d.head === null ? [] : policySections(d.head).filter((s) => s.section !== "");
    const baseShas = d.base === null ? null : sectionShas(d.base);
    const rowsOf = (section: string) => orgInForce.filter((r) => r.source.doc === d.doc && r.source.section === section);

    for (const s of head) {
      const rows = rowsOf(s.section);
      const stale = rows.some((r) => r.source.sha !== s.sha);
      const changed = baseShas === null || baseShas.get(s.section) !== s.sha;
      // One run per section sha (Q16): rows that already carry this sha were settled by an earlier run.
      if (rows.length > 0 ? !stale : !(changed || deps.all)) continue;
      const outcome = await interviewSection(
        { doc: d.doc, section: s.section, sha: s.sha, text: s.text, rows, catalog: set.catalog, frameworkRules: fwInForce, roles, scope: set.orgScope },
        { model: deps.model, channel: deps.channel, maxRounds: deps.maxRounds },
      );
      work.push({ doc: d.doc, section: s.section, sha: s.sha, rows, outcome });
    }

    const present = new Set(head.map((s) => s.section));
    const gone = [...new Set(orgInForce.filter((r) => r.source.doc === d.doc && !present.has(r.source.section)).map((r) => r.source.section))];
    for (const section of gone) work.push({ doc: d.doc, section, sha: "", rows: rowsOf(section), outcome: "removed" });
  }

  const blocked: OpenSection[] = [], failed: OpenSection[] = [];
  for (const w of work) {
    if (w.outcome === "removed") continue;
    if (w.outcome.status === "pending") blocked.push({ doc: w.doc, section: w.section, questions: w.outcome.open });
    if (w.outcome.status === "failed") failed.push({ doc: w.doc, section: w.section, questions: w.outcome.open, problems: w.outcome.problems });
  }
  if (failed.length) {
    log("info", "propose failed — sections did not settle", PGM, "runPropose", { failed: failed.map((f) => `${f.doc}§${f.section}`) });
    return { status: "failed", open: [...failed, ...blocked], problems: failed.flatMap((f) => (f.problems ?? []).map((p) => `${f.doc} §${f.section}: ${p}`)) };
  }
  if (blocked.length) {
    log("info", "propose blocked — answers pending", PGM, "runPropose", { open: blocked.map((b) => `${b.doc}§${b.section}`) });
    return { status: "blocked", open: blocked };
  }

  // ── settle: verdicts → rows, through gov's issuer ──
  const verdicts: SectionVerdict[] = [];
  const changes: { change: RuleChange; id?: string; expectation: string }[] = [];
  const qaOut: { doc: string; section: string; q: string; a: string }[] = [];

  // OWNERSHIP lives as long as the sentence that grants it: a row whose statement-section sha is gone from its
  // document's head (the sentence deleted or changed, its section deleted, the document deleted) is dropped. A
  // changed section is always interviewed, so a sentence still there is extracted again below at the new sha.
  const headShas = new Map(deps.docs.map((d) => [d.doc, new Set(d.head === null ? [] : policySections(d.head).map((s) => s.sha))]));
  const ownKey = (o: Pick<SectionOwnership, "doc" | "section">) => `${o.doc}\u0000${o.section}`;
  const before = new Map((set.ownership ?? []).map((o) => [ownKey(o), o]));
  const ownership = new Map([...before].filter(([, o]) => headShas.get(o.doc)?.has(o.sha) ?? true));

  for (const w of work) {
    const byId = new Map(w.rows.map((r) => [r.id, r]));
    if (w.outcome === "removed") {
      for (const r of w.rows) { verdicts.push({ kind: "retire", id: r.id }); changes.push({ change: "retired", id: r.id, expectation: r.expectation }); }
      continue;
    }
    if (w.outcome.status !== "done") continue; // unreachable: pending/failed returned above
    const qa: readonly QA[] = w.outcome.qa;
    for (const x of qa) qaOut.push({ doc: w.doc, section: w.section, q: x.q, a: x.a });
    const source = { doc: w.doc, section: w.section, sha: w.sha };
    const fresh = (row: ProposedRow): Body => ({ source, ...row, ...(qa.length ? { qa: qa.map(({ q, a }) => ({ q, a })) } : {}) });

    for (const v of w.outcome.verdicts) {
      switch (v.kind) {
        case "retire":
          verdicts.push(v);
          changes.push({ change: "retired", id: v.id, expectation: byId.get(v.id)!.expectation });
          break;
        case "keep":
        case "revise": {
          const old = byId.get(v.id)!;
          // Same meaning → keep: applyVerdicts refreshes the row's sha in place (Q17), no new revision.
          if (v.kind === "keep" || meaning(old) === meaning(v.row)) {
            verdicts.push({ kind: "keep", id: v.id, sha: w.sha });
            changes.push({ change: "kept", id: v.id, expectation: old.expectation });
          } else {
            verdicts.push({ kind: "revise", id: v.id, row: fresh(v.row) });
            changes.push({ change: "revised", id: v.id, expectation: v.row.expectation });
          }
          break;
        }
        case "add":
          verdicts.push({ kind: "add", row: fresh(v.row) });
          changes.push({ change: "added", expectation: v.row.expectation });
          break;
      }
    }
    for (const o of w.outcome.ownership) ownership.set(ownKey({ doc: w.doc, section: o.section }), { doc: w.doc, section: o.section, role: o.role, sha: w.sha });
  }
  // Who owns what changed — a row added, dropped, or handed to another role. A sha moving alone is prose.
  // The one comparison the gate and section-owner-approval use too (checks/ownership.ts) → minor (Policy Owner).
  const ownershipChanged = ownershipDiffers([...before.values()], [...ownership.values()]);

  const applied = applyVerdicts(set.org, verdicts, deps.at, deps.issuer, set.orgScope);
  if (!applied.ok) {
    log("warn", "propose: verdicts refused by applyVerdicts", PGM, "runPropose", { problems: applied.problems });
    return { status: "failed", open: [], problems: applied.problems };
  }
  // Issued ids come back in the order the adds were applied — the order they appear in `changes`.
  let next = 0;
  const rules = changes.map((c) => ({ id: c.id ?? applied.issued[next++]!, change: c.change, expectation: c.expectation }));

  const ruleChange = rules.some((r) => r.change !== "kept");
  const proseChange = deps.docs.some((d) => d.head !== d.base);
  const bump: Bump = ruleChange || ownershipChanged ? "minor" : proseChange ? "patch" : "none";
  log("info", "propose settled", PGM, "runPropose", {
    sections: work.length, added: rules.filter((r) => r.change === "added").length, revised: rules.filter((r) => r.change === "revised").length,
    retired: rules.filter((r) => r.change === "retired").length, bump,
  });
  return {
    status: "ready",
    rows: applied.rows,
    ownership: [...ownership.values()],
    changelogDraft: { rules, qa: qaOut },
    bump,
    sections: work.map((w) => ({ doc: w.doc, section: w.section, sha: w.sha })),
  };
}

/**
 * The P1 {@link Proposer} contract over the same engine: verdicts, ownership and Q&A. It refuses rather than return
 * a partial answer.
 */
export function createProposer(deps: { readonly set: RuleSet; readonly model: ModelPort; readonly channel: InterviewChannel; readonly maxRounds?: number }): Proposer {
  return {
    async propose(sections) {
      const out: SectionVerdict[] = [];
      const ownership: SectionOwnership[] = [];
      const qaOut: { section: string; q: string; a: string }[] = [];
      const fw = inForce(deps.set.framework);
      const roles = deps.set.roles ? Object.keys(deps.set.roles) : undefined;
      for (const s of sections) {
        const rows = inForce(s.rows);
        const o = await interviewSection(
          { doc: s.doc, section: s.section, sha: s.sha, text: s.text, rows, catalog: deps.set.catalog, frameworkRules: fw, roles, scope: deps.set.orgScope },
          { model: deps.model, channel: deps.channel, maxRounds: deps.maxRounds },
        );
        if (o.status !== "done") throw new Error(`propose: ${s.doc} §${s.section} is ${o.status} — ${o.open.map((q) => q.text).join("; ") || "no settled proposal"}`);
        const source = { doc: s.doc, section: s.section, sha: s.sha };
        const qa = o.qa.length ? { qa: o.qa.map(({ q, a }) => ({ q, a })) } : {};
        for (const v of o.verdicts) {
          if (v.kind === "add") out.push({ kind: "add", row: { source, ...v.row, ...qa } });
          else if (v.kind === "revise") out.push({ kind: "revise", id: v.id, row: { source, ...v.row, ...qa } });
          else if (v.kind === "keep") out.push({ kind: "keep", id: v.id, sha: s.sha });
          else out.push(v);
        }
        for (const x of o.ownership) ownership.push({ doc: s.doc, section: x.section, role: x.role, sha: s.sha });
        for (const x of o.qa) qaOut.push({ section: s.section, q: x.q, a: x.a });
      }
      return { verdicts: out, ownership, qa: qaOut };
    },
  };
}
