// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * framework-policy §3.3, AS DIAGNOSTIC ROWS — pure, so the rule is testable without GitHub (PRJ-121, 2026-09-27).
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
import { GOVERNANCE_POSTURES, readPosture, type PostureChoice } from "../config/org-config.js";

/**
 * The status check that verifies the approver (framework-policy §3.3's fourth control). Named here with a default because the
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
      // NOT NEGLIGENCE — A GAP THE PLAN LEAVES (framework-policy §3.4). On GitHub Free for private repos, "restrict who
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

/**
 * WHICH POSTURE THIS ORGANIZATION CHOSE — and that nobody chose, when nobody did (Policy Owner, 2026-09-29).
 *
 * Modelled on `agentsDiagnostic`, and for the same reason: a STATE, not a scolding. `soft` is a decision — an
 * organization may adopt the framework for its structure and deliberately leave room for direct work — so it
 * reports `ok`. What warns is the organization that never answered, because it is being governed by a posture
 * it did not pick, and because the two postures are opposite findings about identical facts.
 *
 * `null` when no config was examined. Doctor's own rule: a row about a fact nobody gathered is worse than no row.
 */
export function postureDiagnostic(orgConfigText: string | null | undefined): Diagnostic | null {
  if (orgConfigText === null || orgConfigText === undefined) return null;
  const choice = readPosture(orgConfigText);
  if (choice.unrecognised) {
    return {
      name: "governance posture",
      status: "warn",
      detail: `\`${choice.raw}\` is not a posture gov knows — use ${GOVERNANCE_POSTURES.map((p) => `\`${p}\``).join(" or ")}`
        + ". gov is treating this organization as one that has not chosen, because guessing which was meant is"
        + " the one thing a posture must never be",
    };
  }
  if (choice.posture === null) {
    return {
      name: "governance posture",
      status: "warn",
      // UNSET IS NOT A POSTURE. Said here, because the rows below it are the visible consequence: gov goes on
      // checking POL-040a §3.3, which is right (not choosing is not a choice to skip it) and is exactly the
      // reading an organization should not be left to infer.
      detail: "never chosen — record `governance_posture: hard` (gov installs repository controls, so work"
        + " attempted OUTSIDE gov is stopped by the platform) or `governance_posture: soft` (direct clone,"
        + " commit and push are deliberately left open) in org-config.yaml. Until then gov checks POL-040a §3.3"
        + " anyway: not choosing is not a choice to skip it",
    };
  }
  return choice.posture === "hard"
    ? {
        name: "governance posture",
        status: "ok",
        detail: "hard — the platform is meant to stop work attempted outside gov. `gov repo protect plan` shows"
          + " what is missing; the rows below are the requirements themselves",
      }
    : {
        name: "governance posture",
        status: "ok",
        detail: "soft — this organization deliberately leaves room for direct work, so POL-040a §3.3 is not"
          + " checked. gov's own gates are the only enforcement, and they do not bind an agent started outside gov",
      };
}

/** The posture, or the unset/unrecognised states, from `org-config.yaml`'s text. Re-exported so callers need one import. */
export function postureOf(orgConfigText: string | null | undefined): PostureChoice {
  return readPosture(orgConfigText ?? null);
}

/** POL-040a.2 — the minimum the policy states. One, not two: the policy says "at least one". */
export const WANTED_APPROVING_REVIEWS = 1;

/**
 * ONE SETTING, WHAT IT IS NOW, WHAT POL-040a WANTS — the row `gov repo protect plan` prints.
 *
 * `current` and `wanted` are rendered as WORDS rather than as booleans because the reader is about to compare
 * them with the GitHub settings page, which is also words. `changes` is separate from a string comparison so
 * the caller never has to infer "does this need writing" from how it was spelled.
 */
export interface ProtectionChange {
  /** The setting, in the words GitHub's own page uses where it has them. */
  readonly setting: string;
  readonly current: string;
  readonly wanted: string;
  /** `POL-040a.1` … `POL-040a.4` — so a plan line is traceable to the clause that asked for it. */
  readonly pol: string;
  /** Does applying change anything? False for every row is the "already correct" case. */
  readonly changes: boolean;
}

/**
 * The PURE assessment of what a hard posture still needs on this branch — every requirement, in policy order.
 *
 * EVERY row, not only the failing ones, because `plan` prints the current value beside the wanted one and a
 * table that silently omits what is already right cannot be read as "this is the whole of POL-040a §3.3". The
 * caller filters when it wants a count.
 *
 * TAKES `ProtectionFacts`, NEVER `null`. Unknowable is not a plan — it is a refusal, and it belongs to the
 * caller that made the failed read (see `isPlanLimited`). A `null` folded in here would produce a plan to
 * change four settings gov never actually looked at.
 */
export function protectionChanges(facts: ProtectionFacts, approverCheck: string = APPROVER_CHECK): readonly ProtectionChange[] {
  const hasCheck = facts.requiredStatusChecks.includes(approverCheck);
  return [
    {
      setting: "pull request required",
      current: facts.pullRequestRequired ? "yes" : "no",
      wanted: "yes",
      pol: "POL-040a.1",
      changes: !facts.pullRequestRequired,
    },
    {
      setting: "approving reviews",
      current: String(facts.approvingReviews),
      wanted: `${WANTED_APPROVING_REVIEWS} or more`,
      pol: "POL-040a.2",
      changes: facts.approvingReviews < WANTED_APPROVING_REVIEWS,
    },
    {
      setting: "bypass (administrators included)",
      current: facts.enforceAdmins ? "not allowed" : "allowed",
      wanted: "not allowed",
      pol: "POL-040a.3",
      changes: !facts.enforceAdmins,
    },
    {
      setting: `required check \`${approverCheck}\``,
      // WHAT ELSE THE BRANCH REQUIRES, always. A PUT to the protection endpoint REPLACES the check list, so a
      // reader has to be able to see that gov is about to keep the checks that are already there.
      current: hasCheck
        ? "required"
        : facts.requiredStatusChecks.length
        ? `absent (it requires ${facts.requiredStatusChecks.join(", ")})`
        : "absent (it requires no checks)",
      wanted: facts.requiredStatusChecks.length && !hasCheck
        ? `required, alongside ${facts.requiredStatusChecks.join(", ")}`
        : "required",
      pol: "POL-040a.4",
      changes: !hasCheck,
    },
  ];
}

/**
 * IS THIS THE PLAN REFUSING, rather than a permission or a network? Pure, over whatever gh said.
 *
 * `whyUnreadable` already recognises this message and puts it in a person's words. This answers the machine's
 * question instead — "may gov go on?" — because the two callers need opposite things from the same string:
 * `gov doctor` prints an explanation and carries on, `gov repo protect apply` must STOP and exit non-zero. A
 * substring test at each call site is how one of them would come to disagree with the other.
 */
export function isPlanLimited(message: string): boolean {
  return /upgrade to github pro|make this repository public/i.test(message);
}

/**
 * The three ways out §3.4/POL-040d already states, named for THIS repository.
 *
 * Verbatim from the policy and in its order, because the value of this list is that an organization can point
 * at the clause afterwards and show which of the three it took. A fourth suggestion invented here would be a
 * fourth thing nobody ratified.
 */
export function planWaysOut(repo: string): readonly string[] {
  return [
    `1. make ${repo} public`,
    "2. move this organization to a plan that provides branch protection (Pro, Team or Enterprise)",
    "3. approve an exception that NAMES the gap — `framework/templates/exceptions/policy/TEMPLATE.md`",
  ];
}
