// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * POL-040a §3.3, AS DIAGNOSTIC ROWS — pure, so the rule is testable without GitHub (PRJ-121, 2026-09-27).
 *
 * Four requirements, one row each, in the order the policy states them. Pure over
 * {@link ProtectionFacts} — `null` included, which is its own row: gh shows branch protection to repository
 * ADMINS only, so "gov has no answer" is the ordinary outcome for most people and must never be rendered as
 * "the branch is open". An unprotected branch and an unknowable one are different facts and read differently.
 *
 * WHAT A FAILING ROW SAYS. Not "misconfigured" — what to turn on, and where. A person reading `gov doctor`
 * has the GitHub settings page one click away, and a diagnostic that names the setting is the difference
 * between a fix and a ticket.
 */
import type { Diagnostic, DiagnosticStatus } from "./doctor.js";
import type { ProtectionFacts } from "../lifecycle/branch-protection.js";

/**
 * The status check that verifies the approver (POL-040a.4 / POL-040b). Named here with a default because the
 * NAME is a convention between the policy and the workflow the framework ships — an org that renamed the
 * workflow has not stopped complying, and doctor should compare against what that org actually requires.
 */
export const APPROVER_CHECK = "approver-check";

export interface ProtectionExpectations {
  /** `owner/name` — printed, so the row says which repo it is about. */
  readonly repo: string;
  readonly branch: string;
  /** The status check that verifies the approver. Defaults to {@link APPROVER_CHECK}. */
  readonly approverCheck?: string;
  /** Why gh could not answer, when `facts` is null. Printed verbatim after the row's own explanation. */
  readonly why?: string;
}

/**
 * One row per requirement of POL-040a §3.3, or a single `warn` row when the facts are unknowable.
 *
 * Deliberately ROWS, not a verdict: "branch protection: 3 of 4" tells a reader to go and find out which,
 * which is the work the report exists to have done already.
 */
export function assessProtection(facts: ProtectionFacts | null, opts: ProtectionExpectations): readonly Diagnostic[] {
  const at = `${opts.repo}@${opts.branch}`;
  const expected = opts.approverCheck ?? APPROVER_CHECK;

  if (facts === null) {
    return [{
      name: "branch protection",
      status: "warn",
      // UNKNOWN IS NOT UNPROTECTED, said in the row itself. A reader who takes this as a pass, or as a
      // failure, is wrong in a way that matters: POL-040a is the only rule that holds for an agent running
      // outside gov, and gov has just said it cannot see it.
      detail: `could not read ${at}${opts.why ? ` — ${opts.why}` : ""}. UNKNOWN IS NOT UNPROTECTED: gov has no answer here, not a clean one — check github.com/${opts.repo}/settings/branches (POL-040a)`,
    }];
  }

  const rows: Diagnostic[] = [
    {
      name: "protection · pull request",
      status: (facts.pullRequestRequired ? "ok" : "fail") as DiagnosticStatus,
      detail: facts.pullRequestRequired
        ? `required before merging on ${at}`
        : `not required on ${at} — POL-040a.1: require a pull request before merging`,
    },
    {
      name: "protection · approving review",
      status: (facts.approvingReviews >= 1 ? "ok" : "fail") as DiagnosticStatus,
      detail: facts.approvingReviews >= 1
        ? `${facts.approvingReviews} required on ${at}`
        : `none required on ${at} — POL-040a.2: require at least one approving review`,
    },
    {
      name: "protection · no bypass",
      status: (facts.enforceAdmins ? "ok" : "fail") as DiagnosticStatus,
      detail: facts.enforceAdmins
        ? `administrators included on ${at}`
        : `administrators and the owner can bypass on ${at} — POL-040a.3: turn on "Do not allow bypassing the above settings"`,
    },
    {
      name: "protection · approver check",
      status: (facts.requiredStatusChecks.includes(expected) ? "ok" : "fail") as DiagnosticStatus,
      // NOT NEGLIGENCE — A GAP THE PLAN LEAVES (POL-040b). On GitHub Free for private repos, "restrict who
      // can push/merge" and CODEOWNERS enforcement are paid features, so ANY collaborator with write access
      // can leave the approving review that satisfies POL-040a.2. The status check is what closes that on
      // every plan. So the row names the thing to add rather than implying somebody was careless.
      detail: facts.requiredStatusChecks.includes(expected)
        ? `\`${expected}\` is a required check on ${at}`
        : `no \`${expected}\` among the required checks on ${at}${facts.requiredStatusChecks.length ? ` (it requires ${facts.requiredStatusChecks.join(", ")})` : " (it requires none)"} — POL-040a.4/POL-040b: an approving review alone cannot prove the approver is authorised, because restricting who may merge and enforcing CODEOWNERS are paid features on GitHub Free for private repos. Add the framework's \`${expected}\` workflow and make it a required check`,
    },
  ];
  return rows;
}
