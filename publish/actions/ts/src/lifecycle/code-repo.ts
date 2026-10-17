// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Phase C of seed (SDD Part B): materialize a code repo's project branch as a
 * worktree off a shared base clone, then push it. The base clone (`.bases/<repo>`)
 * is shared and persists — it is NOT rolled back; only the per-project worktree
 * and the pushed branch are compensated on failure (registered on the Transaction).
 */
import * as path from "node:path";
import type { FsProbe, Vcs } from "./vcs.js";
import type { Transaction } from "./transaction.js";
import { retry, type RetryOptions } from "./retry.js";
import { ensureBaseFresh, repoNameFromUrl } from "./repo.js";

/** Parameters for setting up one code repo's project-branch worktree. */
export interface CodeRepoParams {
  readonly url: string;
  readonly baseBranch: string;
  readonly projectBranch: string;
  readonly agentWorkRoot: string;
  readonly projectWorkRoot: string;
  readonly remote?: string;
  readonly identity?: { name?: string; email?: string };
  /**
   * Reuse a project branch that is already there, because seed's preflight decided
   * it could only have come from a failed run of this command (#180).
   */
  readonly adoptExisting?: boolean;
}

/**
 * The filesystem a code-repo setup needs: the probe, plus the move that ARCHIVES an occupied path (#214).
 * `rename` is optional only because older test doubles lack it; without it an occupied path is refused, by name.
 */
export type CodeRepoFs = FsProbe & { readonly rename?: (from: string, to: string) => void };

/** Dependencies for {@link setupCodeRepoWorktree}. */
export interface CodeRepoDeps {
  readonly vcs: Vcs;
  readonly fs: CodeRepoFs;
  readonly tx: Transaction;
  /** Clone `url` into `dest` (retry-wrapped; see {@link makeCloneRepo}). */
  readonly cloneRepo: (url: string, dest: string) => void;
  /** Progress lines the person sees ("archived …", "recreated …"). */
  readonly log?: (msg: string) => void;
  /** The clock for the archive stamp (tests pin it). */
  readonly now?: () => Date;
}

/**
 * Where a previous attempt at `dir` is moved: `<parent>/archive/<stamp>/<name>` — the layout `gov setup` uses for
 * its own retry path (`archivePathFor`), so an adopter finds every archived attempt in the same kind of place.
 */
export function archivePathBeside(dir: string, stamp: string): string {
  return path.join(path.dirname(dir), "archive", stamp, path.basename(dir));
}

/** The archive stamp — an ISO time with the characters a path cannot carry everywhere replaced, as setup does. */
export function archiveStamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

/** What a failed run says after deleting a branch it recreated (D3). */
export function removedRecreatedLine(projectBranch: string, repoDir: string, remoteToo = true): string {
  const where = remoteToo ? "local and remote" : "local; it was never pushed";
  return `removed the recreated '${projectBranch}' in ${repoDir} (${where}) — this run failed; the next attempt recreates it`;
}

/** What {@link ensureProjectBranch} found: the branch was there, or gov had to recreate it. */
export type ProjectBranchState = "present" | "recreated";

/**
 * A REOPENED PROJECT'S MISSING BRANCH (#224, Q17 A).
 *
 * `gov close` deletes each code repo's project branch, locally and on the remote; the worktree stays on disk,
 * detached on the base. Reopen the board and every verb that assumed the branch — `sync`, `task` — died on
 * `git checkout <branch>`: "pathspec did not match", after partial work. A missing project branch in a present
 * worktree is not somebody's work and not a conflict; it is the closed state. So it is recreated off the base,
 * pushed, and SAID — a person must never discover later that gov made a branch for them.
 *
 * UNDONE ON A LATER FAILURE when a transaction is passed (D3, Policy Owner 2026-10-13, revising I04 T05's keep):
 * `gov task` passes its own, so a run that fails after recreating the branch deletes it again — locally and on the
 * remote — and says so; the next attempt recreates it. Nothing gov made is left behind by a failed run.
 */
export function ensureProjectBranch(
  vcs: Vcs,
  p: { readonly repoDir: string; readonly projectBranch: string; readonly baseBranch: string; readonly remote: string },
  log: (msg: string) => void = () => {},
  tx?: Transaction,
): ProjectBranchState {
  if (vcs.localBranchExists(p.repoDir, p.projectBranch)) return "present";
  if (vcs.remoteBranchExists(p.repoDir, p.remote, p.projectBranch)) {
    // Fetching it makes `checkout <branch>` find it: git creates the local branch tracking the remote one.
    vcs.fetch(p.repoDir, p.remote, p.projectBranch);
    return "present";
  }
  vcs.fetch(p.repoDir, p.remote, p.baseBranch);
  const base = `${p.remote}/${p.baseBranch}`;
  vcs.checkoutNew(p.repoDir, p.projectBranch, base);
  // Registered as soon as it exists, so a failed push below is undone too. Back to the closed state first —
  // detached on the base — because git will not delete the branch a worktree is on.
  let pushed = false;
  tx?.onRollback(`recreated ${p.projectBranch} in ${p.repoDir}`, () => {
    vcs.checkout(p.repoDir, base);
    vcs.branchDelete(p.repoDir, p.projectBranch);
    if (pushed) vcs.pushDelete(p.repoDir, p.remote, p.projectBranch);
    log(removedRecreatedLine(p.projectBranch, p.repoDir, pushed));
  });
  vcs.push(p.repoDir, p.remote, p.projectBranch, { setUpstream: true });
  pushed = true;
  log(`recreated '${p.projectBranch}' in ${p.repoDir} off ${p.remote}/${p.baseBranch} — it was missing (a closed project, reopened)`);
  return "recreated";
}

/**
 * Ensure a shared base clone exists, guard against a pre-existing project branch,
 * then add + push the project-branch worktree. Rollback (worktree remove + branch
 * delete, and pushed-branch delete) is registered on the Transaction as steps run.
 * Throws (triggering the caller's rollback) if the base branch is missing or the
 * project branch already exists in the repo.
 *
 * WHAT IS ALREADY AT THE PATH (#214, #224) is decided before anything is created:
 *   · a worktree of this base clone → REUSED: put on the project branch (recreated off the base if missing);
 *   · anything else (a pre-worktree clone, a failed attempt) → ARCHIVED, never deleted, and the add goes ahead.
 */
export function setupCodeRepoWorktree(
  deps: CodeRepoDeps,
  p: CodeRepoParams,
): { repoDir: string; baseClone: string } {
  const remote = p.remote ?? "origin";
  const log = deps.log ?? (() => {});
  const repoDir = path.join(p.projectWorkRoot, repoNameFromUrl(p.url));

  // One shared base clone per repo (persists — not rolled back): ensure it exists AND is synced, via the
  // single base-access seam so a worktree is never cut from a stale base (same guarantee as a governed deploy).
  const baseClone = ensureBaseFresh(
    { pathExists: (x) => deps.fs.pathExists(x), cloneRepo: (u, d) => deps.cloneRepo(u, d), fetch: (d, r, ref) => deps.vcs.fetch(d, r, ref) },
    p.agentWorkRoot, p.url, remote, p.baseBranch,
  );

  if (!deps.vcs.refExists(baseClone, `refs/remotes/${remote}/${p.baseBranch}`)) {
    throw new Error(`Base branch '${p.baseBranch}' not found in ${p.url}`);
  }

  // ── The path ────────────────────────────────────────────────────────────────
  if (deps.fs.pathExists(repoDir)) {
    if (deps.vcs.worktreeOf?.(baseClone, repoDir)) {
      reusePresentWorktree(deps, p, { repoDir, baseClone, remote }, log);
      return { repoDir, baseClone };
    }
    archiveOccupiedPath(deps, repoDir, baseClone, log);
  }

  // An existing branch is no longer fatal here (#180). seed's preflight has already
  // classified it against the remote: a branch sitting exactly on the base tip could
  // only have come from a failed run of this command, and is adopted; anything with
  // commits of its own was refused before the first write. `adoptExisting` carries
  // that verdict in, so this function never has to guess.
  const existsLocally = deps.vcs.refExists(baseClone, `refs/heads/${p.projectBranch}`);
  const existsRemotely = deps.vcs.refExists(baseClone, `refs/remotes/${remote}/${p.projectBranch}`);
  const exists = existsLocally || existsRemotely;

  // THE SAME RULE, WHEREVER THE BRANCH TURNS UP (#180).
  //
  // seed's preflight asks the REMOTE, and adopts a project branch sitting exactly on
  // the base tip because only a failed run of this command could have put it there.
  // A branch can also be left behind LOCALLY: the base clone persists between runs
  // by design (it is not rolled back), so a run that created the branch and died
  // before pushing leaves it here, invisible to `ls-remote`. The preflight then says
  // "create", and this threw "already exists — investigate" about the tool's own
  // leftover, which is the message #180 exists to remove.
  //
  // So the same question is asked again with what is knowable here: is it at the
  // base tip? Then it is ours and empty. Otherwise it holds work, and refusing is
  // right — with the reason, not with "investigate".
  let reusing = exists && p.adoptExisting === true;
  if (exists && !reusing) {
    const baseSha = deps.vcs.revParse(baseClone, `${remote}/${p.baseBranch}`);
    const branchSha = deps.vcs.revParse(baseClone, p.projectBranch)
      ?? deps.vcs.revParse(baseClone, `${remote}/${p.projectBranch}`);
    if (baseSha && branchSha && baseSha === branchSha) {
      reusing = true;
    } else {
      // Name the place it actually is (#214): "already exists in <url>" sent a person to `ls-remote`, which was
      // empty, for a branch sitting in the local base clone.
      const where = existsLocally
        ? `locally, in the base clone at ${baseClone}`
        : `on ${remote} (${p.url})`;
      throw new Error(
        `Branch '${p.projectBranch}' already exists ${where}, and has commits of its own.\n` +
        `    That is somebody's work, not a leftover from a failed setup, so gov will not reuse it.\n` +
        `    Either finish or delete that branch, or seed this project under a different board.`,
      );
    }
  }

  // THE REF IS AN UNDO STEP OF ITS OWN (#214). `git worktree add -b` creates the branch BEFORE it can fail on the
  // directory, so treating the worktree as atomic left a ref behind that made every retry fail at the same place.
  // Registered before the add, so it runs after the worktree's own undo; it deletes only a ref this run made.
  if (!reusing) {
    deps.tx.onRollback(`branch ${p.projectBranch} in ${baseClone}`, () => {
      if (deps.vcs.refExists(baseClone, `refs/heads/${p.projectBranch}`)) deps.vcs.branchDelete(baseClone, p.projectBranch);
    });
  }

  deps.tx.step(
    `worktree ${repoDir}`,
    () => {
      try {
        if (reusing) {
          // Check it out rather than create it. `-b` on an existing branch fails, and
          // deleting-then-recreating would destroy the very thing we decided to keep.
          deps.vcs.worktreeAddExisting(baseClone, p.projectBranch, repoDir);
        } else {
          deps.vcs.worktreeAdd(baseClone, p.projectBranch, repoDir, `${remote}/${p.baseBranch}`);
        }
      } catch (e) {
        throw new Error(`Could not create the worktree at ${repoDir}: ${(e as Error).message}`, { cause: e });
      }
    },
    () => deps.vcs.worktreeRemove(baseClone, repoDir),
  );

  if (p.identity) deps.vcs.setIdentity(repoDir, p.identity);

  deps.tx.step(
    `push ${repoDir}`,
    () => deps.vcs.push(repoDir, remote, p.projectBranch, { setUpstream: true }),
    // Same rule: an adopted branch was already on the remote before this run.
    () => { if (!reusing) deps.vcs.pushDelete(repoDir, remote, p.projectBranch); },
  );

  return { repoDir, baseClone };
}

/**
 * An occupied path that is not one of our worktrees is the RETRY case, not a refusal (#214) — the rule `gov setup`
 * states in `create.ts`. Typically a standalone clone from before the base-plus-worktree model, or a failed attempt.
 * It is moved aside — never deleted — and the move is undone if the run fails and the path is free again.
 */
function archiveOccupiedPath(deps: CodeRepoDeps, repoDir: string, baseClone: string, log: (msg: string) => void): void {
  const rename = deps.fs.rename;
  if (!rename) {
    throw new Error(`${repoDir} already exists and is not a worktree of ${baseClone}. Move it aside, then re-run.`);
  }
  const archive = archivePathBeside(repoDir, archiveStamp((deps.now ?? (() => new Date()))()));
  deps.tx.step(
    `archive ${repoDir}`,
    () => rename(repoDir, archive),
    () => { if (!deps.fs.pathExists(repoDir)) rename(archive, repoDir); },
  );
  log(`archived the previous attempt → ${archive}`);
}

/**
 * A worktree of this base clone is already at the path (#224 — a reopened project, or add-repo run twice). It is
 * reused: put on the project branch, recreating that branch off the base when it is gone, and pushed.
 */
function reusePresentWorktree(
  deps: CodeRepoDeps,
  p: CodeRepoParams,
  at: { readonly repoDir: string; readonly baseClone: string; readonly remote: string },
  log: (msg: string) => void,
): void {
  const { repoDir, remote } = at;
  if (deps.vcs.currentBranch(repoDir) === p.projectBranch) {
    log(`${repoDir} is already on '${p.projectBranch}' — reusing it`);
  } else {
    log(`reusing the worktree at ${repoDir}`);
    const state = ensureProjectBranch(deps.vcs, { repoDir, projectBranch: p.projectBranch, baseBranch: p.baseBranch, remote }, log);
    if (state === "present") deps.vcs.checkout(repoDir, p.projectBranch);
  }
  if (p.identity) deps.vcs.setIdentity(repoDir, p.identity);
  deps.vcs.push(repoDir, remote, p.projectBranch, { setUpstream: true });
}

/**
 * Build a retry-wrapped `cloneRepo` (the `git_clone_retry` behavior): remove any
 * partial `dest`, then clone, retrying with backoff. `rmDir` + retry `sleep` are
 * injected so this is testable without touching disk or waiting.
 */
export function makeCloneRepo(
  vcs: Pick<Vcs, "clone">,
  deps: { rmDir: (dir: string) => void } & RetryOptions,
): (url: string, dest: string) => void {
  return (url, dest) =>
    retry(() => {
      deps.rmDir(dest);
      vcs.clone(url, dest);
    }, deps);
}
