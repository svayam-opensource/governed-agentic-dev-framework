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
import { CHECK_OWNER_ROLE, POLICY_OWNER_ROLE, ROLE_LIST_PATH, resolveRoles, roleAlternates, roleHandles } from "../config/role-list.js";
import { GOVERNANCE_PATH, frameworkAlternates, frameworkOwners, parseGovernance } from "../config/governance.js";
import { actingPolicyOwner, soloMode } from "../rules/checks/policy-actions.js";

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
    // Q46 A: a vacant Check Owner's alternate approves the code in its place; with none, the Policy Owner does.
    const alt = normalizeHandle(frameworkAlternates(parseGovernance(governanceText)).checkOwnerAlternate);
    return {
      name, status: "warn",
      detail: `vacant — \`${CHECK_OWNER.key}\` is empty in ${GOVERNANCE_PATH}, so `
        + (alt ? `its alternate (${alt}) approves the code of` : `the Policy Owner${policy ? ` (${policy})` : ""} also approves the code of`)
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
    // Q46 A: while the role is vacant its alternate acts as the Policy Owner for approvals — but the role still needs
    // a holder: CODEOWNERS cannot be generated without one. Still a failure, worded for what does and does not work.
    const alt = governanceText === null ? null : normalizeHandle(frameworkAlternates(parseGovernance(governanceText)).policyOwnerAlternate);
    return {
      name: "policy owner", status: "fail",
      detail: (governanceText === null ? `no ${GOVERNANCE_PATH} — run \`gov upgrade\`, which moves the governance choices there from org-config.yaml. ` : "")
        + (alt
          ? `vacant — \`policy_owner.github\` is empty. Its alternate (${alt}) approves in its place, and holds every vacant role,`
            + " but CODEOWNERS cannot be generated without a holder (GOV-FRM-033)."
          : "vacant — `policy_owner.github` is empty, so no policy change has an approver, no vacant role has anyone to"
            + " fall to, and CODEOWNERS cannot be generated (GOV-FRM-033).")
        + ` Name the Policy Owner in ${GOVERNANCE_PATH}.`,
    };
  }
  return { name: "policy owner", status: "ok", detail: `${policy} approves the rules, and holds every vacant role` };
}

/**
 * W2-Q5: the org's roles. The table in `policies/common/authorized-representatives.md` is the list — there is no fallback
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

/**
 * EVERY ROLE HAS AN ALTERNATE (Policy Owner ruling F143 A, 2026-11-23): the person who approves in the role's place
 * when its holder wrote the change, or the role is vacant. A role without one WARNS — advisory, as a vacant Check
 * Owner does: the role is still approved by somebody (the fallback), just not by a named stand-in.
 *
 * `undefined` governance text = nobody looked (no row).
 */
export function alternatesDiagnostic(governanceText: string | null | undefined, roleListText: string | null | undefined): Diagnostic | null {
  if (governanceText === undefined) return null;
  const gov = parseGovernance(governanceText);
  const roles = resolveRoles(roleListText ?? null).roles;
  const alternates = roleAlternates(frameworkAlternates(gov), roles);
  const all = [POLICY_OWNER_ROLE, CHECK_OWNER_ROLE, ...roles.map((r) => r.role)];
  const without = all.filter((r) => !alternates[r]);
  const name = "alternates";
  if (!without.length) return { name, status: "ok", detail: `every role has an alternate (${all.length} role(s))` };
  return {
    name, status: "warn",
    detail: `no alternate for ${without.join(", ")} — when the holder writes a change (or the role is vacant), it falls to`
      + ` the Policy Owner, then the Check Owner, instead of a named stand-in. The Policy Owner names one by pull request:`
      + ` \`policy_owner.alternate\` / \`check_owner.alternate\` in ${GOVERNANCE_PATH}, the Alternate column in ${ROLE_LIST_PATH}.`,
  };
}

/**
 * SOLO MODE (Policy Owner ruling Q45 C, 2026-11-23): at most one person is named in any role or as any alternate. Under
 * soft posture, a merge nobody else could approve is recorded as a self-merge (evidence, not a violation) while this
 * lasts. A WARN, never a failure: a one-person organization is a real state, and it should know it is in it.
 */
export function soloModeDiagnostic(governanceText: string | null | undefined, roleListText: string | null | undefined): Diagnostic | null {
  if (governanceText === undefined) return null;
  const gov = parseGovernance(governanceText);
  const roles = resolveRoles(roleListText ?? null).roles;
  const rules = { roles: roleHandles(frameworkOwners(gov), roles), alternates: roleAlternates(frameworkAlternates(gov), roles) };
  const acting = actingPolicyOwner(rules);   // a vacant Policy Owner's alternate acts for it (Q46 A)
  if (!acting) return null;   // the policy-owner row already fails; nobody is named at all
  if (!soloMode(rules)) return null;
  const hard = gov.posture.posture === "hard";
  return {
    name: "solo mode", status: "warn",
    detail: `nobody but ${normalizeHandle(acting) ?? acting} holds a role or alternate, so nobody else can approve a change.`
      + (hard ? " Under hard posture such a change cannot merge." : " Under soft posture a merge with no second approver is recorded as \"self-merged: no second person\", not as a violation.")
      + ` Name a second person — a Check Owner or an alternate — in ${GOVERNANCE_PATH} to end it.`,
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
