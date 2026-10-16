// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE `gh-action/*` ACTIONS — checks that must ask GitHub (W2-Q3; W6 slice 2).
 *
 *   landed-by-pr   GOV-FRM-040: every commit pushed to the default branch belongs to a pull request MERGED INTO
 *                  that branch. A raw `git push origin main` in soft posture is the residual risk this detects.
 *
 *                  ON THE SAME BINDING, under soft posture: {@link redMerges} — a PR that merged while one of gov's own
 *                  checks on it was red (Policy Owner, 2026-10-07). GOV-FRM-040 passes there (the PR did merge), so the
 *                  push is where the merge is caught; check-verb.ts opens the record (violation.ts).
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
  /** The PR's head commit — where its checks ran. Absent when GitHub did not say. */
  readonly headSha?: string;
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
    return doc.map((p: { number?: unknown; merged_at?: unknown; base?: { ref?: unknown }; head?: { sha?: unknown } }) => ({
      number: Number(p.number),
      mergedAt: typeof p.merged_at === "string" ? p.merged_at : null,
      base: typeof p.base?.ref === "string" ? p.base.ref : "",
      ...(typeof p.head?.sha === "string" ? { headSha: p.head.sha } : {}),
    }));
  };
}

// ── SOFT MERGE WITH RED CHECKS (Policy Owner, 2026-10-07) ────────────────────────────────────────────────────

/** One check run on a commit. `summary` is the run's output title, or "" when it gave none. */
export interface CheckRunRef {
  readonly name: string;
  /** `success`, `failure`, … — null while the run has not concluded. */
  readonly conclusion: string | null;
  readonly summary: string;
}

export interface RedMergePorts {
  pullsForCommit(sha: string): readonly PullRef[] | null;
  /** The check runs on a commit, or null when GitHub could not be asked. */
  checkRunsForCommit(sha: string): readonly CheckRunRef[] | null;
}

export interface FailedGovCheck { readonly rule: string; readonly event: string; readonly summary: string }
/** A pull request merged into the pushed branch while gov's checks on its head had failed. */
export interface RedMerge { readonly pr: number; readonly headSha: string; readonly failed: readonly FailedGovCheck[] }

/**
 * A check run gov rendered: `<GOV-ID> · <event>` — render-github.ts's checkRunName, read back. Anything else (a
 * build, a linter) is not gov's to record.
 */
export function govCheckRunOf(name: string): { readonly rule: string; readonly event: string } | null {
  const m = /^(GOV-[A-Z0-9]+-\d+[a-z]*) · (\S+)$/.exec(name);
  return m ? { rule: m[1]!, event: m[2]! } : null;
}

/**
 * The PRs among the pushed commits that merged into the branch with a gov check FAILED on their head. Pure over
 * `ports`. In scope exactly as landed-by-pr is (its `branches`, default the default branch). What GitHub would not
 * answer is a note — never read as "no red checks".
 */
export function redMerges(input: GhActionInput, ports: RedMergePorts): { merges: RedMerge[]; notes: string[] } {
  const tag = `${input.ruleId} [soft merge with red checks]`;
  const branch = payloadString(input.ctx, "branch");
  const patterns = asList(input.params.branches);
  const inScope = branch === undefined ? null : branchInScope(branch, patterns.length ? patterns : ["$default"], payloadString(input.ctx, "defaultBranch"));
  if (!inScope) return { merges: [], notes: [] };
  const commits = payloadStrings(input.ctx, "commits") ?? [];
  const prs = new Map<number, PullRef>();
  const notes: string[] = [];
  for (const sha of commits) {
    const pulls = ports.pullsForCommit(sha);
    if (pulls === null) { notes.push(`${tag}: GitHub did not answer for commit ${sha.slice(0, 7)}, so its pull request's checks were not read.`); continue; }
    for (const p of pulls) if (p.mergedAt !== null && p.base === branch && !prs.has(p.number)) prs.set(p.number, p);
  }
  const merges: RedMerge[] = [];
  for (const p of [...prs.values()].sort((a, b) => a.number - b.number)) {
    if (!p.headSha) { notes.push(`${tag}: GitHub did not give PR #${p.number}'s head commit, so its check runs were not read.`); continue; }
    const runs = ports.checkRunsForCommit(p.headSha);
    if (runs === null) { notes.push(`${tag}: GitHub did not give PR #${p.number}'s check runs, so whether it merged with a gov check red is unknown.`); continue; }
    const failed: FailedGovCheck[] = [];
    for (const r of runs) {
      const id = govCheckRunOf(r.name);
      if (id && r.conclusion === "failure" && !failed.some((f) => f.rule === id.rule && f.event === id.event)) failed.push({ ...id, summary: r.summary });
    }
    if (failed.length) merges.push({ pr: p.number, headSha: p.headSha, failed });
  }
  return { merges, notes };
}

/** The production port: `gh api repos/<repo>/commits/<sha>/check-runs`. Null on failure or an unexpected shape. */
export function githubCheckRunsForCommit(gh: (args: readonly string[]) => string | null, repo: string): (sha: string) => readonly CheckRunRef[] | null {
  return (sha) => {
    const out = gh(["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`]);
    if (out === null) return null;
    let doc: unknown;
    try { doc = JSON.parse(out); } catch { return null; /* not the answer asked for: the caller reports it */ }
    const runs = (doc as { check_runs?: unknown })?.check_runs;
    if (!Array.isArray(runs)) return null;
    return runs.map((r: { name?: unknown; conclusion?: unknown; output?: { title?: unknown } }) => ({
      name: typeof r.name === "string" ? r.name : "",
      conclusion: typeof r.conclusion === "string" ? r.conclusion : null,
      summary: typeof r.output?.title === "string" ? r.output.title : "",
    }));
  };
}
