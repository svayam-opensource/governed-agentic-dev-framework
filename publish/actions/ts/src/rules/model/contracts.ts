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

/** Both stores and the merged catalog, as the DEFAULT branch has them — never the branch under review. */
export interface RuleSet {
  readonly framework: readonly RuleRow[];
  readonly org: readonly RuleRow[];
  /** `org_slug` from org-config.yaml: the org store's scope. */
  readonly orgScope: string;
  readonly catalog: Catalog;
  /** `policies/VERSION`. */
  readonly orgVersion: string;
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
  | { readonly kind: "keep"; readonly id: string }
  | { readonly kind: "revise"; readonly id: string; readonly row: Omit<RuleRow, "id" | "start" | "end"> }
  | { readonly kind: "retire"; readonly id: string }
  | { readonly kind: "add"; readonly row: Omit<RuleRow, "id" | "start" | "end"> };

export interface Proposer {
  /** For each changed section (by sha), the verdicts — asking the owner only where intent is ambiguous (Q18). */
  propose(changedSections: readonly { doc: string; section: string; sha: string; text: string; rows: readonly RuleRow[] }[]): Promise<readonly SectionVerdict[]>;
}

/** W6. What one event looked like when it fired. Shape varies by resource; the runner reads only what its action needs. */
export interface EventContext {
  readonly resource: string;
  readonly event: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CheckVerdict {
  /** `cannot-tell` is reported, never read as a pass. */
  readonly verdict: "pass" | "fail" | "cannot-tell";
  readonly findings: readonly string[];
}

/** W6. `gov check run <GOV-ID>` — the one entry point every rendered binding calls (Q14). */
export interface CheckRunner {
  run(id: string, ctx: EventContext): CheckVerdict;
}

/** W6. Turns one resource's bindings into the files its native automation reads (a workflow, a Jenkins stage). */
export interface BindingRenderer {
  readonly renderer: string;
  render(resource: string, bindings: readonly { readonly id: string; readonly check: CheckBinding }[]): readonly { readonly path: string; readonly text: string }[];
}
