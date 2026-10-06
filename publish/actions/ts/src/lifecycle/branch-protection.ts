// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `BranchProtection` port (read-only) — framework-policy §3.3, THE LAYER NOBODY WAS CHECKING (PRJ-121, 2026-09-27).
 *
 * framework-policy §3.3 requires four settings on the default branch of the governance repo and of every
 * participating code repo: a pull request before merging, at least one approving review, no bypass (admins
 * included), and a required status check that verifies the approver is on the org's authorized list. Until
 * this file, nothing in `src/` mentioned branch protection at all — the policy was taken on trust.
 *
 * WHY IT IS THE LAYER THAT MATTERS. Every other enforcement gov has runs INSIDE gov: the session gate, the
 * close gate, `gov merge`. An agent — or a person in a hurry — that never invokes gov walks past all of it.
 * Branch protection is the only rule that still holds then, which makes "we assume it is configured" the
 * weakest link in the chain and the one worth reading out loud.
 *
 * READING IT NEEDS ADMIN RIGHTS on the repository: GitHub answers a non-admin with 403, and a repo the token
 * cannot see with 404. So "gov could not read this" is the COMMON case, not an exotic one, and it must read
 * differently from "the branch is open" — a report that says `✗ unprotected` because the reader lacked a
 * permission would teach people to ignore the row.
 *
 * AND ON GITHUB FREE, FOR A PRIVATE REPO, THERE IS NOTHING TO READ. Both this endpoint and the newer
 * `…/rules/branches/…` answer 403 `Upgrade to GitHub Pro or make this repository public to enable this
 * feature.` — verified against Svayamtech/svm-prj-work, this framework's own governance repo, on 2026-09-27.
 * That is worth stating plainly because it is stronger than §3.4 assumes: required status checks are
 * THEMSELVES a branch-protection feature, so on a free private repo none of GOV-FRM-447's four settings can be
 * configured — not even the approver check that §3.3 offers as the plan-independent answer. Enforcement there
 * is gov's own gates and nothing else, until the repo is public or the plan is Pro/Team.
 *
 * WHAT THIS DOES NOT READ: rulesets. gov asks the classic protection endpoint, so a branch protected only by
 * a repository ruleset reads as unprotected. Not a guess worth making quietly — see `whyUnreadable`, and the
 * follow-up is to read `repos/<owner>/<repo>/rules/branches/<branch>` and fold both answers together.
 */
import { run as runProcess } from "../run-process.js";
// ONE spelling of "runs gh" for the whole codebase: a second `RunGh` here would be the same type under two
// names, and `lifecycle/index.ts` re-exports both files.
import type { RunGh } from "./gh-board.js";

/** What GOV-FRM-447 asks about a branch, and nothing else. */
export interface ProtectionFacts {
  /**
   * A pull request is required before merging.
   *
   * DERIVED, because GitHub's classic protection API has no such flag: it reports
   * `required_pull_request_reviews`, and requiring a review is what makes a pull request unavoidable. A
   * ruleset (the newer API) states it outright as a `pull_request` rule; gov reads the classic endpoint, so
   * this is the honest reading of what that endpoint says.
   */
  readonly pullRequestRequired: boolean;
  /** `required_pull_request_reviews.required_approving_review_count` — 0 when reviews are not required. */
  readonly approvingReviews: number;
  /** `enforce_admins.enabled` — false means administrators and the owner may bypass all of the above. */
  readonly enforceAdmins: boolean;
  /** The names of the required status checks (`required_status_checks.contexts` / `.checks[].context`). */
  readonly requiredStatusChecks: readonly string[];
}

/** Read a branch's protection. `null` when gh could not answer — never a guess. */
export interface BranchProtection {
  /** `repo` is `owner/name`. Returns null when the answer is unknowable (see {@link readProtection}). */
  fetch(repo: string, branch: string): ProtectionFacts | null;
}

/**
 * What one read produced: the facts, or `null` with the REASON gh could not answer.
 *
 * The port's `fetch` returns `ProtectionFacts | null` and drops the reason, which is right for callers that
 * only act on the facts. `gov doctor` PRINTS the reason, because "you are not an admin of this repo" and
 * "GitHub is down" are different things to do next.
 */
export interface ProtectionRead {
  readonly facts: ProtectionFacts | null;
  /** Why there are no facts, in a person's words. Absent when there are facts. */
  readonly why?: string;
}

/** An UNPROTECTED branch, stated as facts. Every requirement fails, which is the truth about it. */
export const UNPROTECTED: ProtectionFacts = {
  pullRequestRequired: false,
  approvingReviews: 0,
  enforceAdmins: false,
  requiredStatusChecks: [],
};

interface ProtectionPayload {
  required_pull_request_reviews?: { required_approving_review_count?: number } | null;
  enforce_admins?: { enabled?: boolean } | null;
  required_status_checks?: {
    contexts?: string[] | null;
    checks?: { context?: string }[] | null;
  } | null;
}

/**
 * Parse the `branches/<branch>/protection` payload. Pure. `null` when the text is not a protection object at
 * all — a non-JSON body, or an error body gh printed to stdout — because reporting `0 approving reviews`
 * about something gov failed to parse is the false alarm this whole file exists to avoid.
 */
export function parseProtection(stdout: string): ProtectionFacts | null {
  let root: unknown;
  try {
    root = JSON.parse(stdout);
  } catch {
    return null;                       // not JSON: gh printed a message, not a payload
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) return null;
  const p = root as ProtectionPayload & { message?: string; url?: string };
  // An error body ("Branch not protected", "Not Found") carries `message` and none of the protection keys.
  const hasAny =
    "required_pull_request_reviews" in p || "enforce_admins" in p || "required_status_checks" in p || "url" in p;
  if (!hasAny) return null;
  const reviews = p.required_pull_request_reviews ?? null;
  const checks = p.required_status_checks ?? null;
  const names = [
    ...(checks?.contexts ?? []),
    ...(checks?.checks ?? []).map((c) => c?.context ?? "").filter(Boolean),
  ];
  return {
    pullRequestRequired: reviews !== null,
    approvingReviews: reviews?.required_approving_review_count ?? 0,
    enforceAdmins: p.enforce_admins?.enabled === true,
    requiredStatusChecks: [...new Set(names)],
  };
}

/**
 * Why a failed read failed, in a person's words — pure, over whatever gh said.
 *
 * `null` for the one message that is not a failure: GitHub answers an unprotected branch with 404 and the
 * body `Branch not protected`. That is an ANSWER, and the caller turns it into {@link UNPROTECTED}. Folding
 * it into "could not read" would hide the worst case — a default branch with no rule at all — behind a
 * warning about permissions.
 */
export function whyUnreadable(message: string): string | null {
  if (/branch not protected/i.test(message)) return null;
  // THE PLAN, NOT THE PERSON. On GitHub Free a private repo has no branch protection and no rulesets to read
  // — and none to set either, which makes GOV-FRM-447 unconfigurable rather than unconfigured. Saying "you are
  // not an admin" here would send someone hunting a permission that does not exist.
  if (/upgrade to github pro|make this repository public/i.test(message)) {
    return "GitHub Free offers no branch protection (or rulesets) on a PRIVATE repo, so GOV-FRM-447 cannot be satisfied here at all — required status checks are part of the same paid feature. Make the repo public, or move to Pro/Team; until then gov's own gates are the only enforcement";
  }
  if (/must have admin rights|admin rights to repository/i.test(message)) return "gh is signed in but not an admin of this repo, and GitHub shows branch protection to admins only";
  if (/bad credentials|not logged|gh auth login|401/i.test(message)) return "gh is not signed in (`gh auth login`)";
  if (/\bnot found\b|\b404\b/i.test(message)) return "GitHub says not found — the repo or the branch does not exist, or this token cannot see it";
  if (/\b403\b|forbidden|resource not accessible/i.test(message)) return "GitHub refused the read (403) — the token lacks the permission, or SSO is not authorised for this org";
  if (/\bEOF\b|timed? ?out|timeout|ECONNRESET|connection reset|\b50[234]\b/i.test(message)) return "the call to GitHub failed in transit — try again";
  const first = message.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return first ? `gh failed: ${first.trim().slice(0, 160)}` : "gh failed with no message";
}

const defaultRunGh: RunGh = (args) => runProcess("gh", args, { pgm: "gov-work:lifecycle:branch-protection", fn: "gh" });

/**
 * Read one branch's protection through `gh`, keeping the reason when there is none.
 *
 * Everything goes through `run-process.ts` (GOV-FRM-423), so the call, its duration and its exit code are in the
 * run log — which is how the next "why did doctor warn" gets answered from a file rather than a screenshot.
 */
export function readProtection(repo: string, branch: string, runGh: RunGh = defaultRunGh): ProtectionRead {
  let stdout: string;
  try {
    stdout = runGh(["api", `repos/${repo}/branches/${branch}/protection`]);
  } catch (e) {
    const err = e as { message?: string; stdout?: string | Buffer; stderr?: string | Buffer };
    const said = `${err?.stderr?.toString() ?? ""}\n${err?.stdout?.toString() ?? ""}\n${err?.message ?? ""}`;
    const why = whyUnreadable(said);
    // `null` from whyUnreadable means GitHub ANSWERED: the branch has no protection rule.
    return why === null ? { facts: UNPROTECTED } : { facts: null, why };
  }
  const facts = parseProtection(stdout);
  if (facts !== null) return { facts };
  // gh exited 0 with something that is not a protection payload. `--json`-less `gh api` prints GitHub's body
  // verbatim, so "Branch not protected" can arrive this way too.
  const why = whyUnreadable(stdout);
  return why === null ? { facts: UNPROTECTED } : { facts: null, why };
}

/** A {@link BranchProtection} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhBranchProtection(runGh: RunGh = defaultRunGh): BranchProtection {
  return {
    fetch: (repo, branch) => readProtection(repo, branch, runGh).facts,
  };
}
