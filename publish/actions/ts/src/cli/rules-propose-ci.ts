// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov-builtin/rules-propose` — THE PULL REQUEST TRIGGER (rule-model-design.md Q16–Q18, P1 "Propose trigger";
 * framework specification §9.3; P3 wave 2).
 *
 * Bound to `vcs.gov-repo · pull_request(base=default)`. The same engine `gov rules propose` runs, with the
 * questions put as review comments on the pull request instead of at a terminal:
 *
 *   policies/ untouched ............................... pass
 *   rows stale (the W5 gate's sha findings)
 *     the org has not allowed a model in CI ........... miss: the gate's message — run gov rules propose locally
 *     a fork, which gov cannot push to ................ miss: the same
 *     already run at these shas, no new answer ......... miss: waiting for answers (no second model run — Q16)
 *     run → questions open ............................. miss: the PR stays blocked until each is answered
 *     run → did not settle ............................. miss: run gov rules propose locally
 *     run → settled .................................... committed to the PR branch as the gov bot → pass
 *   rows fresh, but version/snapshot/stamps/changelog missing
 *                                                      the deterministic writers, committed → pass (no model)
 *
 * The model is the organization's, read from the DEFAULT branch's `policies/governance.yaml`, and is used only when
 * `models.ci_allowed` is true there. A commit by the bot is NEVER an approval: approvals are pull request reviews
 * by people (event-payload.ts ignores bots), and this code never submits one.
 */
import { createHash } from "node:crypto";
import { log } from "../log.js";
import type { GitRead } from "./policy-gate-io.js";
import type { Gh } from "../rules/checks/github-adapters.js";
import type { BuiltinOutcome } from "../rules/checks/builtin.js";
import { judgePolicyPr } from "../rules/policy-pr/gate.js";
import type { TreeWriter } from "../rules/policy-pr/tree.js";
import type { ModelSettings } from "../rules/propose/model-settings.js";
import type { ModelChoice } from "../rules/propose/providers/index.js";
import { prCommentChannel } from "../rules/propose/interview.js";
import { ghPrComments, runRecords, ForgeUnreadable } from "../rules/propose/pr-comments-gh.js";
import { applyPropose, openLines } from "../rules/propose/apply.js";
import { finishPolicyChange } from "../rules/propose/write-result.js";
import { policyPrFromEvent } from "./check-verb.js";

const PGM = "gov-work:cli:rules-propose-ci";

/** A writable checkout of the pull request's head, and the one way to land what was written on its branch. */
export interface PrBranch {
  readonly tree: TreeWriter;
  /** Commit policies/ as the gov bot and push it to the PR branch: the new sha, nothing to commit, or why not. */
  commit(message: string): { readonly sha: string } | { readonly nothing: true } | { readonly error: string };
  close(): void;
}

export interface ProposeCiDeps {
  readonly git: GitRead;
  readonly gh: Gh;
  /** The governance repository's checkout. */
  readonly repoDir: string;
  /** `owner/name`, from GITHUB_REPOSITORY. */
  readonly repository: string;
  /** From the DEFAULT branch's policies/governance.yaml. */
  readonly settings: ModelSettings;
  /** The model for these settings, in CI. */
  readonly model: (s: ModelSettings) => ModelChoice;
  readonly openBranch: (headSha: string, headRef: string) => PrBranch | { readonly error: string };
  /** gov's own login on GitHub — the author of its questions and of its commits. */
  readonly self: string;
  /** YYYY-MM-DD of the commit the bot would make. */
  readonly today: string;
}

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const cannot = (f: string[]): BuiltinOutcome => ({ verdict: "cannot-tell", findings: f });
const miss = (f: string[]): BuiltinOutcome => ({ verdict: "miss", findings: f });

export const LOCAL_FIX = "run gov rules propose locally, answer its questions, and push the result";

export function commitMessage(pr: number, what: string): string {
  return [
    `gov rules propose: ${what} for #${pr}`,
    "",
    "Written by gov on the policy pull request (framework specification §9.3).",
    "A commit by gov is not an approval: every changed section's owner still approves this pull request.",
  ].join("\n");
}

export async function proposeOnPullRequest(tag: string, eventName: string, event: unknown, deps: ProposeCiDeps): Promise<BuiltinOutcome> {
  const input = policyPrFromEvent(deps.git, deps.repoDir, eventName, event);
  if (!input) return cannot([`${tag}: this is not a pull request gov can read (its base and head could not be established), so nothing was checked.`]);
  const judged = judgePolicyPr(input);
  if (judged.verdict === "cannot-tell") return cannot(judged.findings.map((f) => `${tag}: ${f.message}`));
  if (!judged.touched) return { verdict: "pass", findings: [] };

  const pr = o(o(event).pull_request);
  const head = o(pr.head);
  const headSha = String(head.sha ?? ""), headRef = String(head.ref ?? "");
  const headRepo = String(o(head.repo).full_name ?? "");
  const author = String(o(pr.user).login ?? "");
  const fork = !headRef || (headRepo !== "" && headRepo !== deps.repository);
  const ref = { repo: deps.repository, pr: input.pr, headSha, self: deps.self };
  const stale = judged.findings.filter((f) => f.check === "sha").map((f) => `${tag}: ${f.message}`);

  if (!stale.length) return finishOnly(tag, input, judged.findings.map((f) => f.check), { fork, author, headSha, headRef }, deps);

  if (!deps.settings.ciAllowed) {
    return miss([...stale, `${tag}: this organization has not allowed a model in CI (models.ci_allowed in policies/governance.yaml) — ${LOCAL_FIX}.`]);
  }
  if (fork) return miss([...stale, `${tag}: this pull request comes from a fork gov cannot push to — ${LOCAL_FIX}.`]);
  const choice = deps.model(deps.settings);
  if (!choice.ok) return miss([...stale, ...choice.lines.map((l) => `${tag}: ${l.trim()}`)]);

  // ONE RUN PER SECTION SHA (Q16): keyed by what is stale and every answer given so far. Same key → the model has
  // already read exactly this, and nothing new has been said; asking it again would only cost.
  const port = ghPrComments(deps.gh, ref);
  const records = runRecords(deps.gh, ref);
  let replies: string[];
  try {
    replies = (await port.list()).filter((c) => c.inReplyTo && c.author !== deps.self).map((c) => c.id).sort();
  } catch (e) {
    return cannot([`${tag}: ${(e as Error).message}, so nothing was proposed.`]);
  }
  const key = createHash("sha256").update(JSON.stringify({ stale: [...stale].sort(), replies })).digest("hex").slice(0, 16);
  const done = records.keys();
  if (done === null) return cannot([`${tag}: the pull request's comments could not be read, so nothing was proposed.`]);
  if (done.includes(key)) {
    return miss([...stale, `${tag}: gov already read these sections at these shas and is waiting for answers to its questions on this pull request. Reply in each question's thread; the pull request stays blocked until every one is answered.`]);
  }

  const branch = deps.openBranch(headSha, headRef);
  if ("error" in branch) return cannot([`${tag}: could not check out the pull request's head (${branch.error}), so nothing was proposed.`]);
  try {
    let r;
    try {
      r = await applyPropose({ base: input.base, head: branch.tree, model: choice.model, channel: prCommentChannel(port), today: deps.today, pr: input.pr, author });
    } catch (e) {
      if (e instanceof ForgeUnreadable) return cannot([`${tag}: ${e.message}, so nothing was proposed.`]);
      throw e;
    }
    log("info", "propose ran on a policy pull request", PGM, "proposeOnPullRequest", { pr: input.pr, status: r.status, key });
    if (r.status === "blocked") {
      records.post(key, ["**gov rules propose** read the changed sections with the organization's model and has questions.",
        "Reply in each question's thread (on the policy file); the pull request stays blocked until every one is answered.", "",
        ...openLines(r.open).map((l) => l.replace(/^ {4}\? /, "- ").replace(/^ {2}/, "")), ""].join("\n"));
      return miss([...stale, `${tag}: ${r.open.reduce((n, s) => n + s.questions.length, 0)} question(s) are open on this pull request. It stays blocked until each is answered in its thread.`]);
    }
    if (r.status === "failed") {
      records.post(key, ["**gov rules propose** could not settle the changed sections:", "", ...r.lines.map((l) => `- ${l.trim()}`), "",
        `It will not try again at these shas. ${LOCAL_FIX[0]!.toUpperCase()}${LOCAL_FIX.slice(1)}.`].join("\n"));
      return miss([...stale, ...r.lines.map((l) => `${tag}: ${l.trim()}`), `${tag}: ${LOCAL_FIX}.`]);
    }
    const c = r.counts;
    const done2 = branch.commit(commitMessage(input.pr, `rules (added ${c.added}, revised ${c.revised}, retired ${c.retired}), version ${r.bump}`));
    if ("error" in done2) return cannot([`${tag}: the proposal was made but could not be pushed (${done2.error}). ${LOCAL_FIX}.`]);
    if ("nothing" in done2) return { verdict: "pass", findings: [] };
    return { verdict: "pass", findings: [`${tag}: proposed and committed ${done2.sha.slice(0, 7)} to ${headRef} as ${deps.self} — added ${c.added}, revised ${c.revised}, retired ${c.retired}, kept ${c.kept}; version ${r.bump}. The checks run again on that commit, and the section owners still approve it.`] };
  } finally {
    branch.close();
  }
}

/** Rows fresh: only the deterministic writers (no model, so `ci_allowed` does not apply). */
function finishOnly(
  tag: string, input: NonNullable<ReturnType<typeof policyPrFromEvent>>, checks: readonly string[],
  h: { readonly fork: boolean; readonly author: string; readonly headSha: string; readonly headRef: string }, deps: ProposeCiDeps,
): BuiltinOutcome {
  const fixable = new Set(["version", "changelog", "snapshot", "stamp"]);
  if (!checks.some((c) => fixable.has(c)) || h.fork) return { verdict: "pass", findings: [] };
  const branch = deps.openBranch(h.headSha, h.headRef);
  // The policy PR gate still fails the pull request and names each missing piece; this was only the shortcut.
  if ("error" in branch) return { verdict: "pass", findings: [`${tag}: could not check out the pull request's head (${branch.error}) to write the version, snapshot, stamps and changelog — ${LOCAL_FIX}.`] };
  try {
    const fin = finishPolicyChange({ base: input.base, head: branch.tree, pr: input.pr, today: deps.today, author: h.author });
    if (!fin.ok || !fin.wrote.length) return { verdict: "pass", findings: [] };
    const done = branch.commit(commitMessage(input.pr, "version, snapshot, stamps and changelog"));
    if ("sha" in done) return { verdict: "pass", findings: [`${tag}: wrote ${fin.wrote.join(", ")} and committed ${done.sha.slice(0, 7)} to ${h.headRef} as ${deps.self}.`] };
    if ("error" in done) return { verdict: "pass", findings: [`${tag}: could not push the version, snapshot, stamps and changelog (${done.error}) — ${LOCAL_FIX}.`] };
    return { verdict: "pass", findings: [] };
  } finally {
    branch.close();
  }
}
