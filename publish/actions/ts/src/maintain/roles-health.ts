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
 *           the Policy Owner (POL-034), which is safe but is one key.
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
import { CHECK_OWNER, normalizeHandle } from "../config/codeowners.js";

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
        + ` the org's check actions (policies/actions/, POL-034). Name a reviewer of code there and re-run \`gov upgrade\`.`,
    };
  }
  // GitHub logins are case-insensitive: `@Carol` and `carol` are one person.
  if (policy !== null && policy.toLowerCase() === check.toLowerCase()) {
    return { name, status: "warn", detail: `${check} is both Policy Owner and Check Owner — ${TWO_KEY_OFF}` };
  }
  return { name, status: "ok", detail: `${check} reviews check-action code; the Policy Owner${policy ? ` (${policy})` : ""} approves the rules` };
}
