// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT `gov autorun` FINDS (spec 03 §3.1–§3.2; rulings Q1, Q2, Q4, Q7): the facts `classify` decides on, read
 *
 *   the project branch's tree ──► intents/<NN-slug>/{intent,spec,plan,build}.md       (L11's scan, Q1)
 *   the code host (VcsPort) ────► each artifact's change requests: open = waiting; merged + a PERSON's approving
 *                                 review = approved (Q2) — a Status line is a claim, checked against the host
 *   the board (WorkTrackerPort) ► the plan's task issues (found by their marker) and the board issues in no intent
 *
 * Ports only (spec §6): nothing here calls `gh`. A port that cannot answer fails the whole collection with its
 * reason — an autorun that saw "nothing to do" because the host was down would be the silent best-effort the
 * ports exist to end.
 */
import type { ChangeRequest, RepoRef, VcsPort } from "../ports/vcs.js";
import type { Item, ProjectRef, WorkTrackerPort } from "../ports/work-tracker.js";
import { approvalOf, verifyStatus } from "../intent/approval.js";
import { INTENT_ARTIFACTS, scanIntents, type IntentArtifactKind, type ScannedIntent, type TreeReader } from "../intent/scan.js";
import { planStaleness } from "../intent/status.js";
import type { ArtifactState, ItemFacts, TaskIssue } from "./classify.js";

// ── the plan's tasks ─────────────────────────────────────────────────────────────────────────────────────────

export interface PlanTask {
  /** `T01` — the id the plan gives it. */
  readonly id: string;
  readonly title: string;
  /** As the plan writes it (`owner/name` or `name`); null when the plan names none. */
  readonly repo: string | null;
}

const FENCE = /^\s*(```|~~~)/;
const PLACEHOLDER = /^<[^>]*>$/;

/**
 * The tasks of a plan: each `### <id> — <title>` under `## Tasks`, with its `**Repo:**` value. The template's own
 * placeholder task (`<title>`) is not a task.
 */
export function planTasks(planText: string): PlanTask[] {
  const out: { id: string; title: string; repo: string | null }[] = [];
  let inTasks = false, fence = false;
  for (const line of planText.split(/\r?\n/)) {
    if (FENCE.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^##\s/.test(line)) { inTasks = /^##\s+Tasks\s*$/.test(line); continue; }
    if (!inTasks) continue;
    const h = /^###\s+(\S+)\s+[—–-]+\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (PLACEHOLDER.test(h[2]!.trim())) { out.push({ id: "", title: "", repo: null }); continue; }
      out.push({ id: h[1]!, title: h[2]!, repo: null });
      continue;
    }
    const r = /\*\*Repo:\*\*\s*`?([^`·\s]+)`?/.exec(line);
    const last = out[out.length - 1];
    if (r && last && last.id && last.repo === null && !PLACEHOLDER.test(r[1]!)) last.repo = r[1]!;
  }
  return out.filter((t) => t.id);
}

/** The line a plan task's issue carries, so autorun finds it again — and never creates it twice. */
export const planTaskMarker = (project: string, nn: string, task: string): string =>
  `<!-- gov-plan-task ${JSON.stringify({ project, intent: nn, task })} -->`;

export function parsePlanTaskMarker(body: string): { project: string; intent: string; task: string } | null {
  const m = /<!-- gov-plan-task (\{[^\n]*?\}) -->/.exec(body);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]!) as { project?: unknown; intent?: unknown; task?: unknown };
    return typeof j.project === "string" && typeof j.intent === "string" && typeof j.task === "string"
      ? { project: j.project, intent: j.intent, task: j.task } : null;
  } catch { return null; /* a marker that is not JSON is not gov's: the issue is simply not a plan task */ }
}

/** `<PB>.INTENT-<NN>-<artifact>[-stale][-<k>]` → which intent and artifact it drafts; null for any other branch. */
export function artifactOfBranch(projectBranch: string, head: string): { nn: string; artifact: IntentArtifactKind; stale: boolean } | null {
  if (!head.startsWith(`${projectBranch}.INTENT-`)) return null;
  const m = /^(\d{2})-(intent|spec|plan|build)(-stale)?(?:-\d+)?$/.exec(head.slice(projectBranch.length + ".INTENT-".length));
  return m ? { nn: m[1]!, artifact: m[2] as IntentArtifactKind, stale: !!m[3] } : null;
}

/**
 * A board issue in no intent — what the first row of §3.2 drafts an intent from. Not gov's own issues (any
 * `gov-…` label: intents, signals; a gov marker; the project's anchor), not one already started or done (a task
 * already under way is build work, not an intent to draft), not a pull request, not closed.
 */
export function isLooseIssue(i: Item): boolean {
  if (i.state !== "open" || !/\/issues\/\d+\/?$/.test(i.ref.url)) return false;
  if (i.labels.some((l) => l.startsWith("gov-"))) return false;
  if (i.body.includes("<!-- gov-") || /^Anchor issue for the project\b/.test(i.body.trim())) return false;
  return i.workState === undefined || i.workState === null || i.workState === "todo";
}

/** `app#42` for a GitHub-shaped issue address; the address itself otherwise. */
export function shortIssue(url: string): string {
  const m = /\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url;
}

// ── collecting ───────────────────────────────────────────────────────────────────────────────────────────────

export interface Approved { readonly by: string; readonly at: string; readonly url: string }

export interface IntentContext {
  readonly kind: "intent";
  readonly intent: ScannedIntent;
  readonly nn: string;
  /** The intent tracking issue (Q4b) its artifact change requests trace to, read from intent.md. */
  readonly trackingUrl: string | null;
  /** Each artifact a person approved, and how gov knows. */
  readonly approvals: Partial<Record<IntentArtifactKind, Approved>>;
  /** Why the plan is stale (row 8), when it is. */
  readonly staleWhy: string | null;
  readonly tasks: readonly PlanTask[];
  /** Task id → the task issue already created for it. */
  readonly taskIssueOf: Readonly<Record<string, string>>;
}

export interface IssueContext { readonly kind: "issue"; readonly item: Item }

export type ItemContext = IntentContext | IssueContext;

export interface Collected { readonly facts: ItemFacts; readonly context: ItemContext }

export interface CollectDeps {
  /** The project branch's tree (the newest of the local branch and its remote copy). */
  readonly tree: TreeReader;
  readonly host: VcsPort;
  readonly tracker: WorkTrackerPort;
  /** The governance repo, where intents and their change requests live. */
  readonly govRepo: RepoRef;
  readonly board: ProjectRef;
  readonly project: string;
  readonly projectBranch: string;
  /** When `path` last changed on the scanned branch (ISO time), or null. */
  readonly changedAt: (path: string) => string | null;
}

export type CollectResult =
  | { readonly ok: true; readonly items: Collected[]; readonly notes: string[] }
  | { readonly ok: false; readonly reason: string };

const failed = (r: { reason: string }, what: string): CollectResult => ({ ok: false, reason: `${what}: ${r.reason}` });

/** `owner/name` of an issue address, for reading its change requests. */
function repoOfIssue(url: string): RepoRef | null {
  const m = /\/([^/]+)\/([^/]+)\/issues\/\d+\/?$/.exec(url);
  return m ? { owner: m[1]!, name: m[2]! } : null;
}

export async function collectItems(d: CollectDeps): Promise<CollectResult> {
  const scan = await scanIntents(d.tree, d.project);
  if (!scan.active) return { ok: true, items: [], notes: [scan.message] };
  const notes: string[] = scan.skipped.map((s) => `skipped ${s.path}: ${s.reason}`);

  const crs = await d.host.changeRequests(d.govRepo, { base: d.projectBranch, state: "all" });
  if (!crs.ok) return failed(crs, `reading the change requests to ${d.projectBranch}`);
  const board = await d.tracker.items(d.board);
  if (!board.ok) return failed(board, `reading board #${d.board.number}`);

  // Each intent's artifact change requests, newest first (the host's order).
  const byIntent = new Map<string, { cr: ChangeRequest; artifact: IntentArtifactKind; stale: boolean }[]>();
  for (const cr of crs.value) {
    const a = artifactOfBranch(d.projectBranch, cr.head);
    if (!a) continue;
    if (!byIntent.has(a.nn)) byIntent.set(a.nn, []);
    byIntent.get(a.nn)!.push({ cr, artifact: a.artifact, stale: a.stale });
  }

  const items: Collected[] = [];
  for (const intent of scan.intents) {
    const nn = intent.id.slice(0, 2);
    const own = (byIntent.get(nn) ?? []).sort((a, b) => b.cr.ref.number - a.cr.ref.number);
    const open = own.find((x) => x.cr.state === "open");

    const states: Record<IntentArtifactKind, ArtifactState> = { intent: "absent", spec: "absent", plan: "absent", build: "absent" };
    const approvals: Partial<Record<IntentArtifactKind, Approved>> = {};
    for (const kind of INTENT_ARTIFACTS) {
      const a = intent.artifacts[kind];
      if (!a) continue;
      if (a.status?.kind === "stale") { states[kind] = "stale"; continue; }
      if (a.status?.kind === "approved") {
        const v = await verifyStatus(d.host, a.text);
        if (!v.ok) {
          // Not knowing is not approval: the item waits, and the report says why. Never a step on an unchecked claim.
          notes.push(`${intent.id} ${kind}: its Status says APPROVED, but the host could not confirm it (${v.reason}) — treated as a draft`);
          states[kind] = "draft";
          continue;
        }
        if (v.value.approved) { states[kind] = "approved"; approvals[kind] = { by: v.value.by, at: v.value.at, url: v.value.url }; continue; }
        notes.push(`${intent.id} ${kind}: its Status says APPROVED, but ${v.value.reason} — treated as a draft`);
        states[kind] = "draft";
        continue;
      }
      // DRAFT in the file: approved when its latest merged change request carries a person's approval (Q2 — gov
      // writes the Status line on merge; until it has, the host is the record).
      states[kind] = "draft";
      const merged = own.find((x) => x.artifact === kind && !x.stale && x.cr.merged);
      if (merged) {
        const ap = await approvalOf(d.host, merged.cr.ref);
        if (!ap.ok) return failed(ap, `checking the approval of ${merged.cr.url}`);
        if (ap.value.approved) { states[kind] = "approved"; approvals[kind] = { by: ap.value.by, at: ap.value.at, url: ap.value.url }; }
      }
    }

    let staleWhy: string | null = null;
    const spec = intent.artifacts.spec;
    if (states.plan === "approved" && approvals.plan && spec) {
      const changed = d.changedAt(spec.path);
      if (changed) {
        const s = planStaleness({ planApprovedAt: approvals.plan.at, specChangedAt: changed });
        if (s.stale) staleWhy = s.why;
      }
    }

    const tasks = states.plan === "approved" ? planTasks(intent.artifacts.plan!.text) : [];
    const taskIssueOf: Record<string, string> = {};
    const taskIssues: TaskIssue[] = [];
    if (states.plan === "approved") {
      for (const it of board.value) {
        const m = parsePlanTaskMarker(it.body);
        if (!m || m.project !== d.project || m.intent !== nn || taskIssueOf[m.task]) continue;
        taskIssueOf[m.task] = it.ref.url;
        let cr: TaskIssue["cr"] = "none";
        const repo = repoOfIssue(it.ref.url);
        const n = /\/issues\/(\d+)\/?$/.exec(it.ref.url)?.[1];
        if (repo && n) {
          const found = await d.host.changeRequests(repo, { head: `${d.projectBranch}.ISSUE-${n}`, state: "all" });
          if (!found.ok) return failed(found, `reading the change requests of ${it.ref.url}`);
          cr = found.value.some((c) => c.state === "open") ? "open" : found.value.some((c) => c.merged) ? "merged" : "none";
        }
        taskIssues.push({ issue: it.ref.url, cr });
      }
    }

    const trackingUrl = /\*\*Tracking issue:\*\*\s*(\S+)/.exec(intent.artifacts.intent?.text ?? "")?.[1] ?? null;
    items.push({
      facts: {
        kind: "intent", id: intent.id, intent: states.intent, spec: states.spec, plan: states.plan, build: states.build,
        openDraftCr: open ? { artifact: open.artifact, url: open.cr.url } : null,
        specChangedAfterPlanApproval: staleWhy !== null,
        planTasks: tasks.length, taskIssues,
      },
      context: { kind: "intent", intent, nn, trackingUrl, approvals, staleWhy, tasks, taskIssueOf },
    });
  }

  for (const it of board.value.filter(isLooseIssue)) {
    items.push({ facts: { kind: "issue", id: shortIssue(it.ref.url) }, context: { kind: "issue", item: it } });
  }
  return { ok: true, items, notes };
}

