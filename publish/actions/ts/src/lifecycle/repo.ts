// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Pure repo-URL helpers (SDD Part B, seed Phase C). Mirrors lib.sh `get_repo_name`
 * (`basename <url> .git`) and `base_clone_dir` (`<agentWorkRoot>/.bases/<name>` —
 * the ADR-0001 shared base clone, one per repo, project branches as worktrees).
 */
import * as path from "node:path";

/** The repo name from a clone URL: last path segment, minus a trailing `.git`. */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  const last = trimmed.split(/[/:]/).pop() ?? trimmed;
  return last.replace(/\.git$/, "");
}

/** The shared base-clones ROOT: `<agentWorkRoot>/.bases` (ADR-0001 — one base clone per repo lives here;
 *  project branches are worktrees off it). The single place the `.bases` layout constant is spelled. */
export function basesRoot(agentWorkRoot: string): string {
  return path.join(agentWorkRoot, ".bases");
}

/** The shared base-clone dir for a repo: `<basesRoot>/<repoName>`. */
export function baseCloneDir(agentWorkRoot: string, url: string): string {
  return path.join(basesRoot(agentWorkRoot), repoNameFromUrl(url));
}

/** The minimal I/O a base-clone access needs. Injected so `repo.ts` stays pure (no direct fs/git) and the
 *  same primitive is unit-testable and reused by every consumer. */
export interface BaseAccessIo {
  /** True if `p` exists (used to detect a missing base clone → first-use clone). */
  readonly pathExists: (p: string) => boolean;
  /** Clone `url` into `dest` (retry-wrapped in real use — see makeCloneRepo). */
  readonly cloneRepo: (url: string, dest: string) => void;
  /** Fetch `ref` (or all) from `remote` into `repoDir`; best-effort. */
  readonly fetch: (repoDir: string, remote: string, ref?: string) => void;
}

/**
 * THE single entry-point for shared base-clone access. Ensures the base clone for `url` EXISTS (clone on
 * first use) and is SYNCED from `remote` (fetch `ref`, or all refs when omitted), then returns its path.
 * EVERY consumer goes through this — worktree materialization (join, code-repo) AND governed deploys — so a
 * base clone is never read stale: a shared clone that lags its remote content-addresses to an OLD tree, which
 * is precisely the `:unresolved` / wrong-content_sha class of bug. Sync is not optional; it is the contract.
 */
export function ensureBaseFresh(io: BaseAccessIo, agentWorkRoot: string, url: string, remote = "origin", ref?: string): string {
  const baseClone = baseCloneDir(agentWorkRoot, url);
  if (!io.pathExists(path.join(baseClone, ".git"))) io.cloneRepo(url, baseClone);
  io.fetch(baseClone, remote, ref); // ALWAYS sync — the base is shared; skipping risks addressing a stale tree
  return baseClone;
}

/**
 * Sync EVERY present base clone under `<basesRoot>` from `remote` (best-effort fetch of all). The
 * governed-DEPLOY counterpart of {@link ensureBaseFresh}: the gov-cicd plugin resolves a unit's source from
 * `.bases/<repo>` (via GOV_GIT_ROOT) in its OWN process, so the host can't route each per-repo read through
 * `ensureBaseFresh` — instead it syncs all shared clones up-front, giving the same never-stale guarantee
 * across the set. `listBaseDirs` returns the base-clone directory names (`[]` if the root is absent).
 */
export function syncAllBases(
  io: { readonly listBaseDirs: (root: string) => readonly string[]; readonly fetch: (repoDir: string, remote: string, ref?: string) => void },
  agentWorkRoot: string,
  remote = "origin",
): void {
  const root = basesRoot(agentWorkRoot);
  for (const name of io.listBaseDirs(root)) io.fetch(path.join(root, name), remote);
}
