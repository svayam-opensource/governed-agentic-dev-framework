// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE `gh-action/*` ACTIONS — checks that must ask GitHub (W2-Q3; W6 slice 2).
 *
 *   landed-by-pr   GOV-FRM-040: every commit pushed to the default branch belongs to a pull request MERGED INTO
 *                  that branch. A raw `git push origin main` in soft posture is the residual risk this detects.
 *
 * The logic is pure over an injected {@link GithubPorts}; {@link githubPullsForCommit} is the production port,
 * calling GitHub's "list pull requests associated with a commit" (`GET /repos/{repo}/commits/{sha}/pulls`) through
 * an injected `gh` runner. A GitHub that does not answer is `cannot-tell`, never a pass.
 */
import type { EventContext } from "../model/contracts.js";
import { asList, branchInScope, payloadString, payloadStrings } from "./payload.js";

/** One pull request a commit belongs to. `mergedAt` null = not merged. `base` = the branch it targets. */
export interface PullRef {
  readonly number: number;
  readonly mergedAt: string | null;
  readonly base: string;
}

export interface GithubPorts {
  /** The pull requests associated with a commit, or null when GitHub could not be asked. */
  pullsForCommit(sha: string): readonly PullRef[] | null;
}

export interface GhActionInput {
  readonly ruleId: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly ctx: EventContext;
}

export interface GhActionOutcome {
  readonly verdict: "pass" | "miss" | "cannot-tell";
  readonly findings: readonly string[];
}

const ACTION = "gh-action/landed-by-pr";

export function landedByPr(input: GhActionInput, ports: GithubPorts): GhActionOutcome {
  const tag = `${input.ruleId} [${ACTION}]`;
  const cannot = (m: string): GhActionOutcome => ({ verdict: "cannot-tell", findings: [`${tag}: ${m}, so nothing was checked.`] });
  const branch = payloadString(input.ctx, "branch");
  if (branch === undefined) return cannot("the pushed branch is not known");
  const patterns = asList(input.params.branches);
  const inScope = branchInScope(branch, patterns.length ? patterns : ["$default"], payloadString(input.ctx, "defaultBranch"));
  if (inScope === null) return cannot("the default branch is not known");
  if (!inScope) return { verdict: "pass", findings: [] };
  const commits = payloadStrings(input.ctx, "commits");
  if (commits === undefined) return cannot("the push did not list its commits");

  const misses: string[] = [];
  const notes: string[] = [];
  for (const sha of commits) {
    const pulls = ports.pullsForCommit(sha);
    if (pulls === null) { notes.push(`${tag}: GitHub did not answer for commit ${sha.slice(0, 7)}, so it was not checked.`); continue; }
    if (!pulls.some((p) => p.mergedAt !== null && p.base === branch)) {
      misses.push(`${tag}: commit ${sha.slice(0, 7)} was pushed to \`${branch}\` without a merged pull request. Every change lands by pull request — open one for this work; the record goes to the Policy Owner.`);
    }
  }
  if (misses.length) return { verdict: "miss", findings: [...misses, ...notes] };
  if (notes.length) return { verdict: "cannot-tell", findings: notes };
  return { verdict: "pass", findings: [] };
}

/**
 * The production port: `gh api repos/<repo>/commits/<sha>/pulls`. `gh` returns stdout, or null on failure; an
 * answer that is not the expected JSON list is null too — gov does not guess at a shape it did not get.
 */
export function githubPullsForCommit(gh: (args: readonly string[]) => string | null, repo: string): (sha: string) => readonly PullRef[] | null {
  return (sha) => {
    const out = gh(["api", `repos/${repo}/commits/${sha}/pulls`]);
    if (out === null) return null;
    let doc: unknown;
    try {
      doc = JSON.parse(out);
    } catch {
      // Not JSON: GitHub did not give the answer asked for. null is the account — the caller reports cannot-tell.
      return null;
    }
    if (!Array.isArray(doc)) return null;
    return doc.map((p: { number?: unknown; merged_at?: unknown; base?: { ref?: unknown } }) => ({
      number: Number(p.number),
      mergedAt: typeof p.merged_at === "string" ? p.merged_at : null,
      base: typeof p.base?.ref === "string" ? p.base.ref : "",
    }));
  };
}
