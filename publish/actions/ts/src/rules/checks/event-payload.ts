// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * FROM A GITHUB EVENT TO AN `EventPayload` (rule-model-design.md Q14; W6 slice 3).
 *
 * `gov check run` runs inside a GitHub Actions job. GitHub hands it the event as JSON (`GITHUB_EVENT_PATH`) and its
 * kind (`GITHUB_EVENT_NAME`); the repository is checked out with full history. This module turns those into the
 * payload the actions read — pure over the event JSON and two injected readers:
 *
 *   git(args)   `git -C <the checked-out repo> <args>` → stdout, or null
 *   gh(args)    `gh <args>` → stdout, or null
 *
 * A field gov could not establish is LEFT OUT, never guessed: an action that needed it reports `cannot-tell`.
 *
 *   pull_request   changed files + added lines (merge-base…head), head text, baseTexts (at the merge-base),
 *                  branch, author, approvals (the latest review per reviewer, APPROVED, on the head commit),
 *                  defaultBranch
 *   push           commits (before..after, else the event's list), forced, branch, defaultBranch, changed files
 *   issues         the event name is the action (`opened`, `closed`, `edited`)
 */
import { changedFiles } from "../../cli/diff-check-io.js";
import type { ChangedFile } from "../diff-check.js";
import type { EventPayload } from "../model/contracts.js";

export interface PayloadReaders {
  readonly git: (args: readonly string[]) => string | null;
  readonly gh: (args: readonly string[]) => string | null;
}

export interface BuiltPayload {
  /** The gov event name this GitHub event is (`pull_request`, `push`, `closed`, …), or null when gov has none. */
  readonly event: string | null;
  readonly payload: EventPayload;
  /** Facts the adapters need that are not payload: the PR or issue number. */
  readonly pullNumber?: number;
  readonly issueNumber?: number;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const ZERO = /^0+$/;

/** The changed files between two commits, or undefined when git could not list them. */
function changes(r: PayloadReaders, base: string, head: string): ChangedFile[] | undefined {
  if (r.git(["diff", "--name-status", base, head]) === null) return undefined;
  return changedFiles((_repo, args) => r.git(args), { repo: "", ref: "", base, head });
}

/**
 * The handles whose LATEST review is APPROVED and was given on `headSha`. A COMMENTED review does not change a
 * reviewer's standing (GitHub's own rule); an approval of an older commit is stale and does not count.
 */
export function approvalsFrom(reviewsJson: string, headSha: string): string[] | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(reviewsJson);
  } catch {
    // Not the JSON list GitHub sends: the approvals are unknown, which the caller reports as cannot-tell.
    return undefined;
  }
  if (!Array.isArray(doc)) return undefined;
  // `gh api --paginate` concatenates pages into one array for JSON lists; nested arrays are flattened defensively.
  const reviews = (doc.flat() as Json[]).map(obj);
  const latest = new Map<string, Json>();
  for (const rv of reviews) {
    const who = str(obj(rv.user).login);
    const state = str(rv.state);
    if (!who || !state || state === "COMMENTED" || state === "PENDING") continue;
    latest.set(who, rv); // GitHub lists reviews oldest first
  }
  return [...latest.entries()]
    .filter(([, rv]) => rv.state === "APPROVED" && rv.commit_id === headSha)
    .map(([who]) => who)
    .sort();
}

export function buildPayload(eventName: string, event: unknown, repository: string, r: PayloadReaders): BuiltPayload {
  const e = obj(event);
  const defaultBranch = str(obj(e.repository).default_branch);
  const common = defaultBranch ? { defaultBranch } : {};

  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const pr = obj(e.pull_request);
    const baseSha = str(obj(pr.base).sha), headSha = str(obj(pr.head).sha);
    const number = typeof pr.number === "number" ? pr.number : undefined;
    const payload: { -readonly [K in keyof EventPayload]: EventPayload[K] } = { ...common };
    const branch = str(obj(pr.head).ref);
    if (branch) payload.branch = branch;
    const author = str(obj(pr.user).login);
    if (author) payload.author = author;
    if (baseSha && headSha) {
      // The merge-base, as `base...head` would use: what the pull request CHANGES, not what the base moved on to.
      const mb = r.git(["merge-base", baseSha, headSha])?.trim() || undefined;
      if (mb) {
        const changed = changes(r, mb, headSha);
        if (changed) {
          payload.changed = changed;
          const baseTexts: Record<string, string | null> = {};
          for (const f of changed) {
            if (f.status === "added") { baseTexts[f.path] = null; continue; }
            const t = r.git(["show", `${mb}:${f.path}`]);
            if (t !== null) baseTexts[f.path] = t; // unreadable → left out → cannot-tell, never "absent"
          }
          payload.baseTexts = baseTexts;
        }
      }
      if (number !== undefined) {
        const reviews = r.gh(["api", "--paginate", `repos/${repository}/pulls/${number}/reviews`]);
        const approvals = reviews === null ? undefined : approvalsFrom(reviews, headSha);
        if (approvals) payload.approvals = approvals;
      }
    }
    return { event: "pull_request", payload, ...(number !== undefined ? { pullNumber: number } : {}) };
  }

  if (eventName === "push") {
    const payload: { -readonly [K in keyof EventPayload]: EventPayload[K] } = { ...common };
    const ref = str(e.ref);
    if (ref?.startsWith("refs/heads/")) payload.branch = ref.slice("refs/heads/".length);
    if (typeof e.forced === "boolean") payload.forced = e.forced;
    const before = str(e.before), after = str(e.after);
    const fromEvent = Array.isArray(e.commits) ? e.commits.map((c) => str(obj(c).id)).filter((x): x is string => !!x) : undefined;
    if (before && after && !ZERO.test(before) && !ZERO.test(after)) {
      // git, not the event: GitHub's push payload lists at most 20 commits.
      const listed = r.git(["rev-list", `${before}..${after}`]);
      payload.commits = listed !== null ? listed.split("\n").map((s) => s.trim()).filter(Boolean) : fromEvent;
      const changed = changes(r, before, after);
      if (changed) payload.changed = changed;
    } else if (fromEvent) {
      payload.commits = fromEvent;
    }
    if (payload.commits === undefined) delete payload.commits;
    return { event: "push", payload };
  }

  if (eventName === "issues") {
    const action = str(e.action) ?? null;
    const n = obj(e.issue).number;
    return { event: action, payload: { ...common }, ...(typeof n === "number" ? { issueNumber: n } : {}) };
  }

  return { event: null, payload: { ...common } };
}
