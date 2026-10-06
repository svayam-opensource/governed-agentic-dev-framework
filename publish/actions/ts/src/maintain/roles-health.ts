// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE TWO-KEY REVIEW, AS A DOCTOR ROW (rule-model P1 rulings, 2026-10-06).
 *
 * The rule model splits approval in two: the Policy Owner approves what a rule MEANS, the Check Owner approves the
 * CODE that enforces it (`policies/actions/`, CODEOWNERS-routed — see config/codeowners.ts `CHECK_OWNER`). Two
 * states quietly undo that split, and neither shows up anywhere else:
 *
 *   VACANT  `check_owner_github` empty. Every org that upgrades into the rule model starts here — `gov upgrade`
 *           adds the key empty, because gov will not pick a reviewer for an org. CODEOWNERS escalates the path to
 *           the Policy Owner (GOV-FRM-033), which is safe but is one key.
 *   SAME    one handle in both roles. A real choice for a one-person org, and not a fault — but the org should
 *           know the second key is not there, rather than believe two people looked.
 *
 * Both WARN, never fail: the repository is still gated, by somebody.
 *
 * Pure over the org-config TEXT, the way doctor's other org-config rows are, so it reports on a workspace it has
 * not parsed and is tested from a string.
 */
import type { Diagnostic } from "./doctor.js";
import { readTopLevelScalar } from "../resolve/node-env.js";
import { CHECK_OWNER, normalizeHandle, renderCodeowners, codeownersDrift } from "../config/codeowners.js";
import { LEGACY_DOMAIN_ROLES, ROLE_LIST_PATH, resolveRoles } from "../config/role-list.js";

/** The sentence the ruling asked for, exported so the test pins it and nothing paraphrases it. */
export const TWO_KEY_OFF = "intent and code are approved by one person — the two-key review is off";

/** `null` when no config was examined (doctor's own rule: a row about a fact nobody gathered is worse than none). */
export function checkOwnerDiagnostic(orgConfigText: string | null | undefined): Diagnostic | null {
  if (orgConfigText === null || orgConfigText === undefined) return null;
  const policy = normalizeHandle(readTopLevelScalar(orgConfigText, "policy_owner_github"));
  const check = normalizeHandle(readTopLevelScalar(orgConfigText, CHECK_OWNER.key));
  const name = "check owner";
  if (check === null) {
    return {
      name, status: "warn",
      detail: `vacant — \`${CHECK_OWNER.key}\` is empty, so the Policy Owner${policy ? ` (${policy})` : ""} also approves the code of`
        + ` the org's check actions (policies/actions/, GOV-FRM-033). Name a reviewer of code there and re-run \`gov upgrade\`.`,
    };
  }
  // GitHub logins are case-insensitive: `@Carol` and `carol` are one person.
  if (policy !== null && policy.toLowerCase() === check.toLowerCase()) {
    return { name, status: "warn", detail: `${check} is both Policy Owner and Check Owner — ${TWO_KEY_OFF}` };
  }
  return { name, status: "ok", detail: `${check} reviews check-action code; the Policy Owner${policy ? ` (${policy})` : ""} approves the rules` };
}

/**
 * GOV-FRM-033: the Policy Owner has a named holder. Vacant is a FAILURE, unlike the Check Owner: the Check Owner's
 * work falls to the Policy Owner, but nothing falls anywhere when the Policy Owner is missing — no CODEOWNERS can be
 * generated, a vacant role has nobody to fall to, and no policy change has an approver.
 */
export function policyOwnerDiagnostic(orgConfigText: string | null | undefined): Diagnostic | null {
  if (orgConfigText === null || orgConfigText === undefined) return null;
  const policy = normalizeHandle(readTopLevelScalar(orgConfigText, "policy_owner_github"));
  if (policy === null) {
    return {
      name: "policy owner", status: "fail",
      detail: "vacant — `policy_owner_github` is empty, so no policy change has an approver, no vacant role has anyone to"
        + " fall to, and CODEOWNERS cannot be generated (GOV-FRM-033). Name the Policy Owner in org-config.yaml.",
    };
  }
  return { name: "policy owner", status: "ok", detail: `${policy} approves the rules, and holds every vacant role` };
}

/**
 * W2-Q5: where the org's roles came from. The table in `policies/authorized-representatives.md` is the list; an org
 * whose copy of that seed-once document predates it is read from the old `*_owner_github` keys for ONE release, and
 * this row is how it learns that.
 *
 * `roleListText`: the document's text, `null` when it is absent, `undefined` when nobody looked (no row).
 */
export function roleListDiagnostic(orgConfigText: string | null | undefined, roleListText: string | null | undefined): Diagnostic | null {
  if (orgConfigText === null || orgConfigText === undefined || roleListText === undefined) return null;
  const r = resolveRoles(orgConfigText, roleListText);
  const name = "role list";
  if (r.source === "org-config") {
    const keys = LEGACY_DOMAIN_ROLES.map((x) => x.key).join(", ");
    return {
      name, status: "warn",
      detail: `no role table in ${ROLE_LIST_PATH}, so gov reads the old *_owner_github keys in org-config.yaml (${keys})`
        + " — supported for one release. Add the table (Role | GitHub handle | Owns) from the framework's seed of that file.",
    };
  }
  if (r.problems.length) return { name, status: "warn", detail: `${r.problems.length} row problem(s): ${r.problems.join("; ")}` };
  const vacant = r.roles.filter((x) => x.holder === null).map((x) => x.role);
  return {
    name, status: "ok",
    detail: `${r.roles.length} role(s) from ${ROLE_LIST_PATH}`
      + (vacant.length ? `; vacant, so the Policy Owner holds them: ${vacant.join(", ")}` : "; every role held"),
  };
}

/** The CODEOWNERS gov would generate for this config and role list — null when there is no Policy Owner. */
export function expectedCodeowners(orgConfigText: string, roleListText: string | null | undefined): string | null {
  const keys = ["policy_owner_github", CHECK_OWNER.key, ...LEGACY_DOMAIN_ROLES.map((x) => x.key)];
  const handles: Record<string, string | undefined> = {};
  for (const k of keys) handles[k] = readTopLevelScalar(orgConfigText, k) ?? undefined;
  return renderCodeowners(handles, resolveRoles(orgConfigText, roleListText).roles)?.text ?? null;
}

/**
 * GOV-FRM-083: CODEOWNERS is generated, so a copy that routes differently from what gov would write has DRIFTED — a
 * hand edit, or a holder changed in the role list without regenerating. Compared by route, so a comment is not drift.
 *
 * `codeownersText`: the file, `null` when absent, `undefined` when nobody looked (no row). No row either without a
 * Policy Owner: there is nothing to compare against, and the policy-owner row already fails.
 */
export function codeownersDiagnostic(
  orgConfigText: string | null | undefined, roleListText: string | null | undefined, codeownersText: string | null | undefined,
): Diagnostic | null {
  if (orgConfigText === null || orgConfigText === undefined || codeownersText === undefined) return null;
  const want = expectedCodeowners(orgConfigText, roleListText);
  if (want === null) return null;
  const name = "codeowners";
  const regen = "Run `gov upgrade` to regenerate it from org-config.yaml and the role list.";
  if (codeownersText === null) return { name, status: "warn", detail: `no CODEOWNERS — no review is routed to any owner. ${regen}` };
  const d = codeownersDrift(codeownersText, want);
  if (d === null) return { name, status: "ok", detail: "matches the role list" };
  const parts = [
    ...(d.missing.length ? [`missing ${d.missing.join(", ")}`] : []),
    ...(d.extra.length ? [`not generated: ${d.extra.join(", ")}`] : []),
    ...(d.reordered ? ["the same lines in another order (the last match wins, so this routes differently)"] : []),
  ];
  return { name, status: "warn", detail: `drifted — no longer matches what gov generates (a hand edit, or the role list changed since): ${parts.join("; ")}. ${regen}` };
}
