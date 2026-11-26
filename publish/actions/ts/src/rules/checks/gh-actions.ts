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
 *                  push is where the merge is caught; check-verb.ts opens the record (violation.ts). A red check
 *                  that was solo mode (Q45 C) is told apart by its annotations, and recorded as a self-merge instead.
 *
 * The logic is pure over an injected {@link GithubPorts}; {@link githubPullsForCommit} is the production port,
 * calling GitHub's "list pull requests associated with a commit" (`GET /repos/{repo}/commits/{sha}/pulls`) through
 * an injected `gh` runner. A GitHub that does not answer is `cannot-tell`, never a pass.
 */
import type { EventContext } from "../model/contracts.js";
import { asList, branchInScope, payloadString, payloadStrings } from "./payload.js";
import { SELF_MERGED_SOLO } from "./policy-actions.js";

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
  /**
   * Is this the commit `gov setup` made on a new governance repository (F136 G2, Q42 C)? Absent: no commit is
   * exempt. null: GitHub could not say — the commit is then judged like any other.
   */
  isSetupCommit?(sha: string): boolean | null;
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
      // THE SETUP COMMIT (Q42 C): the one commit setup pushes on a new governance repository, before anyone works —
      // it carries the checks themselves, so no pull request could have carried it. Exempt exactly that one.
      if (ports.isSetupCommit?.(sha) === true) continue;
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
  /** GitHub's id for the run — what its annotations are read by. Absent when GitHub did not say. */
  readonly id?: number;
  readonly name: string;
  /** `success`, `failure`, … — null while the run has not concluded. */
  readonly conclusion: string | null;
  readonly summary: string;
}

export interface RedMergePorts {
  pullsForCommit(sha: string): readonly PullRef[] | null;
  /** The check runs on a commit, or null when GitHub could not be asked. */
  checkRunsForCommit(sha: string): readonly CheckRunRef[] | null;
  /**
   * The failure-level annotation messages of one check run (Q45 C: how a solo-mode miss is told from any other), or
   * null when GitHub could not be asked. Absent → no failure is read as solo mode.
   */
  failureAnnotations?(checkRunId: number): readonly string[] | null;
}

/**
 * One gov check that was red on a merged PR's head. `solo`: every failure it reported was solo mode (Q45 C) —
 * {@link SELF_MERGED_SOLO}, nobody but the author to approve — so the merge is a self-merge, recorded as evidence.
 */
export interface FailedGovCheck { readonly rule: string; readonly event: string; readonly summary: string; readonly solo?: true }
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
      if (id && r.conclusion === "failure" && !failed.some((f) => f.rule === id.rule && f.event === id.event)) {
        failed.push({ ...id, summary: r.summary, ...(soloRun(r, ports) ? { solo: true as const } : {}) });
      }
    }
    if (failed.length) merges.push({ pr: p.number, headSha: p.headSha, failed });
  }
  return { merges, notes };
}

/**
 * WAS THIS RED RUN SOLO MODE? (Q45 C) — its failure annotations, every one of them, carry {@link SELF_MERGED_SOLO}.
 * A run whose annotations cannot be read, or that failed for anything else as well, is not: when gov cannot tell, the
 * merge is recorded as a violation, the record that asks a person to look.
 */
function soloRun(r: CheckRunRef, ports: RedMergePorts): boolean {
  if (r.id === undefined || !ports.failureAnnotations) return false;
  const messages = ports.failureAnnotations(r.id);
  return !!messages && messages.length > 0 && messages.every((m) => m.includes(SELF_MERGED_SOLO));
}

/**
 * The production port for {@link RedMergePorts.failureAnnotations}: `gh api repos/<repo>/check-runs/<id>/annotations`,
 * the failure-level messages. Null on failure or an unexpected shape.
 */
export function githubFailureAnnotations(gh: (args: readonly string[]) => string | null, repo: string): (checkRunId: number) => readonly string[] | null {
  return (id) => {
    const out = gh(["api", `repos/${repo}/check-runs/${id}/annotations?per_page=100`]);
    if (out === null) return null;
    let doc: unknown;
    try { doc = JSON.parse(out); } catch { return null; /* not the answer asked for: the caller reads it as not solo */ }
    if (!Array.isArray(doc)) return null;
    return doc
      .filter((a: { annotation_level?: unknown }) => a?.annotation_level === "failure")
      .map((a: { message?: unknown }) => (typeof a.message === "string" ? a.message : ""));
  };
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
    return runs.map((r: { id?: unknown; name?: unknown; conclusion?: unknown; output?: { title?: unknown } }) => ({
      ...(typeof r.id === "number" ? { id: r.id } : {}),
      name: typeof r.name === "string" ? r.name : "",
      conclusion: typeof r.conclusion === "string" ? r.conclusion : null,
      summary: typeof r.output?.title === "string" ? r.output.title : "",
    }));
  };
}

/** The subject of the one commit setup makes on a new governance repository. Written by setup, read by landed-by-pr. */
export const SETUP_COMMIT_SUBJECT = "configure the framework for this org";

/** What the GitHub commits API says about one commit — as much as {@link isSetupCommit} needs. */
export interface CommitFacts {
  readonly message: string;
  readonly parents: readonly string[];
}

/**
 * IS THIS THE SETUP COMMIT? — the one commit GOV-FRM-040's landed-by-pr exempts (Q42 C). Narrowly: its subject is
 * {@link SETUP_COMMIT_SUBJECT}, it has exactly one parent, and that parent is the repository's ROOT (the copy GitHub
 * made from the template). So it can only ever be the second commit of a repository — the one setup pushed before
 * anyone worked. `null` when GitHub could not say, which the check reports as "not checked", never as exempt.
 */
export function isSetupCommit(sha: string, commit: (sha: string) => CommitFacts | null): boolean | null {
  const c = commit(sha);
  if (c === null) return null;
  if ((c.message.split("\n")[0] ?? "").trim() !== SETUP_COMMIT_SUBJECT || c.parents.length !== 1) return false;
  const parent = commit(c.parents[0]!);
  if (parent === null) return null;
  return parent.parents.length === 0;
}

/** The production reader: `gh api repos/<repo>/commits/<sha>`. null on any failure or an answer of the wrong shape. */
export function githubCommitFacts(gh: (args: readonly string[]) => string | null, repo: string): (sha: string) => CommitFacts | null {
  return (sha) => {
    const out = gh(["api", `repos/${repo}/commits/${sha}`]);
    if (out === null) return null;
    let doc: unknown;
    try { doc = JSON.parse(out); } catch { return null; /* not JSON: GitHub did not answer the question — null is the account */ }
    const d = doc as { commit?: { message?: unknown }; parents?: { sha?: unknown }[] } | null;
    if (!d || typeof d.commit?.message !== "string" || !Array.isArray(d.parents)) return null;
    return { message: d.commit.message, parents: d.parents.map((p) => (typeof p?.sha === "string" ? p.sha : "")).filter(Boolean) };
  };
}
