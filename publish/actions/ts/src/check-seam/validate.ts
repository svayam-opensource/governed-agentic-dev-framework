// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * A small, strict JSON-Schema checker for the seam's own schemas — no dependency. It implements exactly the keywords
 * those schemas use (type, properties, required, additionalProperties: false, enum, const, pattern, minimum,
 * minLength, maxLength, items, oneOf, local `$ref`). A keyword it does not know makes it THROW, so a schema can never
 * be quietly under-checked; the schemas stay standard draft 2020-12, so other services validate them with any
 * conforming validator.
 */
import { SCHEMAS, type SchemaName } from "./schemas.js";

type S = Readonly<Record<string, unknown>>;
const KNOWN = new Set(["$schema", "$id", "$defs", "$ref", "title", "description", "format", "type", "properties", "required",
  "additionalProperties", "enum", "const", "pattern", "minimum", "minLength", "maxLength", "items", "oneOf"]);

/** The problems with `value` against the named schema; empty = valid. */
export function validate(name: SchemaName, value: unknown): readonly string[] {
  const root = SCHEMAS[name];
  const errs: string[] = [];
  check(root, root, value, "$", errs);
  return errs;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function check(root: S, s: S, v: unknown, at: string, errs: string[]): void {
  for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`check-seam validate: schema keyword "${k}" is not supported (at ${at}).`);
  if (typeof s.$ref === "string") {
    const m = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(s.$ref);
    const target = m ? (root.$defs as Record<string, S> | undefined)?.[m[1]!] : undefined;
    if (!target) throw new Error(`check-seam validate: unresolvable $ref ${s.$ref}`);
    check(root, target, v, at, errs);
  }
  if (Array.isArray(s.oneOf)) {
    const passing = (s.oneOf as S[]).filter((sub) => { const e: string[] = []; check(root, sub, v, at, e); return e.length === 0; }).length;
    if (passing !== 1) errs.push(`${at}: must match exactly one allowed shape (matched ${passing})`);
  }
  if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(v)) errs.push(`${at}: must be ${JSON.stringify(s.const)}`);
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) errs.push(`${at}: must be one of ${s.enum.join(", ")}`);
  if (s.type !== undefined) {
    const t = typeOf(v);
    const want = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!want.some((w) => w === t || (w === "number" && t === "integer"))) { errs.push(`${at}: must be ${want.join(" or ")}, is ${t}`); return; }
  }
  if (typeof v === "string") {
    if (typeof s.pattern === "string" && !new RegExp(s.pattern, "u").test(v)) errs.push(`${at}: does not match ${s.pattern}`);
    if (typeof s.minLength === "number" && v.length < s.minLength) errs.push(`${at}: shorter than ${s.minLength}`);
    if (typeof s.maxLength === "number" && v.length > s.maxLength) errs.push(`${at}: longer than ${s.maxLength}`);
  }
  if (typeof v === "number" && typeof s.minimum === "number" && v < s.minimum) errs.push(`${at}: below ${s.minimum}`);
  if (Array.isArray(v) && s.items && typeof s.items === "object") v.forEach((x, i) => check(root, s.items as S, x, `${at}[${i}]`, errs));
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, S>;
    for (const r of (s.required ?? []) as string[]) if (!(r in o)) errs.push(`${at}: missing ${r}`);
    for (const [k, x] of Object.entries(o)) {
      if (props[k]) check(root, props[k], x, `${at}.${k}`, errs);
      else if (s.additionalProperties === false) errs.push(`${at}: field "${k}" is not allowed`);
    }
  }
}
