// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * REVERSING A FAILED SEED — the cleanup step `leftover.ts` promised and nobody built (#230).
 *
 * `detectLeftovers` has always found the wreckage of an interrupted seed and attached, to each
 * artifact, the data needed to undo it (`branch`, `repoDir`, `remote`, `path`). Nothing read that
 * data. `seed` returned `reason: "leftover-state"` plus a list, the run stopped, and the adopter was
 * left to delete a remote branch and a directory on the default branch from memory — the two
 * operations they should least be doing by hand.
 *
 * Detection that leads nowhere is worse than no detection: it tells the reader the tool understands
 * the problem, which implies it can act on it.
 *
 * ── WHY THIS IS A PLAN AND NOT A `--force` ─────────────────────────────────────────────────────────
 *
 * The four artifacts carry very different risk, and an all-or-nothing sweep gets the dangerous one
 * wrong in order to clear the harmless one. A remote project branch may hold the only copy of real
 * work; a stale empty directory holds nothing. So each artifact is judged on its own evidence and
 * gets one of three verdicts:
 *
 *   · `reversible`     — evidence says nothing is lost. Safe to do.
 *   · `needs-consent`  — recoverable work, or a write to a shared branch. A person must say yes,
 *                        having been told what specifically is at stake.
 *   · `refused`        — uncommitted work would be destroyed and gov will not offer it at all.
 *                        Not a prompt: there is no answer that makes this safe.
 *
 * Nothing here decides for the operator, and nothing here prompts. The planner is pure so the
 * verdicts can be tested against every combination; the executor performs one already-approved
 * step. Asking belongs to whatever owns the terminal — the same split `seed` already uses for the
 * fork finding (#194), where `dispatch` hands the discovery up and `runWorkFlow` asks.
 */
import * as path from "node:path";
import type { Vcs, FsProbe } from "./vcs.js";
import type { LeftoverArtifact, SeedPaths } from "./leftover.js";

/** What gov is willing to do about one artifact, and on what evidence. */
export type CleanupVerdict =
  | { readonly kind: "reversible"; readonly why: string }
  | { readonly kind: "needs-consent"; readonly why: string; readonly atStake: string }
  | { readonly kind: "refused"; readonly why: string };

/** One artifact, what reversing it would do, and whether gov may. */
export interface CleanupStep {
  readonly artifact: LeftoverArtifact;
  /** What the reversal performs, in the operator's terms — shown before they answer. */
  readonly action: string;
  readonly verdict: CleanupVerdict;
}

export interface CleanupConfig {
  readonly defaultBranch: string;
  readonly remote: string;
  /** The governance repo's directory name inside the project work root. */
  readonly workspaceRepo: string;
}

export interface CleanupEnv {
  readonly vcs: Vcs;
  readonly fs: FsProbe;
  /** Entry names in a directory; used to find the git repos inside a work root. */
  readonly readdir: (dir: string) => readonly string[];
  /** Recursive remove. Needed for the home stub, whose reversal is a real commit. */
  readonly rm: (target: string) => void;
}

/**
 * REVERSAL ORDER, which is not the detection order.
 *
 * `detectLeftovers` reports in the order seed creates things, because that is the order a reader
 * recognises. Undoing runs the other way, and one pair is not merely tidier reversed but required:
 * git refuses to delete a branch that is checked out in a worktree, so the worktree under the work
 * root has to go before the local branch. Deleting the remote branch before the local one would
 * also leave `git branch -d` without the upstream it uses to tell merged from unmerged.
 */
const REVERSAL_ORDER: readonly LeftoverArtifact["kind"][] = ["workspace-dir", "local-branch", "remote-branch", "home-stub"];

/** Sort a detected list into the order reversal must happen in. */
export function inReversalOrder(leftovers: readonly LeftoverArtifact[]): LeftoverArtifact[] {
  return [...leftovers].sort((a, b) => REVERSAL_ORDER.indexOf(a.kind) - REVERSAL_ORDER.indexOf(b.kind));
}

/**
 * Is every commit on `ref` already contained in the default branch?
 *
 * The question reversal turns on, and the one worth being conservative about: a false "yes" deletes
 * work. `isAncestor` needs both refs present locally, so a missing ref is answered `false` — unknown
 * is treated as "might carry work", never as "safe".
 */
function containedInDefault(env: CleanupEnv, repoDir: string, ref: string, cfg: CleanupConfig): boolean {
  const target = `${cfg.remote}/${cfg.defaultBranch}`;
  if (!env.vcs.refExists(repoDir, ref) || !env.vcs.refExists(repoDir, target)) return false;
  return env.vcs.isAncestor(repoDir, ref, target);
}

/** Every git repo directly inside `root` that reports uncommitted changes. */
function dirtyReposUnder(env: CleanupEnv, root: string): string[] {
  if (!env.fs.pathExists(root)) return [];
  return env.readdir(root)
    .map((name) => path.join(root, name))
    .filter((dir) => env.fs.pathExists(path.join(dir, ".git")))
    .filter((dir) => !env.vcs.isClean(dir));
}

/**
 * Judge one artifact. Pure apart from the read-only probes, and deliberately pessimistic: anything
 * it cannot establish becomes consent or refusal rather than a quiet deletion.
 */
export function classify(env: CleanupEnv, cfg: CleanupConfig, a: LeftoverArtifact, paths: SeedPaths): CleanupStep {
  switch (a.kind) {
    case "workspace-dir": {
      // The work root holds the governance worktree and every code-repo worktree. Uncommitted
      // changes in any of them are unrecoverable once the directory goes, so this is the one case
      // that is refused outright rather than offered with a warning: there is no informed "yes"
      // that makes destroying unpushed edits correct, and the operator can commit and re-run.
      const dirty = dirtyReposUnder(env, a.path ?? paths.projectWorkRoot);
      if (dirty.length) {
        return {
          artifact: a,
          action: `remove the work root at ${a.path}`,
          verdict: {
            kind: "refused",
            why: `uncommitted changes in ${dirty.length} repo(s) under it: ${dirty.map((d) => path.basename(d)).join(", ")}. Commit or discard them, then run this again — gov will not delete unpushed work on a confirmation.`,
          },
        };
      }
      return {
        artifact: a,
        action: `detach the worktree(s) and remove the work root at ${a.path}`,
        verdict: { kind: "reversible", why: "every repo under it is clean, so nothing unpushed is lost" },
      };
    }

    case "local-branch": {
      const contained = containedInDefault(env, a.repoDir ?? paths.govHome, a.branch ?? paths.branch, cfg);
      return contained
        ? {
            artifact: a,
            action: `delete local branch '${a.branch}' in ${a.repoDir}`,
            verdict: { kind: "reversible", why: `already contained in ${cfg.remote}/${cfg.defaultBranch}` },
          }
        : {
            artifact: a,
            action: `delete local branch '${a.branch}' in ${a.repoDir}`,
            verdict: {
              kind: "needs-consent",
              why: `it holds commits that are not in ${cfg.remote}/${cfg.defaultBranch}, or gov could not read the refs to tell`,
              atStake: "local commits. They are recoverable from the reflog for a while, but not indefinitely.",
            },
          };
    }

    case "remote-branch": {
      // The one that can destroy the only copy. A remote branch is not on this machine's reflog and
      // nobody else's clone is guaranteed to have it, so unmerged commits here are the real thing.
      const ref = `${a.remote ?? cfg.remote}/${a.branch ?? paths.branch}`;
      const contained = containedInDefault(env, a.repoDir ?? paths.govHome, ref, cfg);
      return contained
        ? {
            artifact: a,
            action: `delete remote branch '${ref}'`,
            verdict: { kind: "reversible", why: `already contained in ${cfg.remote}/${cfg.defaultBranch}` },
          }
        : {
            artifact: a,
            action: `delete remote branch '${ref}'`,
            verdict: {
              kind: "needs-consent",
              why: `it holds commits that are not in ${cfg.remote}/${cfg.defaultBranch}, or gov could not read the refs to tell`,
              atStake: "possibly the ONLY copy of that work — a deleted remote branch is not in your reflog and may be in no clone at all.",
            },
          };
    }

    case "home-stub":
      // Seed creates this with a direct commit and push to the default branch (seed.ts) rather than
      // through a pull request, so removing it the same way is symmetric with how it got there — not
      // a new privilege. It still asks every time, because a shared branch is the one place a wrong
      // keystroke reaches other people.
      return {
        artifact: a,
        action: `remove ${a.path} and commit that removal on ${cfg.defaultBranch}`,
        verdict: {
          kind: "needs-consent",
          why: `this commits to ${cfg.defaultBranch}, which is shared — the same way seed created the stub`,
          atStake: "nothing of yours; the stub is a marker. But the commit is visible to everyone on the default branch.",
        },
      };
  }
}

/** The whole plan, in the order reversal must run. */
export function planCleanup(env: CleanupEnv, cfg: CleanupConfig, leftovers: readonly LeftoverArtifact[], paths: SeedPaths): CleanupStep[] {
  return inReversalOrder(leftovers).map((a) => classify(env, cfg, a, paths));
}

/** Did the plan find anything gov will not offer at all? */
export function hasRefusals(plan: readonly CleanupStep[]): boolean {
  return plan.some((s) => s.verdict.kind === "refused");
}

export type ReverseOutcome = { readonly ok: true } | { readonly ok: false; readonly why: string };

/**
 * Perform ONE approved step.
 *
 * Takes no verdict into account on purpose: consent is the caller's business and re-deciding it here
 * would put the decision in two places. A `refused` step reaching this function is a caller bug, so
 * it is rejected loudly rather than executed.
 */
export function reverse(env: CleanupEnv, cfg: CleanupConfig, step: CleanupStep, paths: SeedPaths): ReverseOutcome {
  if (step.verdict.kind === "refused") {
    return { ok: false, why: `refused steps are never executed: ${step.verdict.why}` };
  }
  const a = step.artifact;
  try {
    switch (a.kind) {
      case "workspace-dir": {
        const root = a.path ?? paths.projectWorkRoot;
        // Detach worktrees through git FIRST. An `rm -rf` of a worktree leaves the parent repo with
        // a registered worktree pointing at nothing, and the next `worktreeAdd` for the same path
        // then fails with a message about an existing worktree that is not there any more — which
        // is its own confusing leftover, created by the cleanup.
        for (const name of env.readdir(root)) {
          const dir = path.join(root, name);
          if (!env.fs.pathExists(path.join(dir, ".git"))) continue;
          const base = name === cfg.workspaceRepo ? paths.govHome : dir;
          try {
            env.vcs.worktreeRemove(base, dir);
          } catch {
            // Not every directory under the root is a worktree of a repo gov knows; the recursive
            // remove below still clears it. Failing the whole step here would strand the rest.
          }
        }
        env.vcs.worktreeRemove(paths.govHome, root);
        return { ok: true };
      }
      case "local-branch":
        env.vcs.branchDelete(a.repoDir ?? paths.govHome, a.branch ?? paths.branch);
        return { ok: true };
      case "remote-branch":
        env.vcs.pushDelete(a.repoDir ?? paths.govHome, a.remote ?? cfg.remote, a.branch ?? paths.branch);
        return { ok: true };
      case "home-stub": {
        // The full reversal, here rather than handed back to the caller: a step that reports a
        // verdict and then declines to act on it is the shape this whole module exists to remove.
        // Symmetric with seed, which writes the stub, commits it in govHome and pushes the default
        // branch — so this removes, commits and pushes the same branch the same way.
        const stub = a.path ?? paths.homeStub;
        const rel = path.relative(paths.govHome, stub);
        env.rm(stub);
        env.vcs.addPath(paths.govHome, rel);
        env.vcs.commit(paths.govHome, `seed cleanup: remove the stub for ${path.basename(stub)} left by a failed run`);
        env.vcs.push(paths.govHome, cfg.remote, cfg.defaultBranch);
        return { ok: true };
      }
    }
  } catch (e) {
    return { ok: false, why: (e as Error)?.message ?? String(e) };
  }
}

/** The plan as lines an operator reads before answering. */
export function planLines(plan: readonly CleanupStep[]): string[] {
  if (plan.length === 0) return ["Nothing to reverse."];
  const out = ["A previous run left this behind. gov can reverse it, one piece at a time:", ""];
  for (const s of plan) {
    const mark = s.verdict.kind === "reversible" ? "safe  " : s.verdict.kind === "needs-consent" ? "ask   " : "REFUSE";
    out.push(`  [${mark}] ${s.action}`);
    out.push(`           ${s.verdict.why}`);
    if (s.verdict.kind === "needs-consent") out.push(`           at stake: ${s.verdict.atStake}`);
  }
  out.push("");
  if (hasRefusals(plan)) out.push("At least one item is REFUSED — resolve that first; gov will not offer to destroy it.");
  return out;
}
