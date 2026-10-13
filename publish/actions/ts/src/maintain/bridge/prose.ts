// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * COMMIT 4: PROPOSED PROSE — droppable (PRJ-121 intent 01, spec §4.2 commit 4; rulings Q2, T9).
 *
 * A layout-1.0 repository keeps the framework's policy, `knowledge/policies/agentic-development-policy.md`, with the
 * organization's own clauses written into it. 2.0 ships the framework's rules itself, so the policy (and the two
 * procedures documents beside it) is retired — but the org's clauses in it are not the framework's to drop. Which
 * ones are the org's is already written down: `framework/rules/pol-aliases.yaml` maps each one to a `GOV-SVM` id or
 * to `org: pending`. Each such clause found in the policy's clause index is PROPOSED into the 2.0 home for it:
 *
 *   cited under §4–§7 (projects, tasks, code, agents — how the org builds)  → policies/build/policy.md
 *   anywhere else, or nowhere but the index                                → policies/org-policy.md
 *
 * Beside that, every EXACT old path in policies/**\/*.md is rewritten to where 2.0 keeps the file (T9): a whole path
 * only — never inside a longer one, never a prefix — and each rewrite is listed in the PR body, so the list is the
 * diff. All of it is one commit the Policy Owner keeps, edits or drops (Q2); dropping it leaves a valid tree.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { Substitution } from "../upgrade-commits.js";
import type { PlanAction } from "../upgrade-sync.js";
import { aliasTargets, type PolAlias } from "../../rules/model/pol-aliases.js";
import { POL_ALIASES_PATH, parsePolAliases } from "../../rules/model/pol-aliases.js";
import { BRIDGE_MOVES } from "./moves.js";

/** The framework-superseded policy the org's clauses are carried out of. */
export const SUPERSEDED_POLICY = "knowledge/policies/agentic-development-policy.md";
/** Retired with it, in the same commit: the framework's procedures, superseded by framework/ (spec §4.2's table). */
export const SUPERSEDED = [
  SUPERSEDED_POLICY,
  "knowledge/policies/agentic-development-procedures.md",
  "knowledge/policies/procedures/agentic-development-procedures.md",
] as const;

export const ORG_POLICY = "policies/org-policy.md";
export const BUILD_POLICY = "policies/build/policy.md";
/** The heading of the section gov appends — and the only text commit 4 adds besides the listed rewrites. */
export const PROPOSED_HEADING = "## Proposed by the 2.0 upgrade — the organization's own clauses";

export interface OrgClause {
  readonly pol: string;
  /** The org's GOV id when pol-aliases names one (`GOV-SVM-…`); null for a clause still `org: pending`. */
  readonly gov: string | null;
  readonly text: string;
  readonly to: typeof ORG_POLICY | typeof BUILD_POLICY;
}

const isOrgGov = (id: string): boolean => /^GOV-(?!FRM-)[A-Z0-9]+-\d+/.test(id);
/** The org's GOV id an alias carries, if any — `GOV-SVM-033` out of `{ gov: GOV-FRM-033, also: [GOV-SVM-033] }`. */
const orgGovOf = (a: PolAlias): string | null => aliasTargets(a).find(isOrgGov) ?? null;
const isOrgAlias = (a: PolAlias): boolean => a.kind === "org" || (a.kind !== "dropped" && orgGovOf(a) !== null);

/** The policy's clause index: `POL-xxx: text` lines inside the fenced block under `## Clause Index`. */
function clauseIndex(policy: string): Map<string, string> {
  const at = policy.search(/^## Clause Index\s*$/m);
  const out = new Map<string, string>();
  if (at < 0) return out;
  for (const m of policy.slice(at).matchAll(/^(POL-\d{3}[a-z]?):\s*(.+)$/gm)) if (!out.has(m[1]!)) out.set(m[1]!, m[2]!.trim());
  return out;
}

/** The `## N.` section that first cites `pol` in the policy's body (the clause index excluded); null when none does. */
function citingSection(policy: string, pol: string): number | null {
  const end = policy.search(/^## Clause Index\s*$/m);
  const body = end < 0 ? policy : policy.slice(0, end);
  let section: number | null = null;
  for (const line of body.split("\n")) {
    const h = /^## (\d+)\./.exec(line);
    if (h) { section = Number(h[1]); continue; }
    if (new RegExp(`\\b${pol}\\b(?![a-z]|\\.\\d)`).test(line)) return section;
  }
  return null;
}

/**
 * The org's clauses in the policy (sorted by POL id), and the org's aliases the policy does not carry (`missing` —
 * named in the PR body, never invented).
 */
export function orgClauses(policy: string, aliases: ReadonlyMap<string, PolAlias>): { found: OrgClause[]; missing: string[] } {
  const index = clauseIndex(policy);
  const found: OrgClause[] = [];
  const missing: string[] = [];
  for (const [pol, a] of [...aliases].sort(([x], [y]) => x.localeCompare(y))) {
    if (!isOrgAlias(a)) continue;
    const text = index.get(pol);
    if (text === undefined) { missing.push(pol); continue; }
    const s = citingSection(policy, pol);
    found.push({ pol, gov: orgGovOf(a), text, to: s !== null && s >= 4 && s <= 7 ? BUILD_POLICY : ORG_POLICY });
  }
  return { found, missing };
}

export interface Rewrite { readonly from: string; readonly to: string }

/** The old paths with one 2.0 home each (spec §4.2's table). Exception records and folders are added per repo. */
export const OLD_PATH_REWRITES: readonly Rewrite[] = [
  { from: SUPERSEDED_POLICY, to: ORG_POLICY },
  { from: "knowledge/policies/roles.md", to: "policies/common/authorized-representatives.md" },
  { from: "knowledge/policies/llm-governance.md", to: "policies/governance.yaml" },
  ...BRIDGE_MOVES.map((m) => ({ from: m.from, to: m.to })),
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole path: not preceded by a path character, not followed by one (a sentence's full stop is not a path). */
const exact = (p: string): RegExp => new RegExp(`(?<![\\w./-])${escape(p)}(?![\\w/-]|\\.\\w)`, "g");

/** Apply each rewrite in order, exact paths only. `made` lists the rewrites that matched, with how often. */
export function applySubstitutions(text: string, rewrites: readonly Rewrite[]): { text: string; made: { from: string; to: string; count: number }[] } {
  const made: { from: string; to: string; count: number }[] = [];
  let out = text;
  for (const r of rewrites) {
    let count = 0;
    out = out.replace(exact(r.from), () => { count++; return r.to; });
    if (count) made.push({ from: r.from, to: r.to, count });
  }
  return { text: out, made };
}

const OLD_EXCEPTIONS = "knowledge/policies/exceptions/";
/** The rewrites for the exception folder, each `<domain>/` folder and each record a text names (they moved in commit 2). */
function exceptionRewrites(text: string): Rewrite[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/knowledge\/policies\/exceptions\/[a-z0-9][a-z0-9-]*\/(?:[\w.-]+\.md)?/g)) {
    const p = m[0];
    if (/\/(README|TEMPLATE)\.md$/i.test(p)) continue;   // a README stays; the template is retired, not moved
    seen.add(p);
  }
  return [...[...seen].sort().map((p) => ({ from: p, to: `policies/exceptions/${p.slice(OLD_EXCEPTIONS.length)}` })),
    { from: OLD_EXCEPTIONS, to: "policies/exceptions/" }];
}

/** `<TOKEN>` → the org-config value of `token` (lower-cased key), for the clause text gov writes. */
function tokenValues(adopterDir: string): Record<string, string> {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(adopterDir, "org-config.yaml"), "utf8")) as Record<string, unknown> | null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc ?? {})) if (typeof v === "string" && v) out[k.toUpperCase()] = v;
    return out;
  } catch { return {}; /* no readable org-config.yaml: a token stays as written, and the Policy Owner sees it in the proposal */ }
}

function filesUnder(root: string, rel: string): string[] {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((n) => {
    const r = `${rel}/${n}`;
    return fs.statSync(path.join(root, r)).isDirectory() ? filesUnder(root, r) : [r];
  }).sort();
}

/** The retirements of commit 4, planned with the rest so a dry run shows them. Empty unless the policy is there. */
export function prosePlan(exists: (rel: string) => boolean): PlanAction[] {
  if (!exists(SUPERSEDED_POLICY)) return [];
  return SUPERSEDED.filter(exists).map((p) => ({
    kind: "retire" as const, dst: p, commit: "proposed-prose" as const,
    detail: "superseded by the framework; the organization's own clauses in it are proposed into policies/ (commit 4)",
  }));
}

const section = (clauses: readonly OrgClause[], values: Readonly<Record<string, string>>): string => [
  PROPOSED_HEADING,
  "",
  `Carried out of \`${SUPERSEDED_POLICY}\`, which this upgrade retires, by \`gov upgrade\`. Keep, edit or drop each clause;`,
  "`gov rules propose --all` turns the ones you keep into your rules.",
  "",
  ...clauses.map((c) => `- **${c.gov ?? `${c.pol} (pending — its id is issued at the first propose)`}** — ${c.text.replace(/<([A-Z][A-Z_]{2,})>/g, (w, k: string) => values[k] ?? w)}${c.gov ? ` _(was ${c.pol})_` : ""}`),
  "",
].join("\n");

/**
 * Write commit 4 into the working tree: the proposals and the exact-path rewrites. Reads the superseded policy
 * BEFORE its retirement is applied. Does nothing on a repository without it.
 */
export function proposeProse(adopterDir: string, contentDir: string): { substitutions: Substitution[]; proposed: string[] } {
  const read = (rel: string): string | null => { const p = path.join(adopterDir, rel); return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null; };
  const policy = read(SUPERSEDED_POLICY);
  if (policy === null) return { substitutions: [], proposed: [] };
  const aliasText = fs.existsSync(path.join(contentDir, POL_ALIASES_PATH)) ? fs.readFileSync(path.join(contentDir, POL_ALIASES_PATH), "utf8") : "";
  const { found, missing } = orgClauses(policy, parsePolAliases(aliasText).aliases);

  // 1. Exact old-path rewrites in the org's policies — on the text as commit 3 left it.
  const substitutions: Substitution[] = [];
  for (const file of filesUnder(adopterDir, "policies").filter((f) => f.endsWith(".md"))) {
    const before = read(file)!;
    const r = applySubstitutions(before, [...OLD_PATH_REWRITES, ...exceptionRewrites(before)]);
    if (!r.made.length) continue;
    fs.writeFileSync(path.join(adopterDir, file), r.text);
    substitutions.push(...r.made.map((m) => ({ file, ...m })));
  }

  // 2. The org's clauses, appended to their 2.0 home (created when the org has none yet).
  const values = tokenValues(adopterDir);
  const proposed: string[] = [];
  for (const to of [ORG_POLICY, BUILD_POLICY] as const) {
    const mine = found.filter((c) => c.to === to);
    if (!mine.length) continue;
    const now = read(to);
    const head = now === null ? `# ${values.ORG_NAME ?? "Organization"} — ${to === BUILD_POLICY ? "build policy" : "policy"}\n\n` : `${now.trimEnd()}\n\n`;
    fs.mkdirSync(path.dirname(path.join(adopterDir, to)), { recursive: true });
    fs.writeFileSync(path.join(adopterDir, to), head + section(mine, values));
    proposed.push(`\`${to}\`${now === null ? " (new)" : ""}: ${mine.map((c) => c.gov ?? `${c.pol} (pending)`).join(", ")} — from \`${SUPERSEDED_POLICY}\``);
  }
  if (missing.length) proposed.push(`not in \`${SUPERSEDED_POLICY}\`, so not proposed (pol-aliases names them as the organization's): ${missing.join(", ")}`);
  return { substitutions, proposed };
}
