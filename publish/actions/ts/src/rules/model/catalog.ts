// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE CATALOG: RESOURCES, THEIR EVENTS, TOOLS AND ACTIONS (rule-model-design.md Q13–Q15, Q22; 2026-10-06).
 *
 * A check is an ACTION run when a RESOURCE emits an EVENT. The LLM that proposes rules binds them; it does not
 * invent resources or events, and an action it writes enters the catalog only after the Check Owner reviews the
 * code (`policies/actions/`, CODEOWNERS-routed). The framework ships its own catalog in `framework/rules/`.
 *
 * Every event is a GATE (it can refuse: a PR's required check, a gov verb) or an OBSERVE (it already happened: a
 * push, an issue closed). That one bit decides what a failing check can do, and so the class an auditor sees:
 * `prevented` means the violation cannot land; `detected` means it is noticed after it has.
 *
 * Pure: text in, catalog and diagnostics out.
 */
import yaml from "js-yaml";
import type { RuleRow } from "./rule-row.js";

export type EventMode = "gate" | "observe";

export interface ResourceEvent {
  readonly name: string;
  readonly mode: EventMode;
  /** observe only: the catalog-declared way to reverse it (e.g. reopen an issue). Absent → report only. */
  readonly undo?: string;
}

export interface Resource {
  /** `vcs.code-repo`, `vcs.gov-repo`, `vcs.framework-repo`, `pms.issue`, `pms.project`, `gov.verb`, … */
  readonly id: string;
  /**
   * What renders a binding into this resource's native automation (`github-actions`, `gov-verb`, …). ABSENT means
   * nothing can listen yet: a rule bound only here is `cannot-tell`, never `prevented` or `detected` (Q14).
   */
  readonly renderer?: string;
  readonly events: readonly ResourceEvent[];
}

/** `gov-builtin`, `bash`, `python`, `gh-action`, `llm`. An `llm` tool's verdict never blocks (Q22). */
export interface Tool { readonly id: string; }

export interface Action {
  /** `<tool>/<name>`, e.g. `gov-builtin/list-membership`. */
  readonly id: string;
  readonly tool: string;
  /** The parameters `with:` may carry, as a JSON-Schema-shaped object. Validated by the check engine (W6). */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Who reviewed the code, and where. Required for an org-authored action; framework actions are reviewed upstream. */
  readonly reviewed?: { readonly by: string; readonly pr: number };
}

export interface Catalog {
  readonly resources: readonly Resource[];
  readonly tools: readonly Tool[];
  readonly actions: readonly Action[];
}

/** One check on a rule row: when (resource + event), what (action + parameters), and what a miss does. */
export interface CheckBinding {
  readonly on: { readonly resource: string; readonly event: string };
  readonly action: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly on_miss: "fail" | "warn";
}

/** What holds a rule up, derived from its row and the catalog — never stored, so it cannot drift. */
export type RuleClass = "prevented" | "detected" | "judged" | "cued" | "advisory" | "cannot-tell";

export function parseCatalog(text: string): Catalog {
  const doc = (yaml.load(text, { schema: yaml.JSON_SCHEMA }) ?? {}) as Partial<Catalog>;
  return { resources: doc.resources ?? [], tools: doc.tools ?? [], actions: doc.actions ?? [] };
}

/** Merge the framework's catalog with the org's. An org may ADD entries; an id defined twice is the framework's. */
export function mergeCatalogs(framework: Catalog, org: Catalog): Catalog {
  const add = <T extends { id: string }>(a: readonly T[], b: readonly T[]): T[] => {
    const seen = new Set(a.map((x) => x.id));
    return [...a, ...b.filter((x) => !seen.has(x.id))];
  };
  return { resources: add(framework.resources, org.resources), tools: add(framework.tools, org.tools), actions: add(framework.actions, org.actions) };
}

export type BindingDiagnosticKind = "unknown-resource" | "unknown-event" | "unknown-action" | "unknown-tool" | "llm-on-gate" | "bad-on-miss";

export interface BindingDiagnostic { readonly kind: BindingDiagnosticKind; readonly id: string; readonly message: string; }

const toolOf = (c: Catalog, actionId: string): string | undefined => c.actions.find((a) => a.id === actionId)?.tool;
const eventOf = (c: Catalog, b: CheckBinding): { res?: Resource; ev?: ResourceEvent } => {
  const res = c.resources.find((r) => r.id === b.on.resource);
  return { res, ev: res?.events.find((e) => e.name === b.on.event) };
};

/** Every binding on a row must resolve in the catalog; an LLM judge may only observe. */
export function validateBindings(row: RuleRow, c: Catalog): BindingDiagnostic[] {
  const out: BindingDiagnostic[] = [];
  const d = (kind: BindingDiagnosticKind, message: string) => out.push({ kind, id: row.id, message });
  for (const b of row.checks ?? []) {
    const { res, ev } = eventOf(c, b);
    if (!res) d("unknown-resource", `${row.id}: no resource "${b.on.resource}" in the catalog`);
    else if (!ev) d("unknown-event", `${row.id}: ${b.on.resource} emits no event "${b.on.event}"`);
    const tool = toolOf(c, b.action);
    if (tool === undefined) d("unknown-action", `${row.id}: no action "${b.action}" in the catalog`);
    else if (!c.tools.some((t) => t.id === tool)) d("unknown-tool", `${row.id}: action ${b.action} names tool "${tool}", which the catalog lacks`);
    if (tool === "llm" && ev?.mode === "gate") d("llm-on-gate", `${row.id}: an LLM judge never blocks — bind ${b.action} to an observe event`);
    if (b.on_miss !== "fail" && b.on_miss !== "warn") d("bad-on-miss", `${row.id}: on_miss must be fail or warn`);
  }
  return out;
}

/**
 * The class of a row. Strongest wins: a rule with one gate check is `prevented` however many observe checks it
 * also has. A check on a resource nothing can listen to does not count — if that leaves no live check, the rule is
 * `cannot-tell` rather than quietly `cued` or `advisory`, because it CLAIMS a check that does not run.
 */
export function classifyRow(row: RuleRow, c: Catalog): RuleClass {
  const live = (row.checks ?? []).map((b) => ({ b, ...eventOf(c, b), tool: toolOf(c, b.action) })).filter((x) => x.res?.renderer && x.ev);
  if (live.some((x) => x.ev!.mode === "gate" && x.tool !== "llm")) return "prevented";
  if (live.some((x) => x.ev!.mode === "observe" && x.tool !== "llm")) return "detected";
  if (live.some((x) => x.tool === "llm")) return "judged";
  if ((row.checks ?? []).length > 0) return "cannot-tell";
  return row.cue ? "cued" : "advisory";
}
