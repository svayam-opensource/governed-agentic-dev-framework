// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT `gov-builtin/frontmatter-required` MEANS, IN ONE PLACE — for both engines (diff-check over a changeset,
 * verb-gate over a workspace). Two copies of "what counts as a valid field" would drift; one cannot.
 *
 * KNOWLEDGE FRONT MATTER IS THE ORGANIZATION'S CHOICE (Policy Owner, 2026-10-06). The framework mandates no field
 * and no value: gov once hard-coded a domain / layer / compliance / status taxonomy and `gov validate` checked it on
 * every repository, whether the organization wanted it or not. Now it is checked only when the org's own policy
 * says so — `gov rules propose` turns such a clause into a rule bound to this action, with the org's own fields and
 * values as params:
 *
 *   keys:   [owner, …]                          each must be present (the key line exists)
 *   fields: { domain: [a, b], owner: null, … }  each must be present with a non-empty value; a value list limits
 *                                                the value to one of those; null / [] / "" means any value
 *
 * A field the org did not list is never judged. Pure.
 */

/** The org's requirement, parsed from the binding's params. */
export interface FrontmatterSpec {
  /** Keys that must be present, any value (the original `keys=` form). */
  readonly keys: readonly string[];
  /** Field → its allowed values; `null` = present, any non-empty value. */
  readonly fields: Readonly<Record<string, readonly string[] | null>>;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** A leading `---` block as key → value, or null when the text has none. Values are unquoted, comments dropped. */
export function parseFrontMatter(text: string): Record<string, string> | null {
  const m = FM_RE.exec(text);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (line.trimStart().startsWith("#") || /^\s/.test(line)) continue;
    const i = line.indexOf(":");
    if (i <= 0) continue;
    let v = line.slice(i + 1).trim();
    const q = /^(["'])(.*)\1$/.exec(v);
    if (q) v = q[2];
    else v = v.replace(/\s+#.*$/, "").trim();
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

/**
 * The spec from a check's string attributes (`keys` comma-joined; `fields` as JSON — see builtin.ts `asAttr`).
 * A malformed `fields` is an error, never an empty spec: a check that silently requires nothing reads as enforced.
 */
export function parseFrontmatterSpec(keysAttr: string, fieldsAttr: string): { spec: FrontmatterSpec } | { error: string } {
  const keys = keysAttr.split(",").map((s) => s.trim()).filter(Boolean);
  const fields: Record<string, readonly string[] | null> = {};
  if (fieldsAttr) {
    let raw: unknown;
    try { raw = JSON.parse(fieldsAttr); } catch {
      // Not logged: the error is returned, and the caller reports it as a check that could not run.
      return { error: "fields= is not a map of field → allowed values" };
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { error: "fields= is not a map of field → allowed values" };
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) fields[k] = null;
      else if (Array.isArray(v) && v.every((x) => typeof x === "string")) fields[k] = v.map((x) => x.trim());
      else if (typeof v === "string") fields[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
      else return { error: `fields.${k} must be a list of allowed values, or empty for any value` };
    }
  }
  if (!keys.length && !Object.keys(fields).length) return { error: "neither keys= nor fields= — it requires nothing" };
  return { spec: { keys, fields } };
}

/** Every way `text` falls short of `spec`, as short phrases ("domain='x' is not one of a, b"). `[]` = valid. */
export function frontmatterProblems(text: string, spec: FrontmatterSpec): string[] {
  const fm = parseFrontMatter(text) ?? {};
  const out: string[] = [];
  const missing = spec.keys.filter((k) => !(k in fm));
  for (const [k, allowed] of Object.entries(spec.fields)) {
    const v = fm[k];
    if (v === undefined || v === "") { if (!missing.includes(k)) missing.push(k); continue; }
    if (allowed && !allowed.includes(v)) out.push(`${k}='${v}' is not one of ${allowed.join(", ")}`);
  }
  if (missing.length) out.unshift(`is missing front matter ${missing.join(", ")}`);
  return out;
}
