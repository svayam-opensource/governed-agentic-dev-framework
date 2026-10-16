// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * GATE DETECTION for `gov autorun` (spec 03 §3.2): given what was found for one item, the one prep step to run
 * next and the human gate the item then waits at. A run advances each item EXACTLY ONE stage; running it again
 * with nothing approved yields `next: null` everywhere, which is what makes re-runs idempotent.
 *
 * Never a merge, a close or a signal send — those are people's acts (§3.4). Pure.
 */

/** What an artifact's file + change request say about it. `absent` = no file on the project branch. */
export type ArtifactState = "absent" | "draft" | "approved" | "stale";

export interface TaskIssue {
  readonly issue: string;
  /** The task's build change request: none yet, open (waiting at G4), or merged. */
  readonly cr: "none" | "open" | "merged";
}

export type ItemFacts =
  | { readonly kind: "issue"; readonly id: string }
  | {
      readonly kind: "intent";
      readonly id: string;
      readonly intent: ArtifactState;
      readonly spec: ArtifactState;
      readonly plan: ArtifactState;
      readonly build: ArtifactState;
      /** An open, unmerged change request for one of this intent's artifacts. */
      readonly openDraftCr: { readonly artifact: "intent" | "spec" | "plan" | "build"; readonly url: string } | null;
      readonly specChangedAfterPlanApproval: boolean;
      /** Tasks the approved plan lists. */
      readonly planTasks: number;
      /** Task issues that exist for the plan. */
      readonly taskIssues: readonly TaskIssue[];
    };

export type NextStep =
  | "draft-intent" | "draft-spec" | "draft-plan" | "mark-plan-stale" | "create-task-issues" | "build-task" | "draft-build";

export type Gate = "G1" | "G2" | "G3" | "G4" | "G4b";
export type Stage = "intake" | "intent" | "spec" | "plan" | "build" | "built";

export interface Classification {
  readonly id: string;
  readonly stage: Stage;
  /** The prep step this run performs, or null: nothing to do until a person acts. */
  readonly next: NextStep | null;
  /** The gate the item waits at after `next` (or now, when `next` is null). null = no gate (continues / done). */
  readonly gate: Gate | null;
  /** For build-task: the task issue to work. */
  readonly target?: string;
  /** Plain words for the report: who or what the item waits on. */
  readonly waitingOn: string;
}

const GATE_OF: Readonly<Record<"intent" | "spec" | "plan" | "build", Gate>> = { intent: "G1", spec: "G2", plan: "G3", build: "G4b" };
const WHO: Readonly<Record<Gate, string>> = {
  G1: "the business owner (intent interview + approval)",
  G2: "the project owner (spec approval)",
  G3: "the project owner (plan approval)",
  G4: "the code owner (review + merge of the task CR)",
  G4b: "the project owner (build.md approval)",
};

export function classify(f: ItemFacts): Classification {
  const at = (stage: Stage, next: NextStep | null, gate: Gate | null, extra: { target?: string; waitingOn?: string } = {}): Classification => ({
    id: f.id, stage, next, gate,
    ...(extra.target !== undefined ? { target: extra.target } : {}),
    waitingOn: extra.waitingOn ?? (gate ? WHO[gate] : next ? "autorun (next run continues)" : "nobody — built; release is gov-cicd's"),
  });

  if (f.kind === "issue") return at("intake", "draft-intent", "G1");

  // Row 7 first: an open draft CR means a person has something to review — nothing else happens to this item.
  if (f.openDraftCr) {
    const g = GATE_OF[f.openDraftCr.artifact];
    const stage: Stage = f.openDraftCr.artifact === "intent" ? "intake" : f.openDraftCr.artifact === "spec" ? "intent" : f.openDraftCr.artifact === "plan" ? "spec" : "build";
    return at(stage, null, g, { waitingOn: `${WHO[g]} — review ${f.openDraftCr.url}` });
  }

  if (f.intent !== "approved") return at("intake", null, "G1");
  if (f.spec === "absent") return at("intent", "draft-spec", "G2");
  if (f.spec !== "approved") return at("intent", null, "G2");

  // Row 8: the spec moved under an approved plan.
  if (f.plan === "approved" && f.specChangedAfterPlanApproval) return at("spec", "mark-plan-stale", "G3");
  if (f.plan === "absent" || f.plan === "stale") return at("spec", "draft-plan", "G3");
  if (f.plan !== "approved") return at("spec", null, "G3");

  if (f.taskIssues.length < f.planTasks) return at("plan", "create-task-issues", null);

  const todo = f.taskIssues.find((t) => t.cr === "none");
  if (todo) return at("build", "build-task", "G4", { target: todo.issue });
  if (f.taskIssues.some((t) => t.cr === "open")) return at("build", null, "G4");

  if (f.build === "absent") return at("build", "draft-build", "G4b");
  if (f.build !== "approved") return at("build", null, "G4b");
  return at("built", null, null);
}
