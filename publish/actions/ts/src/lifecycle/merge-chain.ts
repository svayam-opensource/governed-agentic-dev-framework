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
 * The branch a project's repos were cut from, read from `project.yaml`'s `repos[].base_branch`.
 *
 * One base per project, not per repo. A project spanning repos with different bases is a project doing two
 * jobs, and close would have no single order to merge in — so this refuses rather than picking one, and the
 * caller reports it. Absent → the fallback (`defaultCodeBranch`), which is every ordinary project.
 */
export function baseBranchOf(projectYaml: string | null, fallback: string): { readonly base: string } | { readonly error: string } {
  if (!projectYaml) return { base: fallback };
  const declared = [...projectYaml.matchAll(/^\s*base_branch:\s*(\S+)\s*$/gm)]
    .map((m) => m[1]!)
    .filter((b) => b !== "null" && b !== "~");
  const distinct = [...new Set(declared)];
  if (distinct.length > 1) {
    return { error: `repos declare different base branches (${distinct.join(", ")}) — close has no single order to merge in. Split the project, or align the bases.` };
  }
  return { base: distinct[0] ?? fallback };
}
