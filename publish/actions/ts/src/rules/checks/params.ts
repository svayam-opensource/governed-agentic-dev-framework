// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE CATALOG'S OWN SANITY, AND AN ACTION'S PARAMETERS (rule-model-design.md Q13; W6).
 *
 * `parseCatalog` reads; `validateBindings` judges a ROW against the catalog. Neither judges the catalog itself — a
 * duplicate id, an event that is neither gate nor observe, an action naming a tool that is not there. Those would
 * surface later as a rule that reads as checked and is not, so they are reported here, at the file.
 *
 * An action's `params` is a JSON-Schema-SHAPED object. Only the subset the catalog uses is honoured — `required`,
 * `properties.<k>.type` (one or a list of string · array · number · boolean · object), `enum`, and
 * `additionalProperties: false`. An unknown key is refused when `additionalProperties` is false because the
 * likeliest unknown key is a typo (`pattrn=`), and a typo'd parameter is a check that silently checks nothing.
 *
 * Pure.
 */
import type { Catalog } from "../model/catalog.js";

/** Every way the catalog file itself is wrong. Empty = usable. */
export function lintCatalog(c: Catalog): string[] {
  const out: string[] = [];
  const dupes = (kind: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) out.push(`duplicate ${kind} "${id}"`);
      seen.add(id);
    }
  };
  dupes("resource", c.resources.map((r) => r.id));
  dupes("tool", c.tools.map((t) => t.id));
  dupes("action", c.actions.map((a) => a.id));

  for (const r of c.resources) {
    if (!Array.isArray(r.events)) { out.push(`resource "${r.id}": events must be a list`); continue; }
    dupes(`event of ${r.id}`, r.events.map((e) => e.name));
    for (const e of r.events) {
      if (e.mode !== "gate" && e.mode !== "observe") out.push(`resource "${r.id}" event "${e.name}": mode "${String(e.mode)}" is neither gate nor observe`);
      if (e.undo !== undefined && e.mode === "gate") out.push(`resource "${r.id}" event "${e.name}": undo on a gate — a gate refuses, there is nothing to undo`);
    }
  }
  const tools = new Set(c.tools.map((t) => t.id));
  for (const a of c.actions) {
    const slash = a.id.indexOf("/");
    if (slash <= 0 || a.id.slice(0, slash) !== a.tool) out.push(`action "${a.id}" is not <tool>/<name> for its tool "${a.tool}"`);
    if (!tools.has(a.tool)) out.push(`action "${a.id}": unknown tool "${a.tool}"`);
  }
  return out;
}

type JsonType = "string" | "array" | "number" | "boolean" | "object";
const typeOf = (v: unknown): JsonType | "null" =>
  v === null ? "null" : Array.isArray(v) ? "array" : (typeof v as JsonType);

/** Problems with `given` against an action's `params` schema. No schema → anything goes. */
export function validateParams(schema: Readonly<Record<string, unknown>> | undefined, given: Readonly<Record<string, unknown>> | undefined): string[] {
  if (!schema) return [];
  const out: string[] = [];
  const g = given ?? {};
  const props = (schema.properties ?? {}) as Record<string, { type?: string | string[]; enum?: unknown[] }>;
  for (const k of (schema.required ?? []) as string[]) if (!(k in g)) out.push(`requires "${k}"`);
  for (const [k, v] of Object.entries(g)) {
    const p = props[k];
    if (!p) {
      if (schema.additionalProperties === false) out.push(`unknown parameter "${k}" (known: ${Object.keys(props).join(", ") || "none"})`);
      continue;
    }
    const types = p.type === undefined ? [] : Array.isArray(p.type) ? p.type : [p.type];
    if (types.length && !types.includes(typeOf(v))) out.push(`"${k}" must be ${types.join(" or ")}`);
    if (p.enum && !p.enum.includes(v)) out.push(`"${k}" must be one of ${p.enum.join(", ")}`);
  }
  return out;
}
