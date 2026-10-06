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
import { POLICY_OWNER } from "./policy-actions.js";

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
