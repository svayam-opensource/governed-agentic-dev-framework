// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ORG'S ROLE LIST (W2-Q5, rule-model P3, 2026-10-06).
 *
 * The framework defines TWO roles — the Policy Owner and the Check Owner — and their holders live in
 * `org-config.yaml`. Every other role is the organization's: it decides which roles exist, who holds each, and which
 * `knowledge/` folders each one owns. Until now four of them (Legal, Infrastructure, System Architecture, Data
 * Architecture) were hard-coded in `codeowners.ts` with their holders in `*_owner_github` keys — the framework
 * deciding something the policy says is the org's.
 *
 * WHERE IT LIVES. A small table in `policies/authorized-representatives.md`, the seed-once document an org already
 * owns and already reads to learn who approves what. Humans read the prose around it; gov reads only the table:
 *
 *   | Role        | GitHub handle | Owns                |
 *   |-------------|---------------|---------------------|
 *   | Data Owner  | @dana         | `knowledge/data/`   |
 *
 * The table is found by its header (Role · GitHub handle · Owns), never by its position, so an org can move it or
 * write around it freely. A table inside a code fence is an example and is skipped.
 *
 * THREE ANSWERS KEPT APART, as everywhere a policy file is read:
 *   no table        → `found: false`. NOT "the org defines no roles": the caller falls back (below).
 *   a vacant role   → `holder: null`. A state, not a fault — the Policy Owner holds it (GOV-SVM-033).
 *   a row gov cannot route (bad handle, unresolved token, folder outside `knowledge/`) → a problem, said row by
 *                     row; the rest of the table still loads, and the unroutable part reads as vacant.
 *
 * THE FALLBACK, FOR ONE RELEASE. An org set up before this table existed has its holders in the old
 * `*_owner_github` keys, and its copy of the seed-once document has no table. {@link resolveRoles} reads the keys
 * then, with the folders the framework used to hard-code ({@link LEGACY_DOMAIN_ROLES}); `gov doctor` says so.
 *
 * Pure: text in, values out. The callers (store-io at a git ref, doctor from the worktree, setup) do the reading.
 */
import { readTopLevelScalar } from "../resolve/node-env.js";

/** Where the role list lives, repo-relative. */
export const ROLE_LIST_PATH = "policies/authorized-representatives.md";

/** The framework's own two roles. Never in the org's table — their holders are in org-config.yaml. */
export const POLICY_OWNER_ROLE = "Policy Owner";
export const CHECK_OWNER_ROLE = "Check Owner";
const FRAMEWORK_ROLES = new Set([POLICY_OWNER_ROLE.toLowerCase(), CHECK_OWNER_ROLE.toLowerCase()]);

/** One role the org defines. */
export interface RoleHolder {
  readonly role: string;
  /** `@login` (or `@org/team`), or null when the role is vacant. */
  readonly holder: string | null;
  /** Repo-relative `knowledge/` folders, each ending in `/`. Empty when the role owns no folder. */
  readonly owns: readonly string[];
}

export type RoleListParse =
  | { readonly found: false }
  | { readonly found: true; readonly roles: readonly RoleHolder[]; readonly problems: readonly string[] };

/** The four domain roles the framework hard-coded before the role list — read from org-config for one release. */
export const LEGACY_DOMAIN_ROLES: readonly { readonly key: string; readonly role: string; readonly owns: readonly string[] }[] = [
  { key: "legal_owner_github", role: "Legal Owner", owns: ["knowledge/legal/"] },
  { key: "infra_owner_github", role: "Infrastructure Owner", owns: ["knowledge/infrastructure/"] },
  { key: "system_arch_owner_github", role: "System Architecture Owner", owns: ["knowledge/architecture/system/"] },
  { key: "data_arch_owner_github", role: "Data Architecture Owner", owns: ["knowledge/architecture/data/"] },
];

/** GitHub's login shape (1–39, alnum and single hyphens), or `org/team`. */
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]+)?$/;
const VACANT = new Set(["", "-", "—", "–", "vacant", "(vacant)", "none", "tbd"]);

const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSeparator = (line: string): boolean => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());
const isHeader = (c: readonly string[]): boolean => {
  const [a, b, d] = c.map((x) => x.toLowerCase().replace(/[*_`]/g, "").trim());
  return c.length >= 3 && a === "role" && (b ?? "").startsWith("github") && (d ?? "").startsWith("owns");
};
const unquote = (s: string): string => s.replace(/`/g, "").trim();

/** `@x` / `x` → `@x`; vacancy → null; a cell gov cannot use → an error string. */
function parseHolder(raw: string): string | null | { error: string } {
  const v = unquote(raw);
  if (VACANT.has(v.toLowerCase())) return null;
  if (/<[A-Za-z_]+>/.test(v)) return { error: `still carries the unresolved token ${/<[A-Za-z_]+>/.exec(v)![0]}` };
  const h = v.replace(/^@+/, "");
  if (!HANDLE.test(h)) return { error: `"${v}" is not a GitHub handle` };
  return `@${h}`;
}

/** Parse the role table out of the document. */
export function parseRoleList(markdown: string): RoleListParse {
  const lines = markdown.split(/\r?\n/);
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line.trim().startsWith("|") || !isHeader(cells(line))) continue;
    if (!isSeparator(lines[i + 1] ?? "")) continue;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j]!.trim().startsWith("|"); j++) rows.push(cells(lines[j]!));
    return { found: true, ...readRows(rows) };
  }
  return { found: false };
}

function readRows(rows: readonly string[][]): { roles: RoleHolder[]; problems: string[] } {
  const roles: RoleHolder[] = [];
  const problems: string[] = [];
  const seenRole = new Set<string>();
  const folderOwner = new Map<string, string>();
  for (const c of rows) {
    const role = unquote(c[0] ?? "");
    if (!role) { problems.push("a row with no role name was skipped"); continue; }
    if (FRAMEWORK_ROLES.has(role.toLowerCase())) {
      problems.push(`${role} is a framework role — its holder is set in org-config.yaml, so this row is ignored`);
      continue;
    }
    if (seenRole.has(role.toLowerCase())) { problems.push(`${role} is listed twice — the first row is used`); continue; }
    seenRole.add(role.toLowerCase());

    const h = parseHolder(c[1] ?? "");
    let holder: string | null = null;
    if (h !== null && typeof h === "object") problems.push(`${role}: the handle ${h.error} — read as vacant`);
    else holder = h;

    const owns: string[] = [];
    for (const raw of unquote(c[2] ?? "").split(",").map((s) => s.trim())) {
      if (VACANT.has(raw.toLowerCase())) continue;
      const folder = `${raw.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
      if (/[*?[\]]|(^|\/)\.\.?(\/|$)/.test(folder)) { problems.push(`${role}: ${raw} is a pattern, not a folder — skipped`); continue; }
      if (folder === "knowledge/") { problems.push(`${role}: knowledge/ itself belongs to the Policy Owner — name a folder inside it`); continue; }
      if (!folder.startsWith("knowledge/")) { problems.push(`${role}: ${raw} is not under knowledge/ — a role owns knowledge folders; policy sections are owned by sentence (ownership.yaml)`); continue; }
      const prior = folderOwner.get(folder);
      if (prior !== undefined) { problems.push(`${role}: ${folder} is already owned by ${prior} — skipped`); continue; }
      folderOwner.set(folder, role);
      owns.push(folder);
    }
    roles.push({ role, holder, owns });
  }
  return { roles, problems };
}

export interface ResolvedRoles {
  /** Where the roles came from: the org's table, or (for one release) the old org-config keys. */
  readonly source: "role-list" | "org-config";
  readonly roles: readonly RoleHolder[];
  readonly problems: readonly string[];
}

/** The org's roles: from the table when there is one, else from the legacy `*_owner_github` keys. */
export function resolveRoles(orgConfigText: string | null | undefined, roleListText: string | null | undefined): ResolvedRoles {
  const parsed = roleListText ? parseRoleList(roleListText) : ({ found: false } as const);
  if (parsed.found) return { source: "role-list", roles: parsed.roles, problems: parsed.problems };
  const cfg = orgConfigText ?? "";
  return {
    source: "org-config",
    problems: [],
    // Only the keys the config actually carries: a config that never had them defines none of these roles.
    roles: LEGACY_DOMAIN_ROLES.flatMap((r) => {
      const raw = readTopLevelScalar(cfg, r.key);
      if (raw === null) return [];
      const h = parseHolder(raw);
      return [{ role: r.role, holder: typeof h === "string" ? h : null, owns: r.owns }];
    }),
  };
}

/**
 * Role → handle, the shape `RuleSet.roles` carries. The Policy Owner and Check Owner ALWAYS come from org-config (a
 * vacant Check Owner reads as the Policy Owner, GOV-FRM-033); every org role is present by name, a vacant one as
 * `""` — so a check routes it to the Policy Owner, and propose still knows the role exists.
 */
export function roleHandles(orgConfigText: string | null | undefined, roles: readonly RoleHolder[]): Record<string, string> {
  const cfg = orgConfigText ?? "";
  const handle = (key: string): string => (readTopLevelScalar(cfg, key) ?? "").trim();
  const policyOwner = handle("policy_owner_github");
  const checkOwner = handle("check_owner_github") || policyOwner;
  const out: Record<string, string> = {};
  if (policyOwner) out[POLICY_OWNER_ROLE] = policyOwner;
  if (checkOwner) out[CHECK_OWNER_ROLE] = checkOwner;
  for (const r of roles) if (!(r.role in out)) out[r.role] = r.holder ?? "";
  return out;
}
