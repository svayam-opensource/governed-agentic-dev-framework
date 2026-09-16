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

/** `owner/repo` from a URL, or the URL itself when it is not a GitHub one. */
function repoSlugFromUrlSafe(url: string): string {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : url;
}

/** One remote ref, as `git ls-remote --heads` reports it. */
export interface RemoteRef {
  readonly name: string;
  readonly sha: string;
}

/**
 * What the remote says about the adopter's standing in a repo (#194).
 *
 * Write access is its OWN fact. Reporting "base branch 'dev' does not exist" to
 * someone who could not have pushed to that repo anyway answers a question they
 * were not going to reach, and hides the one that matters.
 */
export interface RepoStanding {
  readonly canPush: boolean;
  /** A fork of this repo under the adopter's own org, if there is one. */
  readonly forkUnderOrg: string | null;
}

export type BranchVerdict =
  /** No such branch. Create it, as normal. */
  | { readonly kind: "create" }
  /** It exists and carries nothing of its own — our own leftover. Reuse it. */
  | { readonly kind: "adopt"; readonly sha: string }
  /** It exists and has moved. Someone's work; refuse, and say what to do. */
  | { readonly kind: "refuse"; readonly detail: string; readonly suggestOverride?: { readonly from: string; readonly to: string } }
  /** The base branch is not there at all — nothing can be cut from it. */
  | { readonly kind: "no-base"; readonly detail: string };

export function classifyProjectBranch(
  refs: readonly RemoteRef[],
  baseBranch: string,
  projectBranch: string,
  repoUrl: string,
  standing?: RepoStanding,
): BranchVerdict {
  // ACCESS FIRST. Everything below assumes the adopter could write here, and
  // saying "no such branch" to someone who cannot push is answering the second
  // question while skipping the first.
  if (standing && !standing.canPush) {
    const suggestion = standing.forkUnderOrg
      ? `\n    You do have a fork of it: ${standing.forkUnderOrg}.\n` +
        `    Work happens where you can write. Map it in org-config.yaml:\n` +
        `      repo_overrides:\n` +
        `        ${repoSlugFromUrlSafe(repoUrl)}: ${standing.forkUnderOrg}\n` +
        `    The board can go on linking the upstream issue — only the branch moves.`
      : `\n    Ask for write access, or fork it and map the fork in org-config.yaml under repo_overrides.`;
    return {
      kind: "refuse",
      detail: `You do not have write access to ${repoUrl}, so gov cannot create a project branch there.${suggestion}`,
      // A fix we can OFFER rather than describe. See seed: the adopter is asked, and
      // the answer is written to org-config.yaml — declared, but not hand-copied
      // from a message the tool had already worked out.
      ...(standing.forkUnderOrg ? { suggestOverride: { from: repoSlugFromUrlSafe(repoUrl), to: standing.forkUnderOrg } } : {}),
    };
  }

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

/** Overrides the preflight can propose, because it found the fork itself. */
export function suggestedOverrides(checks: readonly RepoPrecondition[]): readonly { readonly from: string; readonly to: string }[] {
  return checks
    .map((c) => (c.verdict.kind === "refuse" ? c.verdict.suggestOverride : undefined))
    .filter((x): x is { from: string; to: string } => x !== undefined);
}

/** The repos whose existing branch we are about to reuse — worth saying out loud. */
export function adoptions(checks: readonly RepoPrecondition[]): readonly string[] {
  return checks.filter((c) => c.verdict.kind === "adopt").map((c) => c.url);
}
