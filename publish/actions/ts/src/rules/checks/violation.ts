// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * VIOLATION RECORDS AND UNDO (rule-model-design.md Q15; W6 slice 2).
 *
 * A check on an OBSERVE event fails after the fact: the push has landed, the issue is closed. Nothing can refuse
 * it any more, so gov opens a RECORD — a GitHub issue labelled `gov-violation`, assigned to the Policy Owner — and,
 * where the catalog declares one for that event, runs its UNDO (an issue closed → reopen). An event with no undo,
 * or undo `none`, is report only: reversing some things (a push to the default branch others have pulled) does
 * more harm than the violation.
 *
 * A GATE fail never opens a record: the gate already refused, and the person who hit it saw why. A `pass` or a
 * `cannot-tell` is not a violation — `cannot-tell` is reported where it happened, not filed against anyone.
 *
 * {@link violationFor} is pure. {@link recordViolation} drives two injected ports — the issue tracker and the undo —
 * and says what each did. Undo runs first, so the record can say whether it worked.
 */
import type { RuleRow } from "../model/rule-row.js";
import type { CheckVerdict, EventContext, RuleSet } from "../model/contracts.js";
import { handleKey } from "./payload.js";
import { POLICY_OWNER, SELF_MERGED_SOLO, soloMode } from "./policy-actions.js";
import type { RedMerge } from "./gh-actions.js";

export const VIOLATION_LABEL = "gov-violation";
const TITLE_MAX = 100;

export interface ViolationIssue {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  /** GitHub handles, no `@`. Empty when the Policy Owner role is vacant. */
  readonly assignees: readonly string[];
}

export interface ViolationInput {
  readonly row: RuleRow;
  readonly ctx: EventContext;
  readonly verdict: CheckVerdict;
  readonly rules: RuleSet;
  /** The CI run that found it (GitHub: `$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID`). */
  readonly runUrl?: string;
}

export type UndoState = "none" | "done" | "failed" | "unavailable";

export type Violation =
  | { readonly kind: "none"; readonly why: string }
  | { readonly kind: "record"; readonly issue: ViolationIssue; readonly undo: string | null };

export interface ViolationPorts {
  /** Open the issue; its number, or null when the tracker refused. */
  openIssue(issue: ViolationIssue): { readonly number: number } | null;
  /** Run the catalog-declared undo (e.g. `reopen`) for this event; true when it took. Absent → cannot undo here. */
  undo?(kind: string, ctx: EventContext): boolean;
}

export interface ViolationOutcome {
  /** The issue number opened, or null (no record due, or the tracker refused). */
  readonly issue: number | null;
  readonly undo: UndoState;
  readonly lines: readonly string[];
}

/** The expectation, cut to fit a title at a word boundary. */
function shortExpectation(text: string, room: number): string {
  const t = text.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  if (t.length <= room) return t;
  const cut = t.slice(0, room - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > room / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, "")}…`;
}

const undoLine = (undo: string | null, state: UndoState | "pending"): string => {
  if (undo === null) return "none declared for this event — report only";
  if (state === "pending") return `${undo} — will run`;
  if (state === "unavailable") return `${undo} — not available here, so not done; do it by hand`;
  return `${undo} — ${state}`;
};

function issueFor(input: ViolationInput, undo: string | null, state: UndoState | "pending"): ViolationIssue {
  const { row, ctx, verdict, rules, runUrl } = input;
  const owner = rules.roles?.[POLICY_OWNER];
  const assignee = owner ? handleKey(owner) : "";
  const prefix = `gov-violation: ${row.id} `;
  const body = [
    `A check on an event that had already happened found a violation, so it could not be refused — this record is the response (Q15).`,
    "",
    `**Rule:** ${row.id} (${row.level})`,
    `**Expectation:** ${row.expectation}`,
    `**Where:** ${ctx.resource} · ${ctx.event}`,
    `**Run:** ${runUrl ?? "(no run link)"}`,
    `**Undo:** ${undoLine(undo, state)}`,
    ...(assignee ? [] : ["", `**The ${POLICY_OWNER} role is vacant**, so this record is unassigned. Name a holder in policies/governance.yaml (policy_owner.github).`]),
    "",
    "### Findings",
    ...(verdict.findings.length ? verdict.findings.map((f) => `- ${f}`) : ["- (the check reported no detail)"]),
    "",
    `The ${POLICY_OWNER} reviews this record and closes it with the outcome.`,
  ].join("\n");
  return {
    title: prefix + shortExpectation(row.expectation, TITLE_MAX - prefix.length),
    body,
    labels: [VIOLATION_LABEL],
    assignees: assignee ? [assignee] : [],
  };
}

/** Is a record due, and what would it say? Pure. */
export function violationFor(input: ViolationInput): Violation {
  if (input.verdict.verdict !== "fail") return { kind: "none", why: `the check did not fail (${input.verdict.verdict})` };
  const res = input.rules.catalog.resources.find((r) => r.id === input.ctx.resource);
  const ev = res?.events.find((e) => e.name === input.ctx.event);
  if (!ev) return { kind: "none", why: `${input.ctx.resource} · ${input.ctx.event} is not in the catalog` };
  if (ev.mode === "gate") return { kind: "none", why: "a gate refused it — the person who hit it saw why" };
  const undo = ev.undo && ev.undo !== "none" ? ev.undo : null;
  return { kind: "record", issue: issueFor(input, undo, "pending"), undo };
}

/** Undo (when declared), then open the record saying how the undo went. */
export function recordViolation(input: ViolationInput, ports: ViolationPorts): ViolationOutcome {
  const v = violationFor(input);
  if (v.kind === "none") return { issue: null, undo: "none", lines: [`no violation record: ${v.why}`] };
  let state: UndoState = "none";
  if (v.undo !== null) state = ports.undo ? (ports.undo(v.undo, input.ctx) ? "done" : "failed") : "unavailable";
  const issue = issueFor(input, v.undo, state);
  const opened = ports.openIssue(issue);
  return {
    issue: opened?.number ?? null,
    undo: state,
    lines: [
      opened ? `opened violation record #${opened.number}: ${issue.title}` : `could not open the violation record: ${issue.title}`,
      `undo: ${undoLine(v.undo, state)}`,
    ],
  };
}

// ── SOFT MERGE WITH RED CHECKS (Policy Owner, 2026-10-07) ────────────────────────────────────────────────────
//
// Under soft posture gov's pull-request checks report but nothing waits for them, so a PR can merge with one red.
// The push to the default branch finds it (gh-actions.ts redMerges) and opens ONE record per PR, naming the PR and
// each failed rule. Never two for the same PR: the record carries a marker, and an open record with it is enough.
// gov looks under every posture (Q43 A): where main is protected the checks were required and nothing is found, but
// hard posture on a repo GitHub will not protect (private, GitHub Free) can still merge red.

/** The line every red-merge record carries, so a re-run finds it. */
export const redMergeMarker = (pr: number): string => `<!-- gov-red-merge pr=${pr} -->`;

/** The record for one red merge. Pure. */
export function redMergeIssue(m: RedMerge, rules: RuleSet, runUrl?: string): ViolationIssue {
  const owner = rules.roles?.[POLICY_OWNER];
  const assignee = owner ? handleKey(owner) : "";
  const ids = [...new Set(m.failed.map((f) => f.rule))];
  let title = `gov-violation: PR #${m.pr} merged with failing gov checks (${ids.join(", ")})`;
  if (title.length > TITLE_MAX) title = `gov-violation: PR #${m.pr} merged with ${ids.length} failing gov checks`;
  const body = [
    `Pull request #${m.pr} merged with these checks failing. Nothing on the default branch required them — soft posture, or a repository GitHub will not protect on this plan — so the merge went ahead while a check was red; this record is how the merge is detected (Q15, Q43).`,
    "",
    `**Pull request:** #${m.pr} (head ${m.headSha.slice(0, 7)})`,
    `**Run:** ${runUrl ?? "(no run link)"}`,
    ...(assignee ? [] : ["", `**The ${POLICY_OWNER} role is vacant**, so this record is unassigned. Name a holder in policies/governance.yaml (policy_owner.github).`]),
    "",
    "### Failed checks",
    ...m.failed.map((f) => `- ${f.rule} · ${f.event} — ${f.summary.trim() || "(the check run gave no summary; open the PR's checks to read it)"}`),
    "",
    `The ${POLICY_OWNER} reviews this record and closes it with the outcome: what the failed rules needed, and whether it has been put right.`,
    "",
    redMergeMarker(m.pr),
  ].join("\n");
  return { title, body, labels: [VIOLATION_LABEL], assignees: assignee ? [assignee] : [] };
}

export interface RedMergePorts {
  openIssue(issue: ViolationIssue): { readonly number: number } | null;
  /** The open record for this PR (`found`: its number, or null for none) — or null when the tracker could not be searched. */
  findOpenRecord(pr: number): { readonly found: number | null } | null;
  /** Solo mode's banner and its self-merge entries (Q45 C). Absent → a solo-mode failure is recorded as a violation. */
  readonly solo?: SoloModePorts;
}

/**
 * One record per red merge, unless one is already open for that PR.
 *
 * SOLO MODE (Policy Owner ruling Q45 C, 2026-11-23). Under soft posture, a red check that was solo mode — nobody but
 * the author held any role or alternate, so nobody else could approve — is not a violation: the merge is recorded
 * honestly as "self-merged: no second person", an EVIDENCE entry on the one open solo-mode issue (the banner), never
 * a `gov-violation` record. Any OTHER red gov check on the same PR still opens the violation record, naming those.
 * Under hard posture nothing changes: every red check is a violation.
 */
export function recordRedMerges(merges: readonly RedMerge[], rules: RuleSet, ports: RedMergePorts, runUrl?: string): { readonly opened: readonly number[]; readonly selfMerges: readonly number[]; readonly lines: readonly string[] } {
  const opened: number[] = [];
  const selfMerges: number[] = [];
  const lines: string[] = [];
  const soft = rules.posture !== "hard";
  for (const whole of merges) {
    const solo = soft && ports.solo ? whole.failed.filter((f) => f.solo) : [];
    if (solo.length) {
      const r = recordSelfMerge(whole, rules, ports.solo!, runUrl);
      lines.push(...r.lines);
      if (r.recorded) selfMerges.push(whole.pr);
    }
    const m: RedMerge = { ...whole, failed: whole.failed.filter((f) => !solo.includes(f)) };
    if (!m.failed.length) continue;
    const failed = m.failed.map((f) => f.rule).join(", ");
    const existing = ports.findOpenRecord(m.pr);
    if (existing === null) {
      lines.push(`PR #${m.pr} merged with ${failed} failing, but gov could not search the open gov-violation records, so it opened none rather than risk a second — re-run this job.`);
      continue;
    }
    if (existing.found !== null) { lines.push(`PR #${m.pr} merged with ${failed} failing — #${existing.found} already records PR #${m.pr}.`); continue; }
    const issue = redMergeIssue(m, rules, runUrl);
    const o = ports.openIssue(issue);
    if (o) { opened.push(o.number); lines.push(`opened violation record #${o.number}: ${issue.title}`); }
    else lines.push(`could not open the violation record: ${issue.title}`);
  }
  return { opened, selfMerges, lines };
}

// ── SOLO MODE (Policy Owner ruling Q45 C, 2026-11-23) ───────────────────────────────────────────────────────────
//
// ONE open issue is the banner: it says the organization is in solo mode, and each self-merge is an entry on it — a
// comment naming the PR, never a record of its own. It is labelled `gov-solo-mode`, NOT `gov-violation`, so a service
// that counts violations (gov web) does not count a self-merge as one. It closes itself on the first push after a
// second person holds a role or an alternate.

/** The banner's label. Never {@link VIOLATION_LABEL}: a self-merge is evidence, not a violation. */
export const SOLO_LABEL = "gov-solo-mode";
/** The line the banner carries, so a re-run finds it among the open issues with its label. */
export const SOLO_BANNER_MARKER = "<!-- gov-solo-mode -->";
/** The line each self-merge entry carries, so a re-run does not record the same PR twice. */
export const selfMergeMarker = (pr: number): string => `<!-- gov-self-merge pr=${pr} -->`;

export interface SoloModePorts {
  /** The open banner (`found`: its number, or null for none) — or null when the tracker could not be searched. */
  findBanner(): { readonly found: number | null } | null;
  /** Open the banner; its number, or null when the tracker refused. */
  openBanner(issue: ViolationIssue): { readonly number: number } | null;
  /** The PRs the banner already records (from its entries' markers), or null when they could not be read. */
  recordedPrs(banner: number): readonly number[] | null;
  /** Add an entry (a comment) to the banner. True when it took. */
  addEntry(banner: number, body: string): boolean;
  /** Say why, then close the banner. True when it closed. */
  closeBanner(banner: number, body: string): boolean;
}

/** The banner. Pure. */
export function soloBannerIssue(rules: RuleSet): ViolationIssue {
  const owner = rules.roles?.[POLICY_OWNER];
  const assignee = owner ? handleKey(owner) : "";
  const body = [
    `This organization is in **solo mode**: nobody other than ${assignee ? `@${assignee}` : "one person"} holds a role or is a role's alternate, so nobody else can approve a change. Nobody approves their own work, so every change is still checked and still fails that check — but under soft posture a merge past it is recorded honestly, as **${SELF_MERGED_SOLO}**, and not as a violation.`,
    "",
    "Each self-merge is an entry below: the pull request, its head, and the run that found it.",
    "",
    `**To end solo mode**, the ${POLICY_OWNER} names a second person by pull request — a Check Owner or an alternate in \`policies/governance.yaml\`, or a holder or alternate in the role list (\`policies/common/authorized-representatives.md\`). gov closes this issue on the next push after that merges.`,
    "",
    SOLO_BANNER_MARKER,
  ].join("\n");
  return { title: "gov: solo mode — self-merges with no second person to approve", body, labels: [SOLO_LABEL], assignees: assignee ? [assignee] : [] };
}

/** One self-merge entry. Pure. */
export function selfMergeEntry(m: RedMerge, runUrl?: string): string {
  return [
    `**PR #${m.pr} — ${SELF_MERGED_SOLO}** (head ${m.headSha.slice(0, 7)}). It merged with no approval because nobody but its author could give one.`,
    "",
    ...m.failed.filter((f) => f.solo).map((f) => `- ${f.rule} · ${f.event} — solo mode`),
    `- run: ${runUrl ?? "(no run link)"}`,
    "",
    selfMergeMarker(m.pr),
  ].join("\n");
}

/** Record one self-merge on the banner, opening the banner first if none is open. Never twice for one PR. */
function recordSelfMerge(m: RedMerge, rules: RuleSet, ports: SoloModePorts, runUrl?: string): { recorded: boolean; lines: string[] } {
  const found = ports.findBanner();
  if (found === null) return { recorded: false, lines: [`PR #${m.pr} was ${SELF_MERGED_SOLO}, but gov could not search for the open solo-mode issue, so it recorded nothing rather than risk a second — re-run this job.`] };
  const lines: string[] = [];
  let banner = found.found;
  if (banner === null) {
    const o = ports.openBanner(soloBannerIssue(rules));
    if (!o) return { recorded: false, lines: [`PR #${m.pr} was ${SELF_MERGED_SOLO}, but gov could not open the solo-mode issue to record it.`] };
    banner = o.number;
    lines.push(`opened solo-mode issue #${banner}`);
  }
  const done = ports.recordedPrs(banner);
  if (done === null) return { recorded: false, lines: [...lines, `PR #${m.pr} was ${SELF_MERGED_SOLO}, but gov could not read solo-mode issue #${banner}'s entries, so it added none rather than risk a second — re-run this job.`] };
  if (done.includes(m.pr)) return { recorded: false, lines: [...lines, `PR #${m.pr} was ${SELF_MERGED_SOLO} — solo-mode issue #${banner} already records it.`] };
  if (!ports.addEntry(banner, selfMergeEntry(m, runUrl))) return { recorded: false, lines: [...lines, `could not add PR #${m.pr}'s self-merge to solo-mode issue #${banner}.`] };
  return { recorded: true, lines: [...lines, `recorded PR #${m.pr} as ${SELF_MERGED_SOLO} on solo-mode issue #${banner} — evidence, not a violation.`] };
}

/**
 * SOLO MODE ENDS when a second person holds a role or an alternate: close the open banner, saying so. Nothing to do
 * while it lasts, or when there is no banner. Run on every push to the default branch, from the rules just merged.
 */
export function closeSoloBanner(rules: RuleSet, ports: Pick<SoloModePorts, "findBanner" | "closeBanner">): readonly string[] {
  if (soloMode(rules)) return [];
  const found = ports.findBanner();
  if (found === null || found.found === null) return [];
  const n = found.found;
  const named = [...new Set([...Object.values(rules.roles ?? {}), ...Object.values(rules.alternates ?? {})].map(handleKey).filter(Boolean))].sort().map((h) => `@${h}`);
  const why = `Solo mode has ended: a second person now holds a role or is an alternate (named: ${named.join(", ")}). From here on a change is approved by someone other than its author, and a merge without that approval is a violation again.`;
  return [ports.closeBanner(n, why) ? `closed solo-mode issue #${n}: a second person now holds a role or alternate` : `  ! could not close solo-mode issue #${n} — close it by hand`];
}
