// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * YOUR PREFERENCES — one file, one place (Policy Owner, 2026-09-22/23).
 *
 * `<agent_work_root>/preferences/<gh-login>/preferences.json`: the values the gov CLI needs to run FOR YOU.
 * Beside it in the same folder live the other two kinds of thing that are yours — `*.md`, the behaviour your
 * AGENT takes into account, and `credentials`, your secrets — plus `state/`, which is gov's own.
 *
 * THE LINE THIS FILE MUST NOT CROSS. A key here is a preference, never policy: policy lives in
 * `org-config.yaml` and the org's knowledge, and a preference only ever chooses INSIDE what policy allows.
 * `agent.default` is the shape of that rule — it must name an agent the org approved, and if the org withdraws
 * it the preference is ignored AT USE and gov says so (agent-choice.ts already does this). Nothing that
 * changes what gov does to shared state, or how a script behaves, belongs here.
 *
 * EVERY KEY HAS A DEFAULT THAT IS RIGHT FOR MOST PEOPLE, so nobody has to open the file to get a sensible gov.
 * A value out of range, or a key gov does not know, is REPORTED and ignored — never a reason to stop a command
 * (a broken preferences file must not be able to break `gov doctor`, which is how you would find out).
 */

export const PREFERENCES_VERSION = 1;

/** A setting: where it lives, what it means, what it may be, and what it is when nobody has said. */
export interface PrefSpec {
  readonly key: string;                       // "work.picker.pageSize"
  readonly what: string;                      // one line, printed by `gov preferences`
  readonly def: string | number | boolean | null;
  readonly kind: "string" | "number" | "boolean" | "enum";
  readonly values?: readonly string[];        // for enum
  readonly min?: number; readonly max?: number;
}

/**
 * THE SETTINGS. Adding one means: a default most people would choose, one line a person can read, and a rule
 * for what a valid value is — the three things that keep this file from becoming a junk drawer.
 */
export const PREFS: readonly PrefSpec[] = [
  { key: "agent.default", what: "the agent gov launches for you (must be one your org approves)", def: null, kind: "string" },
  { key: "work.picker.localFirst", what: "list projects already on this machine first (no GitHub call)", def: true, kind: "boolean" },
  { key: "work.picker.localOrder", what: "how the local list is ordered", def: "last-used", kind: "enum", values: ["last-used", "number"] },
  { key: "work.picker.pageSize", what: "how many projects a page of the picker shows", def: 15, kind: "number", min: 5, max: 50 },
  { key: "work.picker.searchThreshold", what: "past this many projects, the picker leads with search", def: 30, kind: "number", min: 0, max: 1000 },
  { key: "display.color", what: "colour in gov's own output", def: "auto", kind: "enum", values: ["auto", "always", "never"] },
  { key: "display.menuHeader", what: "show the menu's header once, or on every return", def: "once", kind: "enum", values: ["once", "always"] },
  { key: "logs.keepDays", what: "how many days of run logs to keep", def: 14, kind: "number", min: 1, max: 365 },
];

export const specFor = (key: string): PrefSpec | undefined => PREFS.find((p) => p.key === key);

export type PrefValue = string | number | boolean | null;
export interface Preferences { readonly values: ReadonlyMap<string, PrefValue>; readonly problems: readonly string[] }

/** Read a dotted key out of a parsed object, without `any`. */
function at(obj: unknown, key: string): unknown {
  let cur: unknown = obj;
  for (const part of key.split(".")) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Is this a value the spec allows? Returns why not, or null. */
export function validate(spec: PrefSpec, value: unknown): string | null {
  if (value === null) return spec.def === null ? null : `${spec.key}: null is not one of ${describe(spec)}`;
  switch (spec.kind) {
    case "boolean": return typeof value === "boolean" ? null : `${spec.key}: expected true or false`;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${spec.key}: expected a number`;
      if (spec.min !== undefined && value < spec.min) return `${spec.key}: ${value} is below ${spec.min}`;
      if (spec.max !== undefined && value > spec.max) return `${spec.key}: ${value} is above ${spec.max}`;
      return null;
    }
    case "enum": return typeof value === "string" && spec.values?.includes(value) ? null : `${spec.key}: expected one of ${spec.values?.join(" · ")}`;
    case "string": return typeof value === "string" ? null : `${spec.key}: expected text`;
  }
}

const describe = (spec: PrefSpec): string =>
  spec.kind === "enum" ? (spec.values ?? []).join(" · ") : spec.kind === "number" ? `a number${spec.min !== undefined ? ` ${spec.min}–${spec.max}` : ""}` : spec.kind;

/**
 * Read the file's text into values. NEVER THROWS: unreadable JSON, an unknown key or a value out of range are
 * PROBLEMS to report, and everything else still applies. A person with one bad line keeps a working gov.
 */
export function parsePreferences(text: string | null): Preferences {
  const values = new Map<string, PrefValue>();
  const problems: string[] = [];
  if (text === null || text.trim() === "") return { values, problems };

  let doc: unknown;
  try { doc = JSON.parse(text); } catch (e) {
    return { values, problems: [`preferences.json is not valid JSON (${(e as Error).message}) — gov is using the defaults`] };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { values, problems: ["preferences.json should be a JSON object — gov is using the defaults"] };
  }

  for (const spec of PREFS) {
    const raw = at(doc, spec.key);
    if (raw === undefined) continue;
    const why = validate(spec, raw);
    if (why) { problems.push(`${why} — using the default (${String(spec.def)})`); continue; }
    values.set(spec.key, raw as PrefValue);
  }
  for (const key of unknownKeys(doc)) problems.push(`${key}: gov does not know this setting — ignored`);
  return { values, problems };
}

/** Dotted keys present in the document that no spec claims (`version` is the file's own, not a setting). */
export function unknownKeys(doc: unknown, prefix = ""): string[] {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (key === "version") continue;
    if (specFor(key)) continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const deeper = unknownKeys(v, key);
      // A branch that leads only to known keys is not itself unknown.
      if (deeper.length) out.push(...deeper);
      else if (!PREFS.some((p) => p.key.startsWith(`${key}.`))) out.push(key);
      continue;
    }
    out.push(key);
  }
  return out;
}

/** The value in force for a key: the person's if they set one, else the default. */
export function valueOf(prefs: Preferences, key: string): PrefValue {
  const spec = specFor(key);
  if (!spec) return null;
  return prefs.values.has(key) ? prefs.values.get(key)! : spec.def;
}

/** Typed readers, so callers do not cast at every use. */
export const numberPref = (p: Preferences, key: string): number => Number(valueOf(p, key) ?? 0);
export const boolPref = (p: Preferences, key: string): boolean => valueOf(p, key) === true;
export const stringPref = (p: Preferences, key: string): string | null => {
  const v = valueOf(p, key);
  return typeof v === "string" ? v : null;
};

/** Turn what a person typed (`gov preferences set … 25`) into the value the spec wants, or say why not. */
export function coerce(spec: PrefSpec, typed: string): { value: PrefValue } | { error: string } {
  const t = typed.trim();
  if (t === "" || t.toLowerCase() === "null") {
    return spec.def === null ? { value: null } : { error: `${spec.key}: expected ${describe(spec)}` };
  }
  if (spec.kind === "boolean") {
    if (/^(true|yes|on)$/i.test(t)) return { value: true };
    if (/^(false|no|off)$/i.test(t)) return { value: false };
    return { error: `${spec.key}: expected true or false` };
  }
  if (spec.kind === "number") {
    const n = Number(t);
    const why = validate(spec, n);
    return why ? { error: why } : { value: n };
  }
  const why = validate(spec, t);
  return why ? { error: why } : { value: t };
}

/** The file to write after a change: the values a person has set, nested, with the version stamp. */
export function renderPreferences(values: ReadonlyMap<string, PrefValue>): string {
  const doc: Record<string, unknown> = { version: PREFERENCES_VERSION };
  for (const spec of PREFS) {
    if (!values.has(spec.key)) continue;
    const parts = spec.key.split(".");
    let cur = doc;
    for (const p of parts.slice(0, -1)) {
      if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = values.get(spec.key)!;
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** The starter file a new org gets: the version and nothing else, so every value is gov's default until said. */
export const starterPreferences = (): string => renderPreferences(new Map());

/**
 * `gov preferences` — every setting, its value, whether it is YOURS or gov's default, and what it does.
 * JSON carries no comments, so this listing is the documentation.
 */
export function formatPreferences(prefs: Preferences, file: string): string[] {
  const out = ["", `  Your preferences — ${file}`, ""];
  const width = Math.max(...PREFS.map((p) => p.key.length));
  for (const spec of PREFS) {
    const mine = prefs.values.has(spec.key);
    const value = valueOf(prefs, spec.key);
    out.push(`  ${spec.key.padEnd(width)}  ${String(value ?? "—").padEnd(12)} ${mine ? "(yours) " : "(default)"}  ${spec.what}`);
  }
  if (prefs.problems.length) {
    out.push("", "  Problems in the file (gov used the default for each):");
    for (const p of prefs.problems) out.push(`    ! ${p}`);
  }
  out.push("", "  change:  gov preferences set <key> <value>     ·     undo:  gov preferences reset <key>", "");
  return out;
}
