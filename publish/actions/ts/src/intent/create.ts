// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov intent <issue-url>… [--slug s]` — DRAFT AN INTENT FROM BOARD ISSUES (PRJ-121 intent 03, D3; rulings Q1, Q3, Q4).
 *
 *   read the active lifecycle ──► read the issues ──► create the intent TRACKING issue (Q4b) ──► sub-branch
 *   (no lifecycle → say so,       (WorkTrackerPort;     assigned to you, on the board,           <PB>.INTENT-<NN>-intent
 *    do nothing)                   closed → refused)    labelled gov-intent:<NN>                 write intent.md, commit, push
 *                                                                                                      │
 *                     comment the CR link on the tracking issue ◄── open a change request to <PB> ◄─────┘
 *                                                                   (VcsPort; body: "Traces to: <tracking issue>")
 *
 * WHAT IS WRITTEN: `projects/<PRJ>/intents/<NN-slug>/intent.md`, from the template the active lifecycle's Intent
 * step names — Status DRAFT, every §2.3 section, "Board items" filled from the issues, and in "Interview decisions"
 * the owner-interview questions the issues do not already answer (outcome, who benefits, priority, success
 * measure, in/out of scope, constraints, risks), each with a recommendation line for the agent to fill before the
 * interview. A topic the issues DO answer (a heading or label line with real text) is recorded as answered by the
 * record, and its text fills the section it belongs to.
 *
 * WHY A TRACKING ISSUE (Q4b): every change request traces to one issue (GOV-FRM-443). An intent groups several,
 * so it gets its own — the board's card for the intent, which every artifact change request (intent, spec, plan,
 * build.md) traces to. It is created FIRST, so the draft and the change request can name it.
 *
 * `gov task` stays build-stage only (Q3); this verb never starts a task.
 *
 * Ports only for the host and the tracker (spec §6 guard: nothing here calls `gh`). Local git — branch, commit,
 * push — is the lifecycle's {@link Vcs}, because git is the same on every host. Every port write's outcome is read;
 * a failure is reported with what already exists, and exits non-zero.
 */
import * as path from "node:path";
import type { Fs } from "../lifecycle/fs-io.js";
import type { Vcs } from "../lifecycle/vcs.js";
import { Transaction } from "../lifecycle/transaction.js";
import { userDirtyPaths, dirtyRefusal } from "../lifecycle/root-protocol.js";
import { boardNumberFromBranch } from "../lifecycle/task.js";
import type { Item, ItemRef, WorkTrackerPort } from "../ports/work-tracker.js";
import type { VcsPort } from "../ports/vcs.js";
import type { Result } from "../ports/result.js";
import { LIFECYCLE_POLICY_PATH, missingSections, parseLifecycle } from "./lifecycle-policy.js";
import { INTENT_DIR_NAME, intentsDir } from "./scan.js";
import { replaceStatusLine } from "./status.js";

export interface IntentCreateDeps {
  /** Local git in the workspace (the governance repo clone). */
  readonly vcs: Vcs;
  readonly fs: Fs;
  readonly tracker: WorkTrackerPort;
  /** The code host — opens the change request. */
  readonly host: VcsPort;
  readonly log?: (msg: string) => void;
}

export interface IntentCreateInput {
  /** The workspace repo checkout, on the project branch (or one of its sub-branches). */
  readonly govClone: string;
  readonly issueUrls: readonly string[];
  /** The folder's slug; default: from the first issue's title. */
  readonly slug?: string;
  /** The invoker — the tracking issue's assignee. */
  readonly assignee: string;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  readonly today: string;
  readonly remote?: string;
}

export interface IntentOutcome { readonly code: number; readonly lines: readonly string[] }

// ── the pure parts ──────────────────────────────────────────────────────────────────────────────────────────

/** The sub-branch an intent's artifact is drafted on: `<project-branch>.INTENT-<NN>-<artifact>`. */
export const intentBranchFor = (projectBranch: string, nn: string, artifact: "intent" | "spec" | "plan" | "build" = "intent"): string =>
  `${projectBranch}.INTENT-${nn}-${artifact}`;

/** The project branch under any task (`.ISSUE-…`) or intent (`.INTENT-…`) sub-branch. */
export const projectBranchUnder = (branch: string): string => branch.split(/\.(?:ISSUE|INTENT)-/)[0]!;

/** The label that tags an issue into intent `<NN>` (the same one `gov issue --intent` sets). */
export const intentLabel = (nn: string): string => `gov-intent:${nn}`;

/**
 * The next free two-digit intent number: one more than the highest used by a folder under `intents/` or by an
 * intent sub-branch still in flight (`inFlight`: the NN of each). `01` when none; null past 99.
 */
export function nextIntentNumber(folders: readonly string[], inFlight: readonly string[]): string | null {
  const used = [
    ...folders.map((n) => /^(\d{2})-/.exec(n)?.[1]).filter((x): x is string => x !== undefined),
    ...inFlight,
  ].map(Number).filter((n) => Number.isInteger(n));
  const next = Math.max(0, ...used) + 1;
  return next > 99 ? null : String(next).padStart(2, "0");
}

/** A folder slug from a title: lowercase words joined by dashes, at most five words and 40 characters. */
export function intentSlugFrom(title: string): string {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  let s = words.join("-");
  while (s.length > 40 && s.includes("-")) s = s.slice(0, s.lastIndexOf("-"));
  return s.slice(0, 40);
}

/** What the owner interview covers (lifecycle §Intent, M6f) — asked only when the issues leave it open. */
export interface InterviewTopic {
  readonly id: "outcome" | "who" | "priority" | "success" | "scope" | "constraints" | "risks";
  readonly label: string;
  readonly question: string;
  /** Heading / label words in an issue that answer it. */
  readonly answeredBy: RegExp;
  /** The intent section its answer fills, if any. */
  readonly section?: string;
}

export const INTERVIEW_TOPICS: readonly InterviewTopic[] = [
  { id: "outcome", label: "Outcome", section: "Goal",
    question: "What outcome do you want — what will be true for the business when this is done?",
    answeredBy: /^(outcomes?|goals?|objectives?|desired outcome)$/i },
  { id: "who", label: "Who benefits",
    question: "Who benefits, and how will they notice the change?",
    answeredBy: /^(who benefits|beneficiar(y|ies)|users?|audience|personas?|stakeholders?)$/i },
  { id: "priority", label: "Priority",
    question: "How important is this against the project's other work, and is there a date it must meet?",
    answeredBy: /^(priority|urgency)$/i },
  { id: "success", label: "Success measure", section: "Done when",
    question: "How will we know it worked — what observable result says this intent is met?",
    answeredBy: /^(success( measures?| criteria| metrics?)?|acceptance( criteria)?|done when|definition of done)$/i },
  { id: "scope", label: "In/out of scope", section: "Out",
    question: "What is in scope, and what is explicitly out?",
    answeredBy: /^((in|out of|non)[- ]?scope|scope|non-goals?)$/i },
  { id: "constraints", label: "Constraints",
    question: "What constraints must the solution respect — time, budget, technology, regulation?",
    answeredBy: /^(constraints?|limitations?)$/i },
  { id: "risks", label: "Risks",
    question: "What could go wrong, and what would it cost?",
    answeredBy: /^(risks?|risks and mitigations)$/i },
];

/** The issue facts drafting needs. */
export interface SourceIssue { readonly url: string; readonly title: string; readonly body: string }

interface Answer { readonly topic: InterviewTopic; readonly issue: string; readonly heading: string; readonly text: string }

/** A placeholder is not an answer: `<…>`, TBD, TODO, n/a, ?, -. */
const isPlaceholder = (s: string): boolean => /^(<[^>]*>|tbd|todo|n\/?a|\?+|-+|…)$/i.test(s.trim());

/** Labelled parts of an issue body: `## Heading` + its lines, `**Label:** text`, or `Label: text`. */
function labelledParts(body: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  const lines = body.split(/\r?\n/);
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) {
      const text: string[] = [];
      for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]!); j++) text.push(lines[j]!);
      out.push({ heading: h[1]!.replace(/[:*_]/g, "").trim(), text: text.join("\n").trim() });
      continue;
    }
    const b = /^\s*(?:[-*]\s+)?\*\*([^*]{1,40}?):?\*\*:?\s*(.*)$/.exec(l) ?? /^\s*(?:[-*]\s+)?([A-Za-z][A-Za-z /-]{1,40}):\s+(\S.*)$/.exec(l);
    if (b) out.push({ heading: b[1]!.trim(), text: b[2]!.trim() });
  }
  return out;
}

function answers(issues: readonly SourceIssue[]): Answer[] {
  const found: Answer[] = [];
  for (const topic of INTERVIEW_TOPICS) {
    for (const issue of issues) {
      const part = labelledParts(issue.body).find((p) => topic.answeredBy.test(p.heading) && p.text && !isPlaceholder(p.text));
      if (part) { found.push({ topic, issue: issue.url, heading: part.heading, text: part.text }); break; }
    }
  }
  return found;
}

/** The interview topics the issues leave open — the questions to ask, in order. */
export function unansweredTopics(issues: readonly SourceIssue[]): InterviewTopic[] {
  const done = new Set(answers(issues).map((a) => a.topic.id));
  return INTERVIEW_TOPICS.filter((t) => !done.has(t.id));
}

/** `owner/repo#n` for an issue URL gov recognises; the URL itself otherwise. */
function shortRef(url: string): string {
  const m = /^[a-z]+:\/\/[^/]+\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(url);
  return m ? `${m[1]}/${m[2]}#${m[3]}` : url;
}

const FENCE = /^\s*(```|~~~)/;

/** Replace a `## heading` section's body, keeping its HTML comments (the template's guidance for the next writer). */
function setSection(text: string, heading: string, body: string): string {
  const ls = text.split("\n");
  let fence = false;
  let start = -1;
  let end = ls.length;
  for (let i = 0; i < ls.length; i++) {
    if (FENCE.test(ls[i]!)) { fence = !fence; continue; }
    if (fence || !ls[i]!.startsWith("## ")) continue;
    if (start >= 0) { end = i; break; }
    if (ls[i]!.slice(3).trim() === heading) start = i + 1;
  }
  if (start < 0) return text;
  const kept: string[] = [];
  let inComment = false;
  for (const l of ls.slice(start, end)) {
    if (inComment || l.trim().startsWith("<!--")) {
      kept.push(l);
      inComment = !l.includes("-->");
    }
  }
  return [...ls.slice(0, start), ...kept, ...body.trimEnd().split("\n"), "", ...ls.slice(end)].join("\n");
}

export interface DraftFacts {
  readonly nn: string;
  readonly title: string;
  readonly project: string;
  readonly owner: string;
  readonly trackingUrl: string;
  readonly issues: readonly SourceIssue[];
}

/** intent.md from the lifecycle's template: Status DRAFT, every §2.3 section, board items and interview filled. */
export function draftIntent(template: string, f: DraftFacts): string {
  let t = template
    .replace(/<NN>/g, f.nn).replace(/<title>/g, f.title).replace(/<PRJ>/g, f.project).replace(/<owner>/g, f.owner)
    .replace(/\r\n/g, "\n");

  // Status: DRAFT, whatever the template said; inserted under the title when it has none.
  const s = replaceStatusLine(t, "**Status:** DRAFT");
  t = s.ok ? s.value : t.replace(/^(# .*\n)/m, `$1\n**Status:** DRAFT\n`);
  if (!/^\*\*Status/m.test(t)) t = `**Status:** DRAFT\n\n${t}`;

  // The tracking issue, on the Project line (or under the Status line).
  if (/^\*\*Project:\*\*.*$/m.test(t)) t = t.replace(/^(\*\*Project:\*\*.*)$/m, `$1 · **Tracking issue:** ${f.trackingUrl}`);
  else t = t.replace(/^(\*\*Status.*)$/m, `$1\n\n**Project:** ${f.project} · **Tracking issue:** ${f.trackingUrl}`);

  // Every §2.3 section, even when the org's template lacks one.
  for (const h of missingSections("intent", t)) t = `${t.trimEnd()}\n\n## ${h}\n<to be drafted>\n`;

  t = setSection(t, "Board items", f.issues.map((i) => `- [${shortRef(i.url)}](${i.url}) ${i.title}`).join("\n"));

  const got = answers(f.issues);
  for (const a of got) if (a.topic.section) t = setSection(t, a.topic.section, `${a.text}\n\n<!-- from ${a.issue} ("${a.heading}") -->`);

  const open = INTERVIEW_TOPICS.filter((x) => !got.some((a) => a.topic.id === x.id));
  const interview = [
    ...(got.length
      ? ["Answered by the board items — not asked:", ...got.map((a) => `- **${a.topic.label}** — answered by ${a.issue} ("${a.heading}")`), ""]
      : []),
    ...(open.length
      ? [
          "Questions for the business owner — ask one at a time; record each answer under its question as",
          "`→ <answer> (<who>, <date>)`. The intent stays DRAFT until the owner has answered and approved.",
          "",
          ...open.flatMap((x, i) => [
            `- **Q${i + 1} — ${x.label}.** ${x.question}`,
            "  Recommendation: <the agent's recommendation, drafted from the issues before the interview>",
          ]),
        ]
      : ["The board items answer every interview topic; the owner confirms them and approves."]),
  ].join("\n");
  t = setSection(t, "Interview decisions", interview);
  return t.endsWith("\n") ? t : `${t}\n`;
}

// ── performing it ───────────────────────────────────────────────────────────────────────────────────────────

const attempt = async <T>(f: () => Promise<Result<T>>): Promise<Result<T>> => {
  try { return await f(); } catch (e) { return { ok: false, reason: (e as Error)?.message ?? String(e), retryable: false }; }
};
const refuse = (...lines: string[]): IntentOutcome => ({ code: 1, lines });

/** Parse `owner/repo` from an issue URL, for the tracker; null when it is not one. */
const isIssueUrl = (u: string): boolean => /\/issues\/\d+\/?$/.test(u);

export async function createIntent(deps: IntentCreateDeps, input: IntentCreateInput): Promise<IntentOutcome> {
  const log = deps.log ?? (() => {});
  const remote = input.remote ?? "origin";
  const at = (rel: string): string => path.join(input.govClone, ...rel.split("/"));

  // ── 1. The active lifecycle — without one, nothing happens (spec §2.1, X6) ─────────────────────────────────
  const policy = deps.fs.readFile(at(LIFECYCLE_POLICY_PATH));
  if (policy === null) {
    return refuse(
      `No lifecycle adopted: ${LIFECYCLE_POLICY_PATH} is absent — gov intent does nothing.`,
      "  An organization adopts the lifecycle by adding that file through a policy change request (the starter is in policies/active/ of a new governance repo).",
    );
  }
  const step = parseLifecycle(policy).steps.find((s) => s.step === "intent");
  if (!step?.template) {
    return refuse(`${LIFECYCLE_POLICY_PATH} has no readable "Intent (phase: build)" step with a Template line — gov intent does nothing. \`gov doctor\` says what it cannot read.`);
  }
  const template = deps.fs.readFile(at(step.template));
  if (template === null) return refuse(`The lifecycle's intent template ${step.template} is missing — gov intent does nothing.`);

  // ── 2. Where: the project branch, a clean workspace ────────────────────────────────────────────────────────
  const current = deps.vcs.currentBranch(input.govClone);
  const projectBranch = projectBranchUnder(current);
  const board = boardNumberFromBranch(projectBranch);
  if (board === null) return refuse(`'${current}' is not a project branch (expected BRNCH-<n>-…) — run gov intent inside the project.`);
  const project = projectBranch.replace(/^brnch-/i, "PRJ-");
  const dirty = userDirtyPaths(deps.vcs, input.govClone);
  if (dirty.length) return refuse(dirtyRefusal(input.govClone, dirty));
  if (!input.assignee.trim()) return refuse("gov intent needs to know who you are (the tracking issue is assigned to you) — sign in with `gh auth login`.");
  if (input.slug !== undefined && !INTENT_DIR_NAME.test(`01-${input.slug}`)) {
    return refuse(`--slug '${input.slug}' is not a slug: lowercase letters and digits, words joined by dashes (e.g. --slug paging-fix).`);
  }

  // ── 3. The issues — read through the tracker; a closed one is not new work ─────────────────────────────────
  if (input.issueUrls.length === 0) return refuse("Name at least one board issue: gov intent <issue-url>…");
  const issues: Item[] = [];
  for (const url of input.issueUrls) {
    if (!isIssueUrl(url)) return refuse(`'${url}' is not an issue URL.`);
    const it = await attempt(() => deps.tracker.item({ url }));
    if (!it.ok) return refuse(`Could not read ${url} — ${it.reason}`);
    if (it.value.state === "closed") return refuse(`${url} is closed — an intent is drafted from open issues.`);
    issues.push(it.value);
  }
  const sources: SourceIssue[] = issues.map((i) => ({ url: i.ref.url, title: i.title, body: i.body }));
  const title = issues[0]!.title.trim();

  // ── 4. Its number and folder ───────────────────────────────────────────────────────────────────────────────
  const intentsRel = intentsDir(project);
  deps.vcs.fetch(input.govClone, remote, projectBranch); // best-effort: see the intents already landed
  const inFlight = deps.vcs.remoteBranchesMatching(input.govClone, remote, `${projectBranch}.INTENT-*`)
    .map((b) => /\.INTENT-(\d{2})-/.exec(b)?.[1]).filter((x): x is string => x !== undefined);
  let nn = nextIntentNumber(deps.fs.readdir(at(intentsRel)), inFlight);
  while (nn !== null && deps.vcs.localBranchExists(input.govClone, intentBranchFor(projectBranch, nn))) nn = nextIntentNumber([], [nn]);
  if (nn === null) return refuse(`${intentsRel}/ already holds intent 99 — two digits are all an intent number has.`);
  const slug = input.slug ?? intentSlugFrom(title);
  if (!slug) return refuse(`Could not make a folder name from '${title}' — name one with --slug <words-with-dashes>.`);
  const id = `${nn}-${slug}`;
  const dirRel = `${intentsRel}/${id}`;
  const branch = intentBranchFor(projectBranch, nn);
  const repo = { owner: input.githubOrg, name: input.workspaceRepo };
  const label = intentLabel(nn);

  // ── 5. The tracking issue (Q4b) — first, so the draft and the change request can name it ───────────────────
  const marker = `<!-- gov-intent ${JSON.stringify({ project, intent: nn, slug })} -->`;
  const made = await attempt(() => deps.tracker.create(repo, {
    title: `Intent ${nn}: ${title}`,
    assignee: input.assignee,
    body: [
      `Tracks intent ${nn} of ${project} through the lifecycle (intent → spec → plan → build). Every change request for its artifacts traces here.`,
      "",
      `Folder: \`${dirRel}/\``,
      "",
      "Board items:",
      ...sources.map((i) => `- ${i.url} ${i.title}`),
      "",
      marker,
    ].join("\n"),
  }));
  if (!made.ok) return refuse(`Could not create the intent tracking issue in ${repo.owner}/${repo.name} — ${made.reason}`, "  Nothing else was done.");
  const tracking: ItemRef = made.value;
  const problems: string[] = [];
  const onBoard = await attempt(() => deps.tracker.addToProject({ owner: input.githubOrg, number: board }, tracking));
  if (!onBoard.ok) problems.push(`  ⚠ the tracking issue could NOT be added to board #${board} — ${onBoard.reason}`);
  for (const ref of [tracking, ...sources.map((s) => ({ url: s.url }))]) {
    const l = await attempt(() => deps.tracker.label(ref, [label]));
    if (!l.ok) problems.push(`  ⚠ ${ref.url} could NOT be labelled ${label} — ${l.reason}`);
  }

  // ── 6. The draft, on its sub-branch: write, commit, push — undone together if any step fails ───────────────
  const text = draftIntent(template, { nn, title, project, owner: input.assignee, trackingUrl: tracking.url, issues: sources });
  const base = deps.vcs.refExists(input.govClone, `refs/remotes/${remote}/${projectBranch}`) ? `${remote}/${projectBranch}` : projectBranch;
  const tx = new Transaction();
  try {
    tx.step(`branch ${branch}`, () => deps.vcs.checkoutNew(input.govClone, branch, base), () => {
      deps.vcs.checkout(input.govClone, current);
      deps.vcs.branchDelete(input.govClone, branch);
    });
    tx.step(`write ${dirRel}/intent.md`, () => deps.fs.writeFile(at(`${dirRel}/intent.md`), text), () => deps.fs.rm(at(dirRel)));
    deps.vcs.addPath(input.govClone, dirRel);
    deps.vcs.commit(input.govClone, [
      `intent ${nn}: draft ${id} (DRAFT) from ${sources.length} board item(s)`,
      "",
      ...sources.map((s) => `From: ${s.url}`),
      `Traces to: ${tracking.url}`,
      "",
      `Gov-Intent: ${nn}`,
    ].join("\n"));
    tx.step(`push ${branch}`, () => deps.vcs.push(input.govClone, remote, branch, { setUpstream: true }), () => deps.vcs.pushDelete(input.govClone, remote, branch));
    tx.commit();
  } catch (e) {
    const failures = tx.rollback();
    log(`gov intent: ${(e as Error).message}`);
    return refuse(
      `Could not commit and push the draft — ${(e as Error).message}`,
      `  The branch ${branch} was undone${failures.length ? `, except: ${failures.map((f) => f.label).join(", ")}` : ""}.`,
      `  The tracking issue ${tracking.url} exists — run gov intent again, or close it.`,
      ...problems,
    );
  }

  // ── 7. The change request to the project branch, tracing to the tracking issue ─────────────────────────────
  const cr = await attempt(() => deps.host.openChangeRequest({
    repo, head: branch, base: projectBranch,
    title: `Intent ${nn}: ${title} (DRAFT)`,
    body: [
      `Intent ${nn} of ${project}, drafted by \`gov intent\` from ${sources.length} board item(s). Status: DRAFT.`,
      "",
      `Traces to: ${tracking.url}`,
      "",
      `Artifact: \`${dirRel}/intent.md\``,
      "",
      "Board items:",
      ...sources.map((s) => `- ${s.url} ${s.title}`),
      "",
      "Gate G1: the business owner answers the interview questions in \"Interview decisions\", one at a time, and the",
      "answers are committed to this branch. Approval is a person's approving review on this change request, then",
      "merge — gov writes the Status line then. An agent never approves.",
    ].join("\n"),
  }));
  if (!cr.ok) {
    return refuse(
      `Drafted intent ${id} on ${branch} (pushed), but could not open the change request to ${projectBranch} — ${cr.reason}`,
      `  tracking issue: ${tracking.url}`,
      "  Open the change request by hand, naming the tracking issue in its body.",
      ...problems,
    );
  }
  const crInfo = await attempt(() => deps.host.changeRequest(cr.value));
  const crUrl = crInfo.ok ? crInfo.value.url : `${repo.owner}/${repo.name} change request #${cr.value.number}`;
  const said = await attempt(() => deps.tracker.comment(tracking, `Intent ${nn} drafted (DRAFT): ${crUrl}\n\nArtifact: \`${dirRel}/intent.md\` on \`${branch}\`.`));
  if (!said.ok) problems.push(`  ⚠ could not comment the change request on the tracking issue — ${said.reason}`);

  const asked = unansweredTopics(sources).length;
  return {
    code: problems.length ? 1 : 0,
    lines: [
      `Intent ${id} drafted (DRAFT)`,
      `  ${dirRel}/intent.md — ${asked} interview question(s) for the business owner`,
      `  branch: ${branch} (pushed; you are on it)`,
      `  tracking issue: ${tracking.url} — assigned to ${input.assignee}, labelled ${label}${onBoard.ok ? `, on board #${board}` : ""}`,
      `  change request: ${crUrl} → ${projectBranch}`,
      ...problems,
      "Next: the owner interview — one question at a time; commit the answers to this branch. A person approves the change request (G1).",
    ],
  };
}
