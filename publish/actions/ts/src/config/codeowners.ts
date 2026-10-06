// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CODEOWNERS, GENERATED — never shipped as a template (Decision 13, 2026-09-14).
 *
 * WHY IT IS GENERATED. It shipped as a static file carrying seven unresolved tokens
 * (`<POLICY_OWNER_GITHUB>`, `<LEGAL_OWNER_GITHUB>`, …) because the token sweep covered only
 * `agent/` and `knowledge/`, never the repo root. GitHub cannot resolve those as users or
 * teams, so **no rule applied and `governance/policies/` was unprotected in every adopter
 * repo** — while the policy said changes there require the Policy Owner's approval. A file that
 * looks like an access gate and enforces nothing is the defect this framework keeps finding.
 *
 * Generating it removes the failure mode rather than patching it: nothing with a token in it
 * ever ships, so nothing can arrive unresolved.
 *
 * WHERE EACH HALF COMES FROM (rule-model P3, W2-Q5 / W2-Q7, 2026-10-06).
 *
 *   the framework's two roles (Policy Owner, Check Owner) and what they approve → this module; holders in
 *                                                                                  org-config.yaml
 *   every other role, its holder, and the knowledge/ folders it owns            → the ORG's role list, a table in
 *                                                                                  policies/authorized-representatives.md
 *                                                                                  (config/role-list.ts)
 *
 * The four domain roles this module used to hard-code (Legal, Infrastructure, System / Data Architecture) were the
 * framework deciding which roles an organization has. They now arrive as the org's role list; an org whose copy of
 * the seed-once document predates the table keeps its old `*_owner_github` keys for one release
 * (role-list.ts `resolveRoles`), and `gov doctor` says so.
 *
 * THE POLICY OWNER IS THE FLOOR, AND THE FALLBACK (GOV-FRM-083). Every generated file routes the paths that decide
 * who may change anything to the Policy Owner — `org-config.yaml` (the handle registry), `CODEOWNERS` itself,
 * `agent/`, `framework/`, `projects/` — and both trees an org writes, `knowledge/` and `policies/`, so no folder in
 * either is left without a named owner. A role's own `knowledge/` folders follow, routed to its holder or, while
 * the role is vacant, to the Policy Owner (GOV-SVM-033). `policies/` is routed by FILE here; who approves which
 * SECTION of a policy is the section-owner-approval check's job (W2-Q8), not CODEOWNERS'.
 *
 * ORDER IS ROUTING. CODEOWNERS applies the LAST matching pattern, so the broad Policy Owner lines come first, the
 * role folders after them, and the Check Owner's `policies/actions/` last of all.
 */
import { LEGACY_DOMAIN_ROLES, type RoleHolder } from "./role-list.js";

/** A role the framework defines, and the paths it approves. */
export interface OwnerRole {
  /** The org-config key holding the GitHub handle. */
  readonly key: string;
  /** Human name, for the generated comment. */
  readonly role: string;
  /** Paths this role approves. Empty for the floor, which is handled separately. */
  readonly paths: readonly string[];
}

/**
 * The paths the Policy Owner always approves, whoever else exists.
 *
 * `org-config.yaml` is first deliberately: it holds every other handle, so leaving it ungated
 * would let anyone with write access make themselves the approver of all the rest.
 */
export const POLICY_OWNER_PATHS: readonly string[] = [
  "/org-config.yaml",
  "/CODEOWNERS",
  "/agent/",
  "/framework/",
  "/projects/",
  "/knowledge/",
  "/policies/",
];

/**
 * THE CHECK OWNER — the framework's SECOND built-in role (rule-model P1 rulings, 2026-10-06).
 *
 * The rule model splits one approval into two keys: the Policy Owner approves what a rule MEANS (the prose and
 * the rule rows), the Check Owner approves the CODE that enforces it. An org-authored check action lives in
 * `policies/actions/<id>/` and runs in CI with the org's tokens, so it is reviewed as code by someone who reads
 * code — which a Policy Owner need not be.
 *
 * A vacant Check Owner escalates to the Policy Owner (GOV-FRM-033) and the line is always written:
 * `policies/actions/` exists the moment an org writes a check, and an ungated actions directory is code anyone with
 * write access can make CI run.
 */
export const CHECK_OWNER: OwnerRole = { key: "check_owner_github", role: "Check Owner", paths: ["/policies/actions/"] };

/** `rkant` / `@rkant` / `` → a usable `@handle`, or null when there is nobody. */
export function normalizeHandle(raw: string | null | undefined): string | null {
  const h = (raw ?? "").trim().replace(/^@+/, "");
  return h === "" ? null : `@${h}`;
}

export interface CodeownersResult {
  readonly text: string;
  /** The org's roles that own a folder but have no holder — their folders route to the Policy Owner. */
  readonly vacant: readonly string[];
  /** Built-in roles with no holder, whose paths the Policy Owner approves instead (GOV-FRM-033). */
  readonly escalated: readonly string[];
}

/**
 * Render CODEOWNERS from the org's handles and its role list.
 *
 * `handles` carries the framework roles' org-config keys (`policy_owner_github`, `check_owner_github`). `roles` is
 * the org's role list; left out, it is read from the legacy `*_owner_github` keys in `handles` (one release).
 *
 * Returns null — never a partial file — when there is no Policy Owner: every path in `POLICY_OWNER_PATHS`, and every
 * vacant role's folder, would otherwise be left unprotected, which is exactly the state the shipped template produced.
 */
export function renderCodeowners(
  handles: Readonly<Record<string, string | undefined>>,
  roles: readonly RoleHolder[] = legacyRolesFrom(handles),
): CodeownersResult | null {
  const owner = normalizeHandle(handles.policy_owner_github);
  if (owner === null) return null;

  const lines: string[] = [
    "# GENERATED by gov — do not edit by hand.",
    "#",
    "# The Policy Owner and Check Owner come from org-config.yaml; every other role, its holder and the",
    "# knowledge/ folders it owns come from the role list in policies/authorized-representatives.md.",
    "# Change a holder there and run `gov upgrade` to regenerate this file; `gov doctor` reports a copy",
    "# that no longer matches.",
    "#",
    "# Order is routing: GitHub applies the LAST pattern that matches a file.",
    "",
    "# Policy Owner — the floor, and the owner of every folder no role owns. org-config.yaml is listed",
    "# first because it holds every other handle: an ungated copy is a route to approving everything else.",
  ];
  const pad = (paths: readonly string[]) => Math.max(...paths.map((p) => p.length)) + 2;
  const width = pad(POLICY_OWNER_PATHS);
  for (const p of POLICY_OWNER_PATHS) lines.push(`${p.padEnd(width)}${owner}`);

  const vacant: string[] = [];
  for (const r of roles) {
    if (!r.owns.length) continue;
    const h = normalizeHandle(r.holder);
    if (h === null) vacant.push(r.role);
    lines.push("", h === null ? `# ${r.role} — vacant, so the Policy Owner approves these folders.` : `# ${r.role}`);
    const paths = r.owns.map((f) => `/${f.replace(/^\/+/, "")}`);
    const w = pad(paths);
    for (const p of paths) lines.push(`${p.padEnd(w)}${h ?? owner}`);
  }

  // The Check Owner, LAST: CODEOWNERS applies the last matching pattern, so it must follow `/policies/`.
  const escalated: string[] = [];
  const checker = normalizeHandle(handles[CHECK_OWNER.key]);
  if (checker === null) escalated.push(CHECK_OWNER.role);
  lines.push("", checker === null
    ? `# ${CHECK_OWNER.role} — vacant (${CHECK_OWNER.key} is empty), so the Policy Owner approves this code (GOV-FRM-033).`
    : `# ${CHECK_OWNER.role} — approves the code of the org's check actions; the Policy Owner approves the rules.`);
  const cw = pad(CHECK_OWNER.paths);
  for (const p of CHECK_OWNER.paths) lines.push(`${p.padEnd(cw)}${checker ?? owner}`);

  return { text: `${lines.join("\n")}\n`, vacant, escalated };
}

/** The legacy domain roles, read from org-config keys (one release — see role-list.ts). */
function legacyRolesFrom(handles: Readonly<Record<string, string | undefined>>): RoleHolder[] {
  return LEGACY_DOMAIN_ROLES.filter((r) => handles[r.key] !== undefined)
    .map((r) => ({ role: r.role, holder: normalizeHandle(handles[r.key]), owns: r.owns }));
}

/** A CODEOWNERS file's routes: `pattern owner…` per rule line, whitespace collapsed; comments and blanks dropped. */
function routes(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/).join(" "));
}

export interface CodeownersDrift {
  /** Routes gov would write that the file lacks. */
  readonly missing: readonly string[];
  /** Routes in the file that gov would not write. */
  readonly extra: readonly string[];
  /** Same routes, different order — which, since the last match wins, is different routing. */
  readonly reordered: boolean;
}

/**
 * How a CODEOWNERS on disk differs from the one gov would generate — null when it routes identically.
 *
 * Compared by ROUTE, not by byte: a comment someone adds changes nothing GitHub does, and flagging it would teach
 * people to ignore the row. A changed owner, an added or dropped pattern, or a reordering does change routing.
 */
export function codeownersDrift(actual: string, expected: string): CodeownersDrift | null {
  const a = routes(actual), e = routes(expected);
  if (a.length === e.length && a.every((r, i) => r === e[i])) return null;
  const missing = e.filter((r) => !a.includes(r));
  const extra = a.filter((r) => !e.includes(r));
  return { missing, extra, reordered: !missing.length && !extra.length };
}

/**
 * Does this text still carry an unresolved `<TOKEN>`? (Decision 8, 2026-09-14.)
 *
 * The shipped CODEOWNERS reached every adopter with seven of them and every test passed, so the
 * guard is the point: a generated file with an unresolved handle fails exactly as silently as a
 * shipped one.
 */
export function unresolvedTokens(text: string): readonly string[] {
  return [...new Set(text.match(/<[A-Z][A-Z0-9_]*>/g) ?? [])];
}
