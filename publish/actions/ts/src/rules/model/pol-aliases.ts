// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * POL → GOV ALIASES — what became of every retired POL number (rule-model-design.md Q21; W3, 2026-10-06).
 *
 * POL numbers are retired: the rule model cites GOV ids only, and a test fails on any new POL citation. But history
 * is not rewritten, so an old commit message, review comment or knowledge file still says "POL-086b". This module
 * reads `framework/rules/pol-aliases.yaml` and answers, for such a number, which rule carries it now — or why none
 * does. `gov rules show POL-xxx` is its one consumer on the CLI.
 *
 * PURE. Text in, map out; reading the file is the caller's job.
 *
 * A MALFORMED ENTRY IS AN ERROR, NOT A SKIP. An alias silently dropped is a citation that resolves to nothing,
 * which is the very failure the file exists to prevent.
 */
import yaml from "js-yaml";
import { parseGovId } from "./gov-id.js";

/** Where the file lives, relative to the governance repository (and to `publish/content` in the framework). */
export const POL_ALIASES_PATH = "framework/rules/pol-aliases.yaml";

/** The value every organization clause carries until the org's first propose issues its GOV id. */
export const ORG_PENDING = "pending — issued at first propose";

export type PolAlias =
  /** The rule survives under `gov`; a split rule names its other rows in `also`. */
  | { readonly kind: "gov"; readonly gov: string; readonly also: readonly string[] }
  /** It was part of, or restated, that row. */
  | { readonly kind: "folded"; readonly into: string }
  /** No rule carries it. */
  | { readonly kind: "dropped"; readonly reason: string }
  /** An organization's clause; its own GOV id comes at its first propose. */
  | { readonly kind: "org"; readonly note: string };

export interface PolAliases {
  readonly aliases: ReadonlyMap<string, PolAlias>;
  /** One line per entry that could not be read. Empty for a sound file. */
  readonly errors: readonly string[];
}

const POL = /^POL-\d{3}[a-z]?$/;
const isGov = (s: unknown): s is string => typeof s === "string" && parseGovId(s) !== null;

/**
 * The base number of a POL id or label, upper-cased: `pol-040a.3` → `POL-040a`. Null for anything that is not one.
 * A dotted suffix (`POL-040a.1`…`.4`, the labels `gov repo protect plan` once printed) resolves through its base.
 */
export function polBase(id: string): string | null {
  const m = /^POL-(\d{3})([a-z]?)(?:\.\d+)?$/i.exec(id.trim());
  return m ? `POL-${m[1]}${m[2].toLowerCase()}` : null;
}

function entry(pol: string, v: unknown): PolAlias | string {
  if (typeof v === "string") return isGov(v) ? { kind: "gov", gov: v, also: [] } : `${pol}: "${v}" is not a GOV id`;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return `${pol}: expected a GOV id or a { gov | folded | dropped | org } map`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  const kinds = keys.filter((k) => ["gov", "folded", "dropped", "org"].includes(k));
  const extra = keys.filter((k) => !["gov", "folded", "dropped", "org", "also"].includes(k));
  if (kinds.length !== 1 || extra.length) return `${pol}: needs exactly one of gov, folded, dropped or org (has ${keys.join(", ") || "nothing"})`;
  const kind = kinds[0];
  if ("also" in o && kind !== "gov") return `${pol}: only a gov entry may carry also`;
  if (kind === "gov") {
    const also = o.also ?? [];
    if (!isGov(o.gov)) return `${pol}: gov "${String(o.gov)}" is not a GOV id`;
    if (!Array.isArray(also) || !also.every(isGov)) return `${pol}: also must be a list of GOV ids`;
    return { kind: "gov", gov: o.gov, also: also as string[] };
  }
  if (kind === "folded") return isGov(o.folded) ? { kind: "folded", into: o.folded } : `${pol}: folded "${String(o.folded)}" is not a GOV id`;
  const text = o[kind];
  if (typeof text !== "string" || text.trim() === "") return `${pol}: ${kind} needs a reason`;
  return kind === "dropped" ? { kind: "dropped", reason: text } : { kind: "org", note: text };
}

/** Parse `pol-aliases.yaml`. Never throws. */
export function parsePolAliases(text: string): PolAliases {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (e) {
    return { aliases: new Map(), errors: [`the file is not valid YAML: ${(e as Error).message.split("\n")[0]}`] };
  }
  const map = (doc as { aliases?: unknown } | null)?.aliases;
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    return { aliases: new Map(), errors: ["the file has no top-level `aliases:` map"] };
  }
  const aliases = new Map<string, PolAlias>();
  const errors: string[] = [];
  for (const [pol, v] of Object.entries(map as Record<string, unknown>)) {
    if (!POL.test(pol)) { errors.push(`${pol}: not a POL id (POL-NNN, optionally one letter)`); continue; }
    const a = entry(pol, v);
    if (typeof a === "string") errors.push(a);
    else aliases.set(pol, a);
  }
  return { aliases, errors };
}

/** What `id` became, with the number it resolved through; null when it is not a POL id or has no alias. */
export function resolvePol(aliases: ReadonlyMap<string, PolAlias>, id: string): { readonly pol: string; readonly alias: PolAlias } | null {
  const pol = polBase(id);
  const alias = pol ? aliases.get(pol) : undefined;
  return pol && alias ? { pol, alias } : null;
}

/** The GOV ids an alias points at (none for dropped and org-pending). */
export function aliasTargets(a: PolAlias): string[] {
  if (a.kind === "gov") return [a.gov, ...a.also];
  if (a.kind === "folded") return [a.into];
  return [];
}

/** How many aliases of each kind. `mapped` is the survivors (kind `gov`). */
export function countAliases(aliases: ReadonlyMap<string, PolAlias>): { mapped: number; folded: number; dropped: number; org: number } {
  const c = { mapped: 0, folded: 0, dropped: 0, org: 0 };
  for (const a of aliases.values()) c[a.kind === "gov" ? "mapped" : a.kind]++;
  return c;
}
