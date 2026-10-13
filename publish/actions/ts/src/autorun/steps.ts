// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PREP STEPS `gov autorun` PERFORMS (spec 03 §3.2–§3.4; rulings Q7, Q10, Q16) — one per item, each ending at a
 * human gate:
 *
 *   draft-intent        gov intent's own path (L12): tracking issue, intent.md DRAFT, change request      → G1
 *   draft-spec|plan|build  a headless agent (L16) drafts the artifact in a WORKTREE on its own sub-branch;
 *                       gov forces its Status to DRAFT, commits it with Gov-Autorun / Gov-Agent, pushes,
 *                       opens a change request to the project branch tracing to the intent's tracking issue → G2/G3/G4b
 *   mark-plan-stale     the plan's Status → STALE (why), on its own sub-branch, by change request          → G3
 *   create-task-issues  only after G3 (Q7): one issue per plan task, through `gov issue`'s planning and the
 *                       WorkTrackerPort, assigned to the plan's approver, citing the plan's change request
 *   build-task          NOT WIRED YET — refused per item, with what to do instead
 *
 * The person's checkout is never touched by an agent step: the worktree is made from the project branch and removed
 * afterwards, and the local sub-branch with it (it lives on the remote once pushed). Never a merge, a close or a
 * signal send. A C01 event — the agent's exit naming a C01 rule, or a gate refusing gov's commit with one (Q10 a+b)
 * — returns `c01` with NOTHING committed or pushed; the run then halts.
 */
import * as path from "node:path";
import type { Fs } from "../lifecycle/fs-io.js";
import type { Vcs } from "../lifecycle/vcs.js";
import type { RepoRef, VcsPort } from "../ports/vcs.js";
import type { ProjectRef, WorkTrackerPort } from "../ports/work-tracker.js";
import type { HeadlessResult } from "../cli/work-flow.js";
import { intentBranchFor } from "../intent/create.js";
import { statusOf, type ParsedLifecycle } from "../intent/lifecycle-policy.js";
import { replaceStatusLine, staleStatusLine } from "../intent/status.js";
import { createPlannedIssue, planIssue } from "../lifecycle/issue-create.js";
import type { IntentArtifactKind } from "../intent/scan.js";
import type { Budget } from "./budget.js";
import type { Classification } from "./classify.js";
import { planTaskMarker, type IntentContext, type ItemContext } from "./facts.js";
import { withTrailers } from "./record.js";
import type { StepOutcome } from "./run.js";

export interface StepDeps {
  /** Local git. */
  readonly vcs: Vcs;
  readonly fs: Fs;
  /** The code host: change requests. */
  readonly host: VcsPort;
  readonly tracker: WorkTrackerPort;
  /** The person's governance-repo checkout, on the project branch. */
  readonly home: string;
  readonly remote: string;
  readonly projectBranch: string;
  /** Where sub-branches start: the newest of the project branch and its remote copy. */
  readonly baseRef: string;
  readonly project: string;
  readonly govRepo: RepoRef;
  readonly board: ProjectRef;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  readonly runId: string;
  /** The agent that drafts — or why none may (03-Q16): its items fail with that reason. */
  readonly agent: { readonly id: string } | { readonly refused: string };
  /** Run the agent headless with gov work's kickoff and this task brief (L16 `runHeadless`, bound). */
  readonly headless: (req: { readonly cwd: string; readonly task: string; readonly timeoutMs: number }) => Promise<HeadlessResult>;
  /** Is this GOV id an in-force C01 rule? (a gate refusing gov's commit with one halts the run, Q10 a) */
  readonly isC01: (id: string) => boolean;
  /** Where the per-item worktrees go (gov's state dir). */
  readonly worktreeRoot: string;
  readonly lifecycle: ParsedLifecycle;
  /** `gov intent <url>` (L12), with the run's trailers on its commit. */
  readonly draftIntent: (issueUrl: string) => Promise<{ readonly code: number; readonly lines: readonly string[] }>;
  readonly contextOf: (id: string) => ItemContext | undefined;
}

const GATE: Readonly<Record<IntentArtifactKind, string>> = { intent: "G1", spec: "G2", plan: "G3", build: "G4b" };
const WHO: Readonly<Record<IntentArtifactKind, string>> = { intent: "the business owner", spec: "the project owner", plan: "the project owner", build: "the project owner" };
const GOV_ID = /\bGOV-[A-Z][A-Z0-9]{1,5}-\d{3,}\b/g;

const fail = (detail: string): StepOutcome => ({ kind: "failed", detail });
const lastLine = (s: string): string => s.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? "";

/** The per-item task brief: what to draft, with which skill and template, and what is gov's to do, not the agent's. */
export function taskBrief(b: {
  readonly runId: string; readonly artifact: IntentArtifactKind; readonly path: string; readonly template: string | null;
  readonly inputs: readonly string[]; readonly note?: string;
}): string {
  return [
    `AUTORUN TASK (gov autorun ${b.runId}) — nobody is at the terminal. After the session-start protocol, draft ONE lifecycle artifact.`,
    "",
    `Artifact: ${b.path}`,
    `Step: ${b.artifact} — use the skill gov-lifecycle-${b.artifact}; it carries your organization's lifecycle section for this step.`,
    ...(b.template ? [`Template: ${b.template} — keep every section it has.`] : []),
    ...(b.inputs.length ? [`Read first: ${b.inputs.join(", ")}`] : []),
    ...(b.note ? [b.note] : []),
    "",
    "Rules for this session:",
    `- Write ONLY ${b.path}. Its Status line stays **Status:** DRAFT — an agent never approves; a person does, on the change request.`,
    "- Do not commit, push, open change requests, create or close issues, merge, or send signals. gov does what follows.",
    "- Open questions go in the artifact, for the person who reviews it.",
    "- If a C01 rule forbids this step, stop, print the rule's GOV id, and exit non-zero.",
  ].join("\n");
}

export function makeStep(d: StepDeps): (c: Classification, budget: Budget) => Promise<StepOutcome> {
  const trailers = (agent: string) => ({ runId: d.runId, agent });

  /** A sub-branch name nobody has used: `<base>`, else `<base>-2` … `<base>-9`. */
  const freeBranch = (base: string): string | null => {
    for (const b of [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `${base}-${k}`)]) {
      if (!d.vcs.localBranchExists(d.home, b) && !d.vcs.remoteBranchExists(d.home, d.remote, b)) return b;
    }
    return null;
  };

  /** A C01 id in a gate's refusal (a commit hook, gov check) — Q10 (a). */
  const c01In = (text: string): string | null => [...new Set(text.match(GOV_ID) ?? [])].find((id) => d.isC01(id)) ?? null;

  /**
   * On a fresh sub-branch in a worktree: `work` changes the artifact; gov commits it, pushes, and opens the change
   * request. Nothing is left behind on any failure; the remote branch exists only once the commit is made.
   */
  async function onSubBranch(
    ctx: IntentContext, artifact: IntentArtifactKind, suffix: string, agentKind: string,
    work: (wt: string) => Promise<StepOutcome | { message: string; title: string }>,
  ): Promise<StepOutcome> {
    const branch = freeBranch(`${intentBranchFor(d.projectBranch, ctx.nn, artifact)}${suffix}`);
    if (!branch) return fail(`every sub-branch name for intent ${ctx.nn}'s ${artifact} is taken — delete the old ones`);
    const wt = path.join(d.worktreeRoot, `${d.runId}-${ctx.nn}-${artifact}${suffix}`);
    try {
      d.fs.mkdirp(d.worktreeRoot);
      d.vcs.worktreeAdd(d.home, branch, wt, d.baseRef);
      const before = d.vcs.headSha(wt);
      const w = await work(wt);
      if ("kind" in w) return w;
      if (d.vcs.headSha(wt) !== before) return fail("the agent committed by itself — autorun commits; nothing was kept");
      const rel = `${ctx.intent.dir}/${artifact}.md`;
      d.vcs.addPath(wt, rel);
      try {
        d.vcs.commit(wt, withTrailers(w.message, trailers(agentKind)));
      } catch (e) {
        const msg = (e as Error).message;
        const id = c01In(msg);
        if (id) return { kind: "c01", id, detail: `the commit was refused: ${lastLine(msg)}` };
        return fail(`the commit failed: ${lastLine(msg)}`);
      }
      try { d.vcs.push(wt, d.remote, branch, { setUpstream: true }); } catch (e) {
        return fail(`could not push ${branch}: ${lastLine((e as Error).message)}`);
      }
      const traces = ctx.trackingUrl ? `Traces to: ${ctx.trackingUrl}` : `Traces to: intent ${ctx.nn} (\`${ctx.intent.dir}/\`) — it names no tracking issue`;
      const cr = await d.host.openChangeRequest({
        repo: d.govRepo, head: branch, base: d.projectBranch, title: w.title,
        body: [
          `${w.title} — prepared by \`gov autorun\` (run ${d.runId}${agentKind === "gov" ? "" : `, drafted by a headless ${agentKind} session`}).`,
          "",
          traces,
          "",
          `Artifact: \`${rel}\``,
          "",
          `Gate ${GATE[artifact]}: ${WHO[artifact]} reviews this change request. Approval is a person's approving review here, then`,
          "merge — gov reads it from the host, never from text an agent could write. autorun never merges.",
        ].join("\n"),
      });
      if (!cr.ok) return fail(`${branch} is pushed, but the change request could not be opened: ${cr.reason}`);
      const info = await d.host.changeRequest(cr.value);
      const url = info.ok && info.value.url ? info.value.url : `${d.govRepo.owner}/${d.govRepo.name}#${cr.value.number}`;
      if (ctx.trackingUrl) {
        // Best-effort: the change request already traces to the issue; a comment the tracker refuses changes nothing.
        try { await d.tracker.comment({ url: ctx.trackingUrl }, `${w.title}: ${url} (gov autorun ${d.runId})`); } catch { /* reported nowhere — the CR is the record */ }
      }
      return { kind: "ok", cr: url };
    } catch (e) {
      return fail(lastLine((e as Error).message) || String(e));
    } finally {
      try { d.vcs.worktreeRemove(d.home, wt); } catch { /* the registry is pruned by the next worktree add */ }
      try { if (d.vcs.localBranchExists(d.home, branch)) d.vcs.branchDelete(d.home, branch); } catch { /* left for the person; harmless */ }
    }
  }

  /** Draft spec, plan or build with the headless agent. */
  async function draftWithAgent(ctx: IntentContext, artifact: "spec" | "plan" | "build", budget: Budget): Promise<StepOutcome> {
    if ("refused" in d.agent) return fail(d.agent.refused);
    const agentId = d.agent.id;
    const rel = `${ctx.intent.dir}/${artifact}.md`;
    const template = d.lifecycle.steps.find((s) => s.step === artifact)?.template ?? null;
    const inputs = (["intent", "spec", "plan"] as const).filter((k) => k !== artifact && ctx.intent.artifacts[k]).map((k) => `${ctx.intent.dir}/${k}.md`);
    const note = artifact === "plan" && ctx.intent.artifacts.plan?.status?.kind === "stale"
      ? `The plan in ${rel} is STALE (${ctx.intent.artifacts.plan.status.text}): redraft it against the changed spec.`
      : artifact === "build" ? `Every task's change request is merged; record what shipped from them (${Object.values(ctx.taskIssueOf).join(", ") || "the plan's task issues"}).` : undefined;
    const task = taskBrief({ runId: d.runId, artifact, path: rel, template, inputs, ...(note ? { note } : {}) });
    return onSubBranch(ctx, artifact, "", agentId, async (wt) => {
      const file = path.join(wt, ...rel.split("/"));
      const was = d.fs.readFile(file);
      const r = await d.headless({ cwd: wt, task, timeoutMs: budget.itemMinutes * 60_000 });
      if (r.outcome === "refused") return fail(r.reason ?? "the agent may not run headless");
      if (r.outcome === "c01") return { kind: "c01", id: r.c01Ids[0] ?? "C01", detail: `the ${agentId} session stopped on a C01 rule: ${lastLine(r.output)}` };
      if (r.outcome === "failed") {
        return fail(r.timedOut ? `the agent ran past the time budget (${budget.itemMinutes} min) and was stopped`
          : `the agent exited ${r.exitCode ?? "(killed)"}${lastLine(r.output) ? `: ${lastLine(r.output)}` : ""}`);
      }
      let text = d.fs.readFile(file);
      if (text === null || text === was) return fail(`the agent did not write ${rel}`);
      // An agent never approves (Q2): whatever Status it wrote, the draft says DRAFT.
      if (statusOf(text)?.kind !== "draft") {
        const s = replaceStatusLine(text, "**Status:** DRAFT");
        text = s.ok ? s.value : text.replace(/^(# .*\r?\n)/m, "$1\n**Status:** DRAFT\n");
        if (!/^\*\*Status/m.test(text)) text = `**Status:** DRAFT\n\n${text}`;
        d.fs.writeFile(file, text);
      }
      const title = `Intent ${ctx.nn}: ${artifact} (DRAFT)`;
      return {
        title,
        message: [`autorun: draft the ${artifact} of intent ${ctx.intent.id} (DRAFT)`, "",
          `Drafted by a headless ${agentId} session under gov autorun ${d.runId}. A person approves it (${GATE[artifact]}).`,
          ...(ctx.trackingUrl ? [`Traces to: ${ctx.trackingUrl}`] : [])].join("\n"),
      };
    });
  }

  async function markPlanStale(ctx: IntentContext): Promise<StepOutcome> {
    const why = ctx.staleWhy ?? "the spec changed after the plan was approved";
    return onSubBranch(ctx, "plan", "-stale", "gov", async (wt) => {
      const file = path.join(wt, ...`${ctx.intent.dir}/plan.md`.split("/"));
      const text = d.fs.readFile(file);
      if (text === null) return fail(`${ctx.intent.dir}/plan.md is not on ${d.projectBranch}`);
      const s = replaceStatusLine(text, staleStatusLine(why));
      if (!s.ok) return fail(`${ctx.intent.dir}/plan.md: ${s.reason}`);
      d.fs.writeFile(file, s.value);
      return {
        title: `Intent ${ctx.nn}: plan STALE — ${why}`,
        message: [`autorun: mark the plan of intent ${ctx.intent.id} STALE`, "", `${why}. The spec re-opened (G2); the plan is redrafted after it (G3).`,
          ...(ctx.trackingUrl ? [`Traces to: ${ctx.trackingUrl}`] : [])].join("\n"),
      };
    });
  }

  async function createTaskIssues(ctx: IntentContext): Promise<StepOutcome> {
    const approved = ctx.approvals.plan;
    if (!approved) return fail("the plan has no verified approval — only G3 authorises its task issues (Q7)");
    const todo = ctx.tasks.filter((t) => !ctx.taskIssueOf[t.id]);
    const made: string[] = [], problems: string[] = [];
    for (const t of todo) {
      const repo = !t.repo ? `${d.githubOrg}/${d.workspaceRepo}` : t.repo.includes("/") ? t.repo : `${d.githubOrg}/${t.repo}`;
      const planned = planIssue({
        repo, title: `${t.id} — ${t.title}`, assignee: approved.by, githubOrg: d.githubOrg, board: d.board.number,
        defaultRepo: `${d.githubOrg}/${d.workspaceRepo}`, intent: ctx.nn,
        body: [
          `Task ${t.id} of intent ${ctx.nn} (${d.project}), from the approved plan \`${ctx.intent.dir}/plan.md\`.`,
          "",
          `Plan approved (G3) by @${approved.by}: ${approved.url}`,
          `That approval authorises this issue (spec 03, Q7); \`gov autorun\` created it in run ${d.runId}, assigned to the approver.`,
          "",
          planTaskMarker(d.project, ctx.nn, t.id),
        ].join("\n"),
      });
      if (!planned.ok) { problems.push(`${t.id}: ${planned.message}`); continue; }
      const out = await createPlannedIssue(planned.plan, d.tracker, d.board.owner);
      const url = out.lines[1]?.trim() ?? "";
      if (out.code === 0) made.push(`${t.id} ${url}`);
      else problems.push(`${t.id}: ${out.lines.map((l) => l.trim()).join(" · ")}`);
    }
    if (problems.length) return fail(`task issues: ${made.length} created${made.length ? ` (${made.join(", ")})` : ""}; ${problems.join("; ")}`);
    return { kind: "ok", detail: `${made.length} task issue(s) created, assigned to ${approved.by}${made.length ? `: ${made.join(", ")}` : ""}` };
  }

  return async (c, budget) => {
    const ctx = d.contextOf(c.id);
    if (!ctx) return fail(`autorun lost track of ${c.id}`);
    switch (c.next) {
      case "draft-intent": {
        if (ctx.kind !== "issue") return fail("draft-intent needs a board issue");
        const r = await d.draftIntent(ctx.item.ref.url);
        const cr = r.lines.map((l) => /change request:\s*(\S+)/.exec(l)?.[1]).find((x) => x);
        if (r.code !== 0) return fail(r.lines.map((l) => l.trim()).filter(Boolean).join(" · ") || "gov intent failed");
        return cr ? { kind: "ok", cr } : { kind: "ok", detail: r.lines[0] ?? "intent drafted" };
      }
      case "draft-spec": case "draft-plan": case "draft-build":
        if (ctx.kind !== "intent") return fail(`${c.next} needs an intent`);
        return draftWithAgent(ctx, c.next.slice("draft-".length) as "spec" | "plan" | "build", budget);
      case "mark-plan-stale":
        if (ctx.kind !== "intent") return fail("mark-plan-stale needs an intent");
        return markPlanStale(ctx);
      case "create-task-issues":
        if (ctx.kind !== "intent") return fail("create-task-issues needs an intent");
        return createTaskIssues(ctx);
      case "build-task":
        return fail(`building a task is not wired into autorun yet — start ${c.target ?? "the task issue"} with \`gov task <issue>\` and work it with \`gov work\`; autorun picks the item up again at G4`);
      default:
        return fail(`no step for ${String(c.next)}`);
    }
  };
}
