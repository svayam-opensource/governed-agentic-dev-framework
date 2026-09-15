// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHERE A PROJECT BRANCH MUST LAND BEFORE IT MAY BE DELETED.
 *
 * An ordinary project is cut from `dev` and closes into `dev`. A HOTFIX is cut from the env branch that
 * carries the defect — `uat`, or the release branch for a production fix — because `dev` is not always
 * releasable and a branch cut from it would ship everything else on `dev` with the fix
 * (adr-hotfix-release-line, PRJ-43).
 *
 * That gives a hotfix two obligations rather than one:
 *
 *   · **ship** — it must reach the branch it was cut from, or production is never fixed;
 *   · **protect** — it must reach every branch *below* that, or the next ordinary release silently reverts
 *     the fix in production and nothing notices.
 *
 * `close` already enforces the second half structurally for ordinary projects: it merges, and only then
 * archives, so a branch cannot be deleted without having reached its target. What was missing is that the
 * target was a CONSTANT (`defaultCodeBranch`) rather than a chain — so a hotfix reached the branch that
 * must not regress and never reached the branch that needed it.
 *
 * This module is the chain, and nothing else. It performs no git.
 */

/**
 * The estate's env branches, HIGHEST first — release branch down to the day-to-day branch.
 *
 * `middle` is the envs between them (e.g. `["uat"]`, or `["uat", "sit"]` highest-first). An estate that
 * declares none gets `[defaultBranch, defaultCodeBranch]`, which is correct for the two-branch case and is
 * what every adopter has before they configure anything.
 *
 * Deliberately a LIST rather than a graph: `close` needs an order to merge in, not a promotion topology. The
 * deploy side's `promotion:` graph answers a different question (what may advance into what, with fan-out)
 * and belongs to a different client.
 */
export function envLadder(
  config: { readonly defaultBranch: string; readonly defaultCodeBranch: string },
  middle: readonly string[] = [],
): string[] {
  // The ENDS are fixed; a middle rung naming one of them is redundant, not a reordering. Deduping by
  // first-seen would have moved `dev` up the ladder, and close would then merge into it before the branches
  // above — the exact inversion of ship-first-then-protect.
  const ends = [config.defaultBranch, config.defaultCodeBranch].filter(Boolean);
  const seen = new Set<string>();
  const rungs = middle.filter((b) => b && !ends.includes(b) && !seen.has(b) && seen.add(b) !== undefined);
  return [...new Set([config.defaultBranch, ...rungs, config.defaultCodeBranch].filter(Boolean))];
}

/**
 * The branches a project cut from `base` must land in, IN THE ORDER THEY MUST BE DONE: the base itself,
 * then every branch below it.
 *
 * **Ship first, then protect.** If a lower leg conflicts, the fix has already reached the branch that needed
 * it and the project branch survives for someone to resolve the rest — which is the right way round. The
 * reverse order would leave production unfixed while the merge nobody is waiting for blocks the close.
 *
 * A base that is not on the ladder yields just itself: an estate can cut a project from a branch this
 * function has never heard of, and the honest answer is "land it back where it came from" rather than a
 * guess about what is below it.
 */
export function mergeChain(base: string, ladder: readonly string[]): string[] {
  const at = ladder.indexOf(base);
  return at === -1 ? [base] : ladder.slice(at);
}

/**
 * The branch a project must land in, and whether that was RECORDED or merely ASSUMED.
 *
 * This used to read `repos[].base_branch` out of `project.yaml`. That file is not written any more —
 * GitHub is the source of truth — so the read always missed and every project silently fell back to
 * `defaultCodeBranch`. Invisible for an ordinary project, which is cut from that branch anyway, and
 * fatal for the only case this module exists to serve: a hotfix cut from `uat` got the chain
 * `["dev"]`, never merged into `uat`, and so dropped the *ship* leg. See framework todo, 2026-09-15.
 *
 * The base is now recorded in the project's anchor-issue body at seed (`anchor.ts`), which is where
 * the board number already lives. It has to be recorded rather than derived, because git cannot
 * answer the question afterwards: it knows the commit a branch descends from, not the branch name
 * someone typed, and two env branches sitting on the same commit are indistinguishable by ancestry.
 *
 * `assumed` is returned rather than hidden so the caller can say which it used. A fallback that
 * reads identically to a recorded value is the defect this replaces.
 */
export function baseBranchFor(recorded: string | null | undefined, fallback: string): { readonly base: string; readonly assumed: boolean } {
  const base = (recorded ?? "").trim();
  return base ? { base, assumed: false } : { base: fallback, assumed: true };
}
