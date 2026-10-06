// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE TWO-KEY REVIEW, AS A DOCTOR ROW (rule-model P1 rulings, 2026-10-06).
 *
 * The rule model splits approval in two: the Policy Owner approves what a rule MEANS, the Check Owner approves the
 * CODE that enforces it (`policies/actions/`, CODEOWNERS-routed — see config/codeowners.ts `CHECK_OWNER`). Two
 * states quietly undo that split, and neither shows up anywhere else:
 *
 *   VACANT  `check_owner.github` empty in policies/governance.yaml. An org that upgrades into the rule model starts
 *           here unless it named one — gov will not pick a reviewer for an org. CODEOWNERS escalates the path to
 *           the Policy Owner (GOV-FRM-033), which is safe but is one key.
 *   SAME    one handle in both roles. A real choice for a one-person org, and not a fault — but the org should
 *           know the second key is not there, rather than believe two people looked.
 *
 * Both WARN, never fail: the repository is still gated, by somebody.
 *
 * Pure over the TEXT of policies/governance.yaml (where the two holders live since the org-config split), so it
 * reports on a workspace it has not parsed and is tested from a string. `undefined` = nobody looked (no row);
 * `null` = the file is absent, which for the Policy Owner is a failure: nobody is named.
 */
import type { Diagnostic } from "./doctor.js";
import { CHECK_OWNER, normalizeHandle, renderCodeowners, codeownersDrift } from "../config/codeowners.js";
import { ROLE_LIST_PATH, resolveRoles } from "../config/role-list.js";
import { GOVERNANCE_PATH, frameworkOwners, parseGovernance } from "../config/governance.js";

const owners = (governanceText: string | null): { policy: string | null; check: string | null } => {
  const o = frameworkOwners(parseGovernance(governanceText));
  return { policy: normalizeHandle(o.policyOwner), check: normalizeHandle(o.checkOwner) };
};

/** The sentence the ruling asked for, exported so the test pins it and nothing paraphrases it. */
export const TWO_KEY_OFF = "intent and code are approved by one person — the two-key review is off";

/** `null` when no config was examined (doctor's own rule: a row about a fact nobody gathered is worse than none). */
export function checkOwnerDiagnostic(governanceText: string | null | undefined): Diagnostic | null {
  if (governanceText === undefined) return null;
  const { policy, check } = owners(governanceText);
  const name = "check owner";
  if (check === null) {
    return {
      name, status: "warn",
      detail: `vacant — \`${CHECK_OWNER.key}\` is empty in ${GOVERNANCE_PATH}, so the Policy Owner${policy ? ` (${policy})` : ""} also approves the code of`
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
export function policyOwnerDiagnostic(governanceText: string | null | undefined): Diagnostic | null {
  if (governanceText === undefined) return null;
  const { policy } = owners(governanceText);
  if (policy === null) {
    return {
      name: "policy owner", status: "fail",
      detail: (governanceText === null ? `no ${GOVERNANCE_PATH} — run \`gov upgrade\`, which moves the governance choices there from org-config.yaml. ` : "")
        + "vacant — `policy_owner.github` is empty, so no policy change has an approver, no vacant role has anyone to"
        + ` fall to, and CODEOWNERS cannot be generated (GOV-FRM-033). Name the Policy Owner in ${GOVERNANCE_PATH}.`,
    };
  }
  return { name: "policy owner", status: "ok", detail: `${policy} approves the rules, and holds every vacant role` };
}

/**
 * W2-Q5: the org's roles. The table in `policies/authorized-representatives.md` is the list — there is no fallback
 * to the retired `*_owner_github` keys (the `org-config-split` upgrade carried them into the table).
 *
 * `roleListText`: the document's text, `null` when it is absent, `undefined` when nobody looked (no row).
 */
export function roleListDiagnostic(roleListText: string | null | undefined): Diagnostic | null {
  if (roleListText === undefined) return null;
  const r = resolveRoles(roleListText);
  const name = "role list";
  if (!r.found) {
    return {
      name, status: "warn",
      detail: `no role table in ${ROLE_LIST_PATH}, so this organization defines no roles of its own and the Policy Owner owns`
        + " every folder. Add the table (Role | GitHub handle | Owns) from the framework's seed of that file.",
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

/** The CODEOWNERS gov would generate for these governance choices and role list — null when there is no Policy Owner. */
export function expectedCodeowners(governanceText: string | null | undefined, roleListText: string | null | undefined): string | null {
  return renderCodeowners(frameworkOwners(parseGovernance(governanceText ?? null)), resolveRoles(roleListText).roles)?.text ?? null;
}

/**
 * GOV-FRM-083: CODEOWNERS is generated, so a copy that routes differently from what gov would write has DRIFTED — a
 * hand edit, or a holder changed in the role list without regenerating. Compared by route, so a comment is not drift.
 *
 * `codeownersText`: the file, `null` when absent, `undefined` when nobody looked (no row). No row either without a
 * Policy Owner: there is nothing to compare against, and the policy-owner row already fails.
 */
export function codeownersDiagnostic(
  governanceText: string | null | undefined, roleListText: string | null | undefined, codeownersText: string | null | undefined,
): Diagnostic | null {
  if (governanceText === null || governanceText === undefined || codeownersText === undefined) return null;
  const want = expectedCodeowners(governanceText, roleListText);
  if (want === null) return null;
  const name = "codeowners";
  const regen = `Run \`gov upgrade\` to regenerate it from ${GOVERNANCE_PATH} and the role list.`;
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
