// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov rules show <id>` — one rule, by its GOV id or by a retired POL number (rule-model-design.md Q21; W3).
 *
 * A POL number resolves through `framework/rules/pol-aliases.yaml`: to the row that carries it now, to the row it
 * was folded into, or to the reason no rule carries it. History keeps citing POL numbers, so this is how an old
 * review comment or commit message is read today.
 *
 * Pure over `read` (repo-relative path → text, or null when absent), so the command is testable on the shipped
 * content with no repository.
 */
import { parseRuleStore, type RuleRow } from "../rules/model/rule-row.js";
import { RULE_STORE_PATHS } from "../rules/model/store-io.js";
import { parseGovId } from "../rules/model/gov-id.js";
import { parsePolAliases, polBase, resolvePol, POL_ALIASES_PATH } from "../rules/model/pol-aliases.js";

export interface ShowResult { readonly code: number; readonly lines: readonly string[] }

/** Every row of both stores; a store that is absent or unreadable contributes none. */
function rows(read: (rel: string) => string | null): RuleRow[] {
  const out: RuleRow[] = [];
  for (const rel of [RULE_STORE_PATHS.frameworkRules, RULE_STORE_PATHS.orgRules]) {
    const text = read(rel);
    if (text === null) continue;
    try { out.push(...parseRuleStore(text)); } catch { /* a store that does not parse shows nothing; `gov doctor` reports it */ }
  }
  return out;
}

/** The row's latest revision: the in-force one, else the last written. */
const latest = (all: readonly RuleRow[], id: string): RuleRow | undefined =>
  all.find((r) => r.id === id && r.end === null) ?? all.filter((r) => r.id === id).pop();

function formatRow(r: RuleRow): string[] {
  return [
    `${r.id} · ${r.level} · ${r.actor.join(", ")} · ${r.end === null ? "in force" : `ended ${r.end.version} (${r.end.date})`}`,
    `  ${r.expectation}`,
    `  source: ${r.source.doc} §${r.source.section}`,
    ...(r.cue ? [`  cue (${r.cue.tier}): ${r.cue.text}`] : []),
    ...(r.checks ?? []).map((c) => `  check: ${c.action} on ${c.on.resource} ${c.on.event} (on miss: ${c.on_miss})`),
  ];
}

function targets(all: readonly RuleRow[], ids: readonly string[]): string[] {
  return ids.flatMap((id) => {
    const r = latest(all, id);
    return r ? ["", ...formatRow(r)] : ["", `${id}: no row in this workspace's rule stores yet`];
  });
}

export function showRule(read: (rel: string) => string | null, id: string): ShowResult {
  const all = rows(read);
  const wanted = id.trim();
  if (parseGovId(wanted)) {
    const r = latest(all, wanted);
    return r ? { code: 0, lines: formatRow(r) } : { code: 1, lines: [`gov rules show: no rule ${wanted} in this workspace's rule stores.`] };
  }
  if (!polBase(wanted)) return { code: 2, lines: [`gov rules show: '${id}' is neither a GOV id (GOV-FRM-012) nor a POL number (POL-012).`] };

  const text = read(POL_ALIASES_PATH);
  if (text === null) return { code: 1, lines: [`gov rules show: ${POL_ALIASES_PATH} is missing, so a POL number cannot be resolved.`] };
  const hit = resolvePol(parsePolAliases(text).aliases, wanted);
  if (!hit) return { code: 1, lines: [`gov rules show: ${polBase(wanted)} is not in ${POL_ALIASES_PATH}.`] };
  const { pol, alias } = hit;
  switch (alias.kind) {
    case "gov":
      return { code: 0, lines: [
        `${pol} is now ${alias.gov}${alias.also.length ? ` (split: also ${alias.also.join(", ")})` : ""}.`,
        ...targets(all, [alias.gov, ...alias.also]),
      ] };
    case "folded":
      return { code: 0, lines: [`${pol} was folded into ${alias.into}.`, ...targets(all, [alias.into])] };
    case "dropped":
      return { code: 0, lines: [`${pol} was dropped: ${alias.reason}`] };
    case "org":
      return { code: 0, lines: [`${pol} is an organization clause: ${alias.note}`] };
  }
}
