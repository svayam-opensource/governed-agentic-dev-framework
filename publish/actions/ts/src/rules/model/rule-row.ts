// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE RULE ROW AND ITS REVISION HISTORY (rule-model-design.md Q5, Q8–Q11, Q19; 2026-10-06).
 *
 * Two stores share this schema: `framework/rules/rules.yaml` (written only by `gov upgrade`) and
 * `policies/rules.yaml` (written only by an approved org policy PR). Each has exactly one writer, so an upgrade can
 * never touch an org row.
 *
 * A store is an APPEND-ONLY HISTORY. One row per revision; a change closes the current row at version X and opens a
 * new one starting at X; the row with no `end` is in force; a rule is retired when its last row is closed with no
 * successor. The id never goes away.
 *
 * The policy prose a row came from is never touched: the row carries the NORMALISED expectation the Policy Owner
 * approved, the source section's sha (so a changed section marks its rows for re-review), and the cue and checks.
 *
 * Pure: text in, rows and diagnostics out.
 */
import yaml from "js-yaml";
import { parseGovId, FRAMEWORK_SCOPE } from "./gov-id.js";
import type { CheckBinding } from "./catalog.js";

export type Level = "C01" | "C02" | "C03";
/** `everyone` = {agent, human}. `gov-client` is the framework's alone: only it makes promises about gov. */
export type Actor = "gov-client" | "agent" | "human" | "everyone";
const LEVELS: readonly string[] = ["C01", "C02", "C03"];
const ACTORS: readonly string[] = ["gov-client", "agent", "human", "everyone"];

/** When a revision took (or ceased to take) effect. Framework rows cite a framework release; org rows `policies/VERSION`. */
export interface Stamp {
  readonly version: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** The PR whose merge made it so. Absent only on framework rows stamped at release. */
  readonly pr?: number;
}

export interface RuleRow {
  readonly id: string;
  readonly source: { readonly doc: string; readonly section: string; readonly sha: string };
  /** `<Actor> <verb> <one observable action>`, LLM-normalised and owner-approved (Q9). The verb is NOT the level (Q10). */
  readonly expectation: string;
  readonly actor: readonly Actor[];
  readonly level: Level;
  readonly cue?: { readonly tier: "resident" | "on-demand"; readonly text: string };
  readonly checks?: readonly CheckBinding[];
  readonly start: Stamp;
  readonly end: Stamp | null;
  /** The interview that settled this revision (Q18). */
  readonly qa?: readonly { readonly q: string; readonly a: string }[];
}

export type RowDiagnosticKind =
  | "bad-id" | "wrong-scope" | "bad-source" | "bad-expectation" | "bad-actor" | "bad-level" | "bad-stamp"
  | "gov-client-in-org" | "resident-cue-not-c01" | "resident-cue-no-agent"
  | "two-in-force" | "broken-chain" | "end-before-start";

export interface RowDiagnostic {
  readonly kind: RowDiagnosticKind;
  readonly id: string;
  /** 0-based position in the store, so the message can be found. */
  readonly index: number;
  readonly message: string;
}

/**
 * Parse a store. YAML timestamps and numbers are read as STRINGS where the schema says string, so `1.4.0` and
 * `2026-10-06` round-trip exactly; a row that is not an object fails validation rather than parsing.
 */
export function parseRuleStore(text: string): RuleRow[] {
  const doc = yaml.load(text, { schema: yaml.JSON_SCHEMA }) ?? [];
  if (!Array.isArray(doc)) throw new Error("rule store: expected a YAML list of rows");
  return doc.map((r) => normaliseStamps(r as Record<string, unknown>)) as unknown as RuleRow[];
}

/** JSON_SCHEMA keeps dates as strings; a bare `1.4` version would still arrive as a number, so stringify it. */
function normaliseStamps(r: Record<string, unknown>): Record<string, unknown> {
  const fix = (s: unknown): unknown => {
    if (!s || typeof s !== "object") return s;
    const o = s as Record<string, unknown>;
    return { ...o, version: o.version === undefined ? undefined : String(o.version), date: o.date === undefined ? undefined : String(o.date) };
  };
  return { ...r, start: fix(r.start), end: r.end === undefined ? null : fix(r.end) };
}

/** Compare dotted numeric versions: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const stampOk = (s: Stamp | null | undefined): boolean =>
  !!s && VERSION.test(s.version) && DATE.test(s.date) && (s.pr === undefined || (Number.isInteger(s.pr) && s.pr > 0));

/** The rows in force: the open row of each id. */
export const inForce = (rows: readonly RuleRow[]): RuleRow[] => rows.filter((r) => r.end === null);

/**
 * Every way a store can be wrong. `scope` is the store's own: `FRM` for the framework's, the org slug for the org's.
 * An empty result is a valid store.
 */
export function validateRuleStore(rows: readonly RuleRow[], store: { readonly scope: string }): RowDiagnostic[] {
  const out: RowDiagnostic[] = [];
  const isOrg = store.scope !== FRAMEWORK_SCOPE;
  const byId = new Map<string, { row: RuleRow; index: number }[]>();

  rows.forEach((r, index) => {
    const d = (kind: RowDiagnosticKind, message: string) => out.push({ kind, id: String(r?.id ?? ""), index, message });
    const g = parseGovId(String(r?.id ?? ""));
    if (!g) { d("bad-id", `"${r?.id}" is not a GOV id (GOV-<scope>-NNN)`); return; }
    if (g.scope !== store.scope) d("wrong-scope", `${r.id} does not belong in the ${store.scope} store`);
    if (!r.source || !r.source.doc || !r.source.section || !r.source.sha) d("bad-source", `${r.id}: source needs doc, section and sha`);
    if (typeof r.expectation !== "string" || r.expectation.trim() === "") d("bad-expectation", `${r.id}: the expectation is empty`);
    if (!LEVELS.includes(r.level)) d("bad-level", `${r.id}: level "${r.level}" is not C01, C02 or C03`);

    const actors = Array.isArray(r.actor) ? r.actor : [];
    if (actors.length === 0 || actors.some((a) => !ACTORS.includes(a)) || new Set(actors).size !== actors.length) {
      d("bad-actor", `${r.id}: actor must be a non-empty set of ${ACTORS.join(", ")}`);
    } else if (actors.includes("everyone") && actors.length > 1) {
      d("bad-actor", `${r.id}: "everyone" already means agent and human — it stands alone`);
    }
    if (isOrg && actors.includes("gov-client")) d("gov-client-in-org", `${r.id}: only the framework makes promises about gov (actor gov-client)`);

    if (r.cue?.tier === "resident") {
      if (r.level !== "C01") d("resident-cue-not-c01", `${r.id}: a resident cue is only for a C01 rule — use tier on-demand`);
      if (!actors.some((a) => a === "agent" || a === "everyone")) d("resident-cue-no-agent", `${r.id}: a resident cue is read by agents; no agent is bound by this rule`);
    }

    if (!stampOk(r.start)) d("bad-stamp", `${r.id}: start needs version x.y.z and date YYYY-MM-DD`);
    if (r.end !== null && !stampOk(r.end)) d("bad-stamp", `${r.id}: end needs version x.y.z and date YYYY-MM-DD, or null`);
    if (r.end && stampOk(r.start) && stampOk(r.end) && compareVersions(r.end.version, r.start.version) < 0) {
      d("end-before-start", `${r.id}: ends at ${r.end.version}, before it starts at ${r.start.version}`);
    }
    const list = byId.get(r.id) ?? [];
    list.push({ row: r, index });
    byId.set(r.id, list);
  });

  // The revision chain of each id: ordered by start, each closed row handing over to the next at one version.
  for (const [id, list] of byId) {
    if (list.some(({ row }) => !stampOk(row.start))) continue; // already reported; the chain cannot be judged
    const chain = [...list].sort((a, b) => compareVersions(a.row.start.version, b.row.start.version));
    const open = chain.filter(({ row }) => row.end === null);
    if (open.length > 1) out.push({ kind: "two-in-force", id, index: open[1].index, message: `${id}: ${open.length} rows are in force — close all but the latest` });
    for (let i = 0; i + 1 < chain.length; i++) {
      const cur = chain[i].row, next = chain[i + 1].row;
      if (cur.end === null) {
        if (open.length <= 1) out.push({ kind: "two-in-force", id, index: chain[i].index, message: `${id}: an earlier revision is still open` });
      } else if (compareVersions(cur.end.version, next.start.version) !== 0) {
        out.push({ kind: "broken-chain", id, index: chain[i + 1].index, message: `${id}: revision ending ${cur.end.version} is followed by one starting ${next.start.version} — they must meet` });
      }
    }
  }
  return out;
}
