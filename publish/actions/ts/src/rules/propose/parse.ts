// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * READING THE MODEL'S REPLY — STRICTLY (rule-model-design.md Q9, Q10, Q15, Q17, Q18, W2-Q2, W2-Q8; W4).
 *
 * Two steps, kept apart because they fail differently:
 *
 *   parseProposal     Is the reply the SHAPE we asked for? Anything else — prose, a truncated object, an unknown
 *                     field, a level spelled "must" — is a {@link ProposeError}. Never guessed at: a guessed level
 *                     is a rule nobody approved. An id on a NEW rule is refused outright (Q17: ids are gov's).
 *   checkProposal     The shape is right; is the CONTENT admissible? Verdicts on rows this section does not own,
 *                     rows the rule-store validator or the catalog rejects → `problems`, which go back to the
 *                     MODEL to correct (a human cannot fix a typo in an action name). Things only the owner can
 *                     decide — a C01 rule that can only be detected after the fact (Q15), a section given to a role
 *                     the org does not have (W2-Q8) — become gov's own QUESTIONS, asked like the model's.
 *                     Some things gov SETTLES itself: an on-demand cue on a rule with no check (Q19 — nothing could
 *                     ever show it) is dropped and the interview says so, or, on a C01 rule binding agents, the
 *                     owner is asked whether to make it resident instead.
 *
 * Pure.
 */
import { createHash } from "node:crypto";
import { validateRuleStore, ROW_WARNINGS, type Actor, type Level, type RuleRow, type RowDiagnosticKind } from "../model/rule-row.js";
import { validateBindings, type Catalog, type CheckBinding } from "../model/catalog.js";
import { parseGovId, FRAMEWORK_SCOPE } from "../model/gov-id.js";

/** What a proposed rule carries. No id, no source, no stamps — gov supplies all three. */
export interface ProposedRow {
  readonly expectation: string;
  readonly actor: readonly Actor[];
  readonly level: Level;
  readonly cue?: { readonly tier: "resident" | "on-demand"; readonly text: string };
  readonly checks?: readonly CheckBinding[];
}

export type ModelVerdict =
  | { readonly kind: "keep"; readonly id: string }
  | { readonly kind: "revise"; readonly id: string; readonly row: ProposedRow }
  | { readonly kind: "retire"; readonly id: string }
  | { readonly kind: "add"; readonly row: ProposedRow };

export type QuestionKind =
  | "level" | "actor" | "keep-revise-retire" | "uncheckable" | "c01-observe-only" | "contradiction" | "ownership-role" | "cue-tier" | "other";

export interface ProposalQuestion {
  readonly id: string;
  readonly text: string;
  readonly options?: readonly string[];
  readonly kind?: QuestionKind;
  /** kind `contradiction`: the GOV-FRM id the proposed rule would contradict (W2-Q2). */
  readonly contradicts?: string;
}

/** An ownership sentence found in the section ("Section 4 is owned by the Data Owner"). The doc is the section's. */
export interface ProposedOwnership {
  readonly section: string;
  readonly role: string;
}

export interface SectionProposal {
  readonly verdicts: readonly ModelVerdict[];
  readonly ownership: readonly ProposedOwnership[];
  readonly questions: readonly ProposalQuestion[];
}

export type ProposeErrorKind = "not-json" | "bad-shape" | "model-issued-id";

/** The reply could not be read as a proposal. Typed so the CLI can say which. */
export class ProposeError extends Error {
  constructor(readonly kind: ProposeErrorKind, message: string) {
    super(message);
    this.name = "ProposeError";
  }
}

const LEVELS = ["C01", "C02", "C03"];
const ACTORS = ["gov-client", "agent", "human", "everyone"];
const KINDS: readonly string[] = ["level", "actor", "keep-revise-retire", "uncheckable", "c01-observe-only", "contradiction", "ownership-role", "other"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Parse a reply. One exact ```json fence around the whole reply is unwrapped — that is the reply, not a guess at
 * it; anything else outside the object is refused.
 */
export function parseProposal(raw: string): SectionProposal {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(raw);
  let doc: unknown;
  try {
    doc = JSON.parse(fenced ? fenced[1]! : raw);
  } catch (e) {
    throw new ProposeError("not-json", `the model's reply is not JSON: ${(e as Error).message}`);
  }
  const bad = (msg: string): never => { throw new ProposeError("bad-shape", `the model's reply: ${msg}`); };
  if (!isObj(doc)) return bad("expected an object with verdicts, ownership and questions");
  onlyKeys(doc, ["verdicts", "ownership", "questions"], "the reply", bad);
  if (!Array.isArray(doc.verdicts)) bad("verdicts must be a list");
  const ownership = doc.ownership ?? [];
  const questions = doc.questions ?? [];
  if (!Array.isArray(ownership)) bad("ownership must be a list");
  if (!Array.isArray(questions)) bad("questions must be a list");

  const verdicts = (doc.verdicts as unknown[]).map((v, i): ModelVerdict => {
    const at = `verdicts[${i}]`;
    if (!isObj(v)) return bad(`${at} is not an object`);
    switch (v.kind) {
      case "keep":
      case "retire":
        onlyKeys(v, ["kind", "id"], at, bad);
        if (!isStr(v.id) || !parseGovId(v.id)) bad(`${at}: ${v.kind} needs the GOV id of an existing rule`);
        return { kind: v.kind, id: v.id as string };
      case "revise":
        onlyKeys(v, ["kind", "id", "row"], at, bad);
        if (!isStr(v.id) || !parseGovId(v.id)) bad(`${at}: revise needs the GOV id of an existing rule`);
        return { kind: "revise", id: v.id as string, row: parseRow(v.row, `${at}.row`, bad) };
      case "add":
        // Q17: a NEW rule's id is issued by gov. A model that numbers rules is refused, not corrected — an id it
        // made up would look exactly like one gov issued.
        if ("id" in v || (isObj(v.row) && "id" in v.row)) {
          throw new ProposeError("model-issued-id", `the model's reply: ${at} gives a new rule an id — ids are issued by gov, never by the model`);
        }
        onlyKeys(v, ["kind", "row"], at, bad);
        return { kind: "add", row: parseRow(v.row, `${at}.row`, bad) };
      default:
        return bad(`${at}: kind must be keep, revise, retire or add`);
    }
  });

  const own = (ownership as unknown[]).map((o, i): ProposedOwnership => {
    const at = `ownership[${i}]`;
    if (!isObj(o)) return bad(`${at} is not an object`);
    onlyKeys(o, ["section", "role"], at, bad);
    if (!isStr(o.section) || !/^\d+(\.\d+)*$/.test(o.section)) bad(`${at}: section must be a section number like "4" or "4.2"`);
    if (!isStr(o.role)) bad(`${at}: role must be the name of a role`);
    return { section: o.section as string, role: (o.role as string).trim() };
  });

  const qs = (questions as unknown[]).map((q, i): ProposalQuestion => {
    const at = `questions[${i}]`;
    if (!isObj(q)) return bad(`${at} is not an object`);
    onlyKeys(q, ["id", "text", "options", "kind", "contradicts"], at, bad);
    if (!isStr(q.id)) bad(`${at}: id is required`);
    if (!isStr(q.text)) bad(`${at}: text is required`);
    if (q.options !== undefined && (!Array.isArray(q.options) || !q.options.every(isStr))) bad(`${at}: options must be a list of strings`);
    if (q.kind !== undefined && !KINDS.includes(q.kind as string)) bad(`${at}: kind "${String(q.kind)}" is not one of ${KINDS.join(", ")}`);
    if (q.contradicts !== undefined && !isStr(q.contradicts)) bad(`${at}: contradicts must be a GOV-FRM id`);
    return {
      id: q.id as string, text: q.text as string,
      ...(q.options ? { options: q.options as string[] } : {}),
      ...(q.kind ? { kind: q.kind as QuestionKind } : {}),
      ...(q.contradicts ? { contradicts: q.contradicts as string } : {}),
    };
  });
  return { verdicts, ownership: own, questions: qs };
}

function onlyKeys(o: Obj, allowed: readonly string[], at: string, bad: (m: string) => never): void {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k));
  if (extra.length) bad(`${at} has unexpected field(s) ${extra.join(", ")}`);
}

function parseRow(r: unknown, at: string, bad: (m: string) => never): ProposedRow {
  if (!isObj(r)) return bad(`${at} is not an object`);
  onlyKeys(r, ["expectation", "actor", "level", "cue", "checks"], at, bad);
  if (!isStr(r.expectation)) bad(`${at}: expectation is required`);
  if (!Array.isArray(r.actor) || !r.actor.every((a) => ACTORS.includes(a as string))) bad(`${at}: actor must be a list of ${ACTORS.join(", ")}`);
  if (!LEVELS.includes(r.level as string)) bad(`${at}: level must be C01, C02 or C03`);
  let cue: ProposedRow["cue"];
  if (r.cue !== undefined) {
    if (!isObj(r.cue) || (r.cue.tier !== "resident" && r.cue.tier !== "on-demand") || !isStr(r.cue.text)) bad(`${at}.cue needs tier (resident|on-demand) and text`);
    onlyKeys(r.cue as Obj, ["tier", "text"], `${at}.cue`, bad);
    cue = { tier: (r.cue as Obj).tier as "resident" | "on-demand", text: (r.cue as Obj).text as string };
  }
  let checks: CheckBinding[] | undefined;
  if (r.checks !== undefined) {
    if (!Array.isArray(r.checks)) bad(`${at}.checks must be a list`);
    checks = (r.checks as unknown[]).map((c, i) => {
      const ca = `${at}.checks[${i}]`;
      if (!isObj(c)) return bad(`${ca} is not an object`);
      onlyKeys(c, ["on", "action", "with", "on_miss"], ca, bad);
      if (!isObj(c.on) || !isStr(c.on.resource) || !isStr(c.on.event)) bad(`${ca}.on needs resource and event`);
      if (!isStr(c.action)) bad(`${ca}: action is required`);
      if (c.with !== undefined && !isObj(c.with)) bad(`${ca}.with must be an object`);
      if (c.on_miss !== "fail" && c.on_miss !== "warn") bad(`${ca}: on_miss must be fail or warn`);
      const on = c.on as Obj;
      return {
        on: { resource: on.resource as string, event: on.event as string },
        action: c.action as string,
        ...(c.with ? { with: c.with as Record<string, unknown> } : {}),
        on_miss: c.on_miss as "fail" | "warn",
      };
    });
  }
  return {
    expectation: (r.expectation as string).trim(),
    actor: r.actor as Actor[],
    level: r.level as Level,
    ...(cue ? { cue } : {}),
    ...(checks ? { checks } : {}),
  };
}

/** What a section's proposal is checked against. */
export interface ProposalContext {
  readonly doc: string;
  readonly section: string;
  readonly sha: string;
  /** The section's rules IN FORCE — the only ids a keep/revise/retire may name. */
  readonly rows: readonly RuleRow[];
  /** The org store's scope (`org_slug`). */
  readonly scope: string;
  readonly catalog: Catalog;
  /** The framework's rules in force — what a contradiction may cite. */
  readonly frameworkRules: readonly RuleRow[];
  /** The org's role names, when known. Absent → ownership roles are not checked here. */
  readonly roles?: readonly string[];
  /** Ids of questions already answered in this interview: gov does not ask its own twice. */
  readonly answered: ReadonlySet<string>;
  /**
   * The interview so far. A question answered on a pull request comes back keyed by its thread, not by gov's id, so
   * gov's own questions are matched by id OR by their text; and the cue question needs the answer itself.
   */
  readonly qa?: readonly ProposalNote[];
}

/** One line of the interview gov writes itself — the same shape as an answered question. */
export interface ProposalNote { readonly id: string; readonly q: string; readonly a: string; }

export interface ProposalCheck {
  /** For the MODEL to correct. */
  readonly problems: readonly string[];
  /** For the OWNER to answer: the model's own, normalised, plus gov's. */
  readonly questions: readonly ProposalQuestion[];
  /** The verdicts as gov settles them: an on-demand cue with no check made resident (the owner's choice) or dropped. */
  readonly verdicts: readonly ModelVerdict[];
  /** What gov decided on its own, for the interview (and so the row's `qa` and the changelog). */
  readonly notes: readonly ProposalNote[];
}

/** Q19: the owner's two ways out for an on-demand cue on a C01 rule binding agents that has no check. */
export const CUE_RESIDENT = "make it a resident cue: every agent session reads it from the start";
export const CUE_DROP = "drop the cue: nothing can trigger it until the rule has a check";
/** What the interview records when gov drops an on-demand cue that nothing could show. */
export const NO_CUE_NOTE = "no cue: nothing can trigger it until the rule has a check";

const choseResident = (a: string): boolean => {
  const t = a.trim();
  return t === CUE_RESIDENT || /^1\b/.test(t) || (/\bresident\b/i.test(t) && !/\bdrop\b/i.test(t));
};

/** Store diagnostics about what gov — not the model — supplies (id, stamps, history) are not the model's to fix. */
const GOVS_OWN: ReadonlySet<RowDiagnosticKind> = new Set(["bad-id", "wrong-scope", "bad-source", "bad-stamp", "two-in-force", "broken-chain", "end-before-start"]);

/** The stamp a candidate row is validated with. Never written: applyVerdicts stamps the real rows. */
const PROBE_STAMP = { version: "0.0.0", date: "1970-01-01" } as const;

const shortHash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 10);

/** The owner's answer to gov's question `id` (asked as `text`), or undefined when it has not been answered. */
function answerOf(ctx: ProposalContext, id: string, text: string): string | undefined {
  const x = ctx.qa?.find((y) => y.id === id || y.q === text);
  if (x) return x.a;
  return ctx.answered.has(id) ? "" : undefined;
}

export function checkProposal(p: SectionProposal, ctx: ProposalContext): ProposalCheck {
  const problems: string[] = [];
  const questions: ProposalQuestion[] = [];
  const notes: ProposalNote[] = [];
  const mine = new Set(ctx.rows.map((r) => r.id));
  const seen = new Map<string, number>();

  for (const v of p.verdicts) {
    if (v.kind === "add") continue;
    seen.set(v.id, (seen.get(v.id) ?? 0) + 1);
    if (!mine.has(v.id)) problems.push(`${v.kind} ${v.id}: that id is not a rule of section ${ctx.section} in force — keep, revise and retire may name only the existing rows you were given`);
  }
  for (const [id, n] of seen) if (n > 1) problems.push(`${id}: classified ${n} times — give each existing rule exactly one verdict`);

  // Every existing rule needs its verdict once the model has nothing left to ask — a rule left out would be
  // neither kept nor retired, and its stale sha would bring the section back on every run.
  if (p.questions.length === 0) {
    for (const id of mine) if (!seen.has(id)) problems.push(`${id}: no verdict — classify every existing rule as keep, revise or retire`);
  }

  const fwIds = new Set(ctx.frameworkRules.map((r) => r.id));
  for (const q of p.questions) {
    if (q.kind === "contradiction") {
      if (!q.contradicts || !fwIds.has(q.contradicts) || parseGovId(q.contradicts)?.scope !== FRAMEWORK_SCOPE) {
        problems.push(`question ${q.id}: a contradiction must cite the GOV-FRM id of a framework rule in force (got "${q.contradicts ?? ""}")`);
        continue;
      }
      // W2-Q2: an org rule that contradicts a framework rule cannot be approved AS WRITTEN. The ways out are
      // gov's to state, not the model's — "approve anyway" is not one of them.
      questions.push({
        ...q,
        options: [`drop the rule — ${q.contradicts} stands`, `reword it so it no longer contradicts ${q.contradicts} (say how)`, `change the policy prose and re-run propose`],
      });
      continue;
    }
    questions.push(q);
  }

  // Q19: an on-demand cue is shown when its rule's CHECK fires — keyed by the check's resource and event. On a row
  // with no check nothing can ever show it, so gov does not accept one. A C01 rule binding agents may carry a
  // resident cue instead (every agent session reads it), and the owner chooses; any other rule loses the cue, and
  // the interview says so.
  const verdicts = p.verdicts.map((v): ModelVerdict => {
    if ((v.kind !== "add" && v.kind !== "revise") || v.row.cue?.tier !== "on-demand" || (v.row.checks?.length ?? 0) > 0) return v;
    const { cue, ...bare } = v.row;
    const h = shortHash(v.row.expectation);
    if (v.row.level === "C01" && v.row.actor.some((a) => a === "agent" || a === "everyone")) {
      const id = `cue-tier:${h}`;
      const text = `"${v.row.expectation}" has an on-demand cue, but an on-demand cue is shown only when the rule's check fires, and this rule has no check. As a C01 rule binding agents, its cue can be resident instead. Which?`;
      const a = answerOf(ctx, id, text);
      if (a === undefined) { questions.push({ id, kind: "cue-tier", text, options: [CUE_RESIDENT, CUE_DROP] }); return v; }
      return choseResident(a) ? { ...v, row: { ...v.row, cue: { tier: "resident", text: cue!.text } } } : { ...v, row: bare };
    }
    notes.push({ id: `cue-dropped:${h}`, q: `The proposed rule "${v.row.expectation}" came with an on-demand cue. When would it be shown?`, a: NO_CUE_NOTE });
    return { ...v, row: bare };
  });

  verdicts.forEach((v, i) => {
    if (v.kind !== "add" && v.kind !== "revise") return;
    const cand: RuleRow = { id: `GOV-${ctx.scope}-000`, source: { doc: ctx.doc, section: ctx.section, sha: ctx.sha }, ...v.row, start: PROBE_STAMP, end: null };
    const label = v.kind === "add" ? `new rule #${i + 1} ("${v.row.expectation}")` : `revision of ${v.id}`;
    for (const d of validateRuleStore([cand], { scope: ctx.scope })) {
      if (!GOVS_OWN.has(d.kind) && !ROW_WARNINGS.has(d.kind)) problems.push(`${label}: ${d.message.replace(cand.id + ": ", "")}`);
    }
    for (const d of validateBindings(cand, ctx.catalog)) problems.push(`${label}: ${d.message.replace(cand.id + ": ", "")}`);

    // Q15: a C01 rule bound only to OBSERVE events cannot stop the violation, only notice it. Allowed — but the
    // owner must say so, once.
    const checks = v.row.checks ?? [];
    if (v.row.level === "C01" && checks.length > 0) {
      const modes = checks.map((c) => ctx.catalog.resources.find((r) => r.id === c.on.resource)?.events.find((e) => e.name === c.on.event)?.mode);
      if (modes.every((m) => m === "observe")) {
        const id = `c01-observe-only:${shortHash(v.row.expectation)}`;
        const text = `"${v.row.expectation}" is C01 (no exceptions), but every check on it runs after the fact — a breach will be detected, never prevented. Accept that?`;
        if (answerOf(ctx, id, text) === undefined) {
          questions.push({ id, kind: "c01-observe-only", text, options: ["accept: detected after the fact", "lower the level", "bind it to a gate event instead"] });
        }
      }
    }
  });

  // W2-Q8: a section handed to a role the org does not have would route its approval to nobody.
  if (ctx.roles) {
    for (const o of p.ownership) {
      if (ctx.roles.includes(o.role)) continue;
      const id = `ownership-role:${o.section}:${shortHash(o.role)}`;
      const text = `The policy says section ${o.section} is owned by "${o.role}", which is not a role in the org's role list. Which role owns it?`;
      if (answerOf(ctx, id, text) !== undefined) { problems.push(`ownership of section ${o.section}: "${o.role}" is not in the role list — use the role the owner named in the Q&A`); continue; }
      questions.push({ id, kind: "ownership-role", text, options: [...ctx.roles] });
    }
  }
  return { problems, questions, verdicts, notes };
}
