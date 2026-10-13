// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * COMMIT 3 OF THE BRIDGE: WHAT THE 1.0 LAYOUT'S FILES HELD, CARRIED TO WHERE 2.0 KEEPS IT (PRJ-121 intent 01, B06;
 * spec §4.2).
 *
 *   - `knowledge/policies/llm-governance.md` → `policies/governance.yaml` (the org's approved agents), by the
 *     existing named migration `approved-agents-to-org-config`; the file is retired after.
 *   - `knowledge/policies/roles.md` → the role list (`policies/common/authorized-representatives.md`): a holder the
 *     role registry names by a literal GitHub handle reaches the list. A holder named by a token (`<LEGAL_OWNER_GITHUB>`)
 *     is the pre-split org-config's, which `org-config-split` carries; the framework roles (Policy Owner, Check Owner)
 *     are set in governance.yaml. Nothing the list already names is overridden (GOV-FRM-445: the org's list is the org's).
 *
 * The org-config split itself is a manifest migration and runs first (it writes the governance file and the role
 * list this reads); the org files a 2.0 org needs but this one lacks are seeded by the manifest's own rows.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ROLE_LIST_PATH, POLICY_OWNER_ROLE, CHECK_OWNER_ROLE } from "../../config/role-list.js";
import { GOVERNANCE_PATH } from "../../config/governance.js";
import type { PlanAction } from "../upgrade-sync.js";

export const LLM_GOVERNANCE_OLD = "knowledge/policies/llm-governance.md";
export const ROLES_MD_OLD = "knowledge/policies/roles.md";
const BUILD_POLICY = "policies/build/policy.md";

const FRAMEWORK_ROLES = new Set([POLICY_OWNER_ROLE.toLowerCase(), CHECK_OWNER_ROLE.toLowerCase()]);
const VACANT = new Set(["", "-", "—", "–", "vacant", "(vacant)", "none", "tbd"]);
const unquote = (s: string): string => s.replace(/`/g, "").trim();

/** The literal GitHub handle a cell names (`@x`), or null for a token, a vacancy or something that is not a handle. */
function literalHandle(raw: string): string | null {
  const v = unquote(raw);
  if (VACANT.has(v.toLowerCase()) || /<[A-Za-z_]+>/.test(v)) return null;
  const h = v.replace(/^@+/, "");
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]+)?$/.test(h) ? `@${h}` : null;
}

/** Each role of the registry, in order, with the literal handle it names (null: a token, a vacancy, or none). */
export function rolesMdHolders(text: string): { role: string; handle: string | null }[] {
  const out: { role: string; handle: string | null }[] = [];
  let current: { role: string; handle: string | null } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { current = { role: h[1]!, handle: null }; out.push(current); continue; }
    const row = /^\|\s*GitHub Handle\s*\|\s*(.*?)\s*\|?\s*$/i.exec(line);
    if (row && current) current.handle = literalHandle(row[1]!);
  }
  return out;
}

const cells = (line: string): string[] => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSeparator = (line: string): boolean => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());
const isRoleHeader = (c: readonly string[]): boolean =>
  c.length >= 3 && c[0]!.toLowerCase() === "role" && c[1]!.toLowerCase().startsWith("github") && c[2]!.toLowerCase().startsWith("owns");

/**
 * The role list with roles.md's holders carried in: a role the list lacks is added (owning nothing), a role the list
 * leaves vacant or still shows as a token takes the registry's handle, and a holder the list already names is kept.
 * Returns the list unchanged when there is nothing to carry, and null when it has no role table.
 */
export function migrateRolesMd(rolesMd: string, roleList: string): string | null {
  const lines = roleList.split("\n");
  const head = lines.findIndex((l, i) => l.trim().startsWith("|") && isRoleHeader(cells(l)) && isSeparator(lines[i + 1] ?? ""));
  if (head < 0) return null;
  let end = head + 2;
  while (end < lines.length && lines[end]!.trim().startsWith("|")) end++;
  const rows = lines.slice(head + 2, end);
  for (const { role, handle } of rolesMdHolders(rolesMd)) {
    if (handle === null || FRAMEWORK_ROLES.has(role.toLowerCase())) continue;
    const at = rows.findIndex((r) => unquote(cells(r)[0] ?? "").toLowerCase() === role.toLowerCase());
    if (at < 0) { rows.push(`| ${role} | ${handle} | — |`); continue; }
    const c = cells(rows[at]!);
    const now = unquote(c[1] ?? "");
    if (VACANT.has(now.toLowerCase()) || /<[A-Za-z_]+>/.test(now)) rows[at] = `| ${c[0]} | ${handle} | ${c[2] ?? "—"} |`;
  }
  return [...lines.slice(0, head + 2), ...rows, ...lines.slice(end)].join("\n");
}

/** The named migrations the bridge adds to gov's own (run by `gov upgrade`, like the manifest's). */
export const BRIDGE_MIGRATIONS: Readonly<Record<string, (adopterDir: string, from: string, to: string) => boolean | string>> = {
  "roles-md-to-role-list": (adopterDir, from, to) => {
    const fromPath = path.join(adopterDir, from), toPath = path.join(adopterDir, to);
    if (!fs.existsSync(fromPath)) return true;
    if (!fs.existsSync(toPath)) return false;                       // no role list to write into: leave everything alone
    const next = migrateRolesMd(fs.readFileSync(fromPath, "utf8"), fs.readFileSync(toPath, "utf8"));
    if (next === null) return `${to} has no role table — nothing carried from ${from}; add the holders by hand`;
    fs.writeFileSync(toPath, next, "utf8");
    fs.rmSync(fromPath, { force: true });
    return true;
  },
};

/** The planned migrations for a 1.0 repository: which of the two files are there. */
export function migrationPlan(exists: (rel: string) => boolean, shipped: (rel: string) => boolean = () => false): { actions: PlanAction[]; taken: string[] } {
  const actions: PlanAction[] = [];
  // A 1.0 org never had the build phase's policy, and an upgrade never plans a `seed-new` starter — so the bridge
  // seeds it (§4.2 commit 3), once, where the org has none.
  if (shipped(BUILD_POLICY) && !exists(BUILD_POLICY)) actions.push({ kind: "create", src: BUILD_POLICY, dst: BUILD_POLICY, commit: "migrations", detail: "the build phase's policy, seeded once for this org" });
  if (exists(LLM_GOVERNANCE_OLD)) {
    actions.push({ kind: "migrate", from: LLM_GOVERNANCE_OLD, dst: GOVERNANCE_PATH, how: "approved-agents-to-org-config", commit: "migrations", detail: "the org's approved agents go into governance.yaml; the retired file is removed" });
  }
  if (exists(ROLES_MD_OLD)) {
    actions.push({ kind: "migrate", from: ROLES_MD_OLD, dst: ROLE_LIST_PATH, how: "roles-md-to-role-list", commit: "migrations", detail: "the role registry's holders reach the role list; the retired file is removed" });
  }
  return { actions, taken: actions.map((a) => a.from!) };
}
