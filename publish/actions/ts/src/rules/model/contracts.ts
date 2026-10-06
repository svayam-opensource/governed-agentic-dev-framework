// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SEAMS BETWEEN THE WORKSTREAMS (rule-model-design.md, execution plan P1; 2026-10-06).
 *
 * Types only. Each workstream implements one of these and consumes the others, so they can be built in parallel
 * against a fixed shape. A worker that needs one to change brings that back to the orchestrator rather than
 * editing it — two workers bending the same seam in two directions is how the parallel plan fails.
 *
 *   W1 store & ids ........ RuleStoreReader, IdIssuer
 *   W4 proposer ........... Proposer
 *   W6 check engine ....... CheckRunner, BindingRenderer
 *   W7 cues / W8 rule map . consume RuleSet + classifyRow (catalog.ts)
 */
import type { RuleRow } from "./rule-row.js";
import type { Catalog, CheckBinding } from "./catalog.js";
import type { ChangedFile } from "../diff-check.js";
import type { WorkspaceView } from "../verb-gate.js";

/**
 * Who approves a change to one SECTION of a policy (Policy Owner, W2-Q8, 2026-10-06). Written by the Policy Owner in
 * plain English in the policy itself ("Section 4 is owned by the Data Owner"), extracted by propose into
 * `policies/ownership.yaml`. Not a rule row: it routes approval, it binds no actor.
 *
 * A changed section with no row here falls back to the Policy Owner; a change to this file itself always needs the
 * Policy Owner, so nobody can hand a section to themselves.
 */
export interface SectionOwnership {
  readonly doc: string;
  readonly section: string;
  /** A role name from the org's role list (`policies/authorized-representatives.md`), e.g. "Data Owner". */
  readonly role: string;
  /**
   * The sha of the section the ownership STATEMENT is written in (integration, 2026-10-06) — not of the section it
   * owns, which may be another. When that sentence is deleted or changed, its section's sha moves and propose drops
   * the row; if the sentence is still there, the re-run extracts it again at the new sha.
   */
  readonly sha: string;
}

/** Both stores and the merged catalog, as the DEFAULT branch has them — never the branch under review. */
export interface RuleSet {
  readonly framework: readonly RuleRow[];
  readonly org: readonly RuleRow[];
  /** `org_slug` from org-config.yaml: the org store's scope. */
  readonly orgScope: string;
  readonly catalog: Catalog;
  /** `policies/VERSION`. */
  readonly orgVersion: string;
  /** `policies/ownership.yaml`. Absent or empty → every section is the Policy Owner's. */
  readonly ownership?: readonly SectionOwnership[];
  /** Role → GitHub handle, from the org's role list and org-config (Policy Owner, Check Owner always present). */
  readonly roles?: Readonly<Record<string, string>>;
}

/** W1. Reads the stores at a git ref; `null` means it could not tell, which is never the same as "no rules". */
export interface RuleStoreReader {
  load(ref: string): RuleSet | null;
}

/** W1. The only thing that issues GOV ids (see gov-id.ts). */
export interface IdIssuer {
  next(scope: string): string;
}

/** W4. One section's verdicts from the interview (Q17): existing rows classified, new rows without ids. */
export type SectionVerdict =
  /**
   * Keep: intent unchanged (Q17). `sha` is the section's current sha; when it differs from the row's, the row's
   * `source.sha` is refreshed IN PLACE — same row, same start, no new revision. The only in-place edit a store allows.
   */
  | { readonly kind: "keep"; readonly id: string; readonly sha?: string }
  | { readonly kind: "revise"; readonly id: string; readonly row: Omit<RuleRow, "id" | "start" | "end"> }
  | { readonly kind: "retire"; readonly id: string }
  | { readonly kind: "add"; readonly row: Omit<RuleRow, "id" | "start" | "end"> };

/** W4's answer for a batch of sections (integration, 2026-10-06): nothing the interview settled is dropped. */
export interface Proposal {
  readonly verdicts: readonly SectionVerdict[];
  /** Ownership sentences found in the sections, each carrying the sha of the section it is written in. */
  readonly ownership: readonly SectionOwnership[];
  /** The interview's questions and the owner's answers, by the section they were asked about (Q18). */
  readonly qa: readonly { readonly section: string; readonly q: string; readonly a: string }[];
}

export interface Proposer {
  /** For each changed section (by sha), the verdicts — asking the owner only where intent is ambiguous (Q18). */
  propose(changedSections: readonly { doc: string; section: string; sha: string; text: string; rows: readonly RuleRow[] }[]): Promise<Proposal>;
}

/** One test's outcome, as a `test-suite` action reads it. */
export interface TestResult {
  readonly title: string;
  readonly state: "passed" | "failed" | "pending";
}

/**
 * What an event carried. Pinned after W6 (2026-10-06): each field belongs to one kind of event, and an action that
 * finds none of the ones it needs reports `cannot-tell` — never a pass.
 */
export interface EventPayload {
  /** A changeset (pull_request, push): the files, with the lines each ADDED. */
  readonly changed?: readonly ChangedFile[];
  /** The branch under review, for a naming check on it. */
  readonly branch?: string;
  /** A gov verb about to run: what the gate may look at (read-only by construction). */
  readonly workspace?: WorkspaceView;
  /** A test run, for `gov-builtin/test-suite`. */
  readonly tests?: readonly TestResult[];
  // ── pinned after W6 slice 2 (2026-10-06) ──
  /** push: was it forced? (`gov-builtin/forbid-forced-push`) */
  readonly forced?: boolean;
  /** push: the pushed commit shas (`gh-action/landed-by-pr`). */
  readonly commits?: readonly string[];
  /** The repository's default branch, resolving `$default` in a binding's branch patterns. */
  readonly defaultBranch?: string;
  /** pull_request: each changed file's text at the BASE, null when absent there (section-owner-approval). */
  readonly baseTexts?: Readonly<Record<string, string | null>>;
  /** pull_request: handles with an APPROVED review on the head (section-owner-approval). */
  readonly approvals?: readonly string[];
  /** pull_request: the author's handle — never an approver of their own change (section-owner-approval). */
  readonly author?: string;
}

/** W6. What one event looked like when it fired. */
export interface EventContext {
  readonly resource: string;
  readonly event: string;
  readonly payload: EventPayload;
}

export interface CheckVerdict {
  /** `cannot-tell` is reported, never read as a pass. */
  readonly verdict: "pass" | "fail" | "cannot-tell";
  readonly findings: readonly string[];
  /** Bare handles the workflow should request a review from (section-owner-approval). */
  readonly requestReview?: readonly string[];
}

/**
 * W6. `gov check run <GOV-ID> --resource <r> --event <e> [--gov-home <path>] [--repo-dir <path>]` — the one entry
 * point every rendered binding calls (Q14). `--resource` is needed because one repository hosts several resources
 * (the gov repo is `vcs.gov-repo` and where `pms.issue` events fire).
 *
 *   --gov-home  The governance repository's working tree, whose DEFAULT branch the rules are read from. Default:
 *               the current directory. A code repo's workflow checks the gov repo out beside its own and passes it.
 *   --repo-dir  The repository the event happened in, whose changeset is read — relative to `--gov-home`.
 *               Default: the governance repository itself.
 */
export interface CheckRunner {
  run(id: string, ctx: EventContext): CheckVerdict;
}

/**
 * W6. Turns ONE REPOSITORY's bindings into the files its native automation reads (a workflow, a Jenkins stage).
 * Per repository, not per resource (changed after W6, 2026-10-06): a repo hosts several resources and gets one file.
 * The caller decides which bindings belong to which repository.
 */
export interface BindingRenderer {
  readonly renderer: string;
  render(bindings: readonly { readonly id: string; readonly check: CheckBinding }[]): readonly { readonly path: string; readonly text: string }[];
}
