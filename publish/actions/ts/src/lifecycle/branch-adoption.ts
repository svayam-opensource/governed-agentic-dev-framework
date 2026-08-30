// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Is a pre-existing project branch our own failed run, or someone's work? (#180)
 *
 * `seed` used to refuse any branch it found: *"Branch 'BRNCH-1-workbench-demo'
 * already exists in …/Workbench — investigate."* The commonest way to meet that
 * message is to have run `seed` yourself, five minutes earlier, and had it fail in
 * a later phase — the branch it pushed in Phase C survives the rollback of the
 * phases after it, and every retry then dies on the branch the previous retry left.
 * The adopter is stuck behind the tool's own leftovers, and told to "investigate".
 *
 * `create.ts` already answers this exact question for repositories, and the
 * reasoning transfers verbatim:
 *
 *   > adopt ONLY what could only have come from a failed run of this command,
 *   > refuse anything else, and never guess between the two.
 *
 * A project branch that could only have come from a failed run points at exactly
 * the base branch's tip: `seed` creates it from the base and pushes it before
 * anything is committed to it. One commit on it and it is somebody's work, and
 * reusing it would be a guess with a real cost.
 *
 * Pure over the refs, so every branch of this decision is decidable in a test.
 */

/** One remote ref, as `git ls-remote --heads` reports it. */
export interface RemoteRef {
  readonly name: string;
  readonly sha: string;
}

export type BranchVerdict =
  /** No such branch. Create it, as normal. */
  | { readonly kind: "create" }
  /** It exists and carries nothing of its own — our own leftover. Reuse it. */
  | { readonly kind: "adopt"; readonly sha: string }
  /** It exists and has moved. Someone's work; refuse, and say what to do. */
  | { readonly kind: "refuse"; readonly detail: string }
  /** The base branch is not there at all — nothing can be cut from it. */
  | { readonly kind: "no-base"; readonly detail: string };

export function classifyProjectBranch(
  refs: readonly RemoteRef[],
  baseBranch: string,
  projectBranch: string,
  repoUrl: string,
): BranchVerdict {
  const base = refs.find((r) => r.name === baseBranch);
  if (!base) {
    return {
      kind: "no-base",
      detail: `Base branch '${baseBranch}' does not exist in ${repoUrl}. ` +
        `Available: ${refs.map((r) => r.name).slice(0, 10).join(", ") || "(none)"}.`,
    };
  }

  const existing = refs.find((r) => r.name === projectBranch);
  if (!existing) return { kind: "create" };

  if (existing.sha === base.sha) return { kind: "adopt", sha: existing.sha };

  return {
    kind: "refuse",
    detail:
      `Branch '${projectBranch}' already exists in ${repoUrl} and has commits of its own.\n` +
      `    That is somebody's work, not a leftover from a failed setup, so gov will not reuse it.\n` +
      `    Either finish or delete that branch, or seed this project under a different board.`,
  };
}

/** Everything that must be true across every repo before the first write. */
export interface RepoPrecondition {
  readonly url: string;
  readonly verdict: BranchVerdict;
}

/**
 * One message for every repo that is not ready, rather than one repo at a time.
 * Failing on the first means the adopter fixes it, re-runs, and meets the second.
 */
export function preconditionFailures(checks: readonly RepoPrecondition[]): readonly string[] {
  return checks
    .filter((c) => c.verdict.kind === "refuse" || c.verdict.kind === "no-base")
    .map((c) => `  • ${(c.verdict as { detail: string }).detail}`);
}

/** The repos whose existing branch we are about to reuse — worth saying out loud. */
export function adoptions(checks: readonly RepoPrecondition[]): readonly string[] {
  return checks.filter((c) => c.verdict.kind === "adopt").map((c) => c.url);
}
