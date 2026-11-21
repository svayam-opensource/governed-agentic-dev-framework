// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `join` (SDD Part B, join.sh; authorization = board write access, build-specification.md §1.5) — set up an authorized teammate's OWN
 * per-project workspace on an ALREADY-seeded project. No new id, no anchor, no
 * scaffold — just materialize worktrees on the EXISTING project branch. Model A
 * (SDD-012): identity + repos derived from the board; nothing read from a state
 * file. Idempotent (an existing worktree is skipped); NOT transactional — a
 * re-run resumes.
 */
import * as path from "node:path";
import type { Board } from "./board.js";
import type { Vcs, FsProbe } from "./vcs.js";
import type { BoardRef } from "./identity.js";
import { parseBoardUrl, deriveProjectIdentity } from "./identity.js";
import { repoNameFromUrl, ensureBaseFresh } from "./repo.js";

export interface JoinConfig {
  readonly githubOrg: string;
  readonly ownerField?: "organization" | "user";
  readonly workspaceRepo: string;
  readonly orgRepoUrl: string;
  readonly agentWorkRoot: string;
  readonly remote?: string;
}

export interface JoinInput {
  readonly boardUrl: string;
  readonly identity?: { name?: string; email?: string };
}

export interface JoinDeps {
  readonly board: Board;
  readonly vcs: Vcs;
  readonly fs: FsProbe;
  readonly cloneRepo: (url: string, dest: string) => void;
  /** REQUIRED (C01) — write-access to the GitHub Project; called unconditionally. */
  readonly authorize: (ref: BoardRef) => boolean;
  readonly log?: (msg: string) => void;
}

export type JoinResult =
  | { readonly ok: true; readonly projectId: string; readonly branch: string; readonly orgGovClone: string; readonly repos: readonly string[] }
  | { readonly ok: false; readonly code: number; readonly reason: "bad-url" | "empty-slug" | "unauthorized" | "branch-missing"; readonly message: string };

/**
 * The project branch is not on a repo's remote (F135). Thrown by {@link materialize} and turned into a refusal by
 * {@link join}, so a project that was never seeded is named as such instead of surfacing as git's exit 128
 * ("fatal: invalid reference") from `worktree add … origin/<branch>`.
 */
class BranchMissing extends Error {
  constructor(readonly url: string, readonly branch: string) { super(`${branch} is not on ${url}`); }
}

/** Materialize a worktree of `url` at `worktreePath` on the existing `branch`. */
function materialize(deps: JoinDeps, url: string, worktreePath: string, branch: string, agentWorkRoot: string, remote: string): void {
  if (deps.fs.pathExists(path.join(worktreePath, ".git"))) return; // already joined — skip
  // Ensure the shared base clone exists AND is synced from the remote, via the single base-access seam.
  const baseClone = ensureBaseFresh(
    { pathExists: (x) => deps.fs.pathExists(x), cloneRepo: (u, d) => deps.cloneRepo(u, d), fetch: (d, r, ref) => deps.vcs.fetch(d, r, ref) },
    agentWorkRoot, url, remote, branch,
  );
  // JOIN NEEDS A SEEDED PROJECT, AND AN ANCHOR IS NOT PROOF OF ONE (F135). `gov project` opens the anchor issue
  // before `gov seed` pushes the branch, so a board can be anchored with no branch anywhere. Checked here, from
  // the clone the worktree is cut from, so the refusal names the fix rather than git's "invalid reference".
  if (!deps.vcs.remoteBranchExists(baseClone, remote, branch)) throw new BranchMissing(url, branch);
  // Create a local branch tracking the existing remote project branch, checked
  // out in the new worktree (startPoint = origin/<branch>).
  deps.vcs.worktreeAdd(baseClone, branch, worktreePath, `${remote}/${branch}`);
}

export function join(deps: JoinDeps, config: JoinConfig, input: JoinInput): JoinResult {
  const log = deps.log ?? (() => {});
  const remote = config.remote ?? "origin";

  const ref = parseBoardUrl(input.boardUrl);
  if (!ref) return { ok: false, code: 1, reason: "bad-url", message: `Not a GitHub Project URL: ${input.boardUrl}` };
  const boardRef: BoardRef = { ...ref, ownerField: config.ownerField ?? ref.ownerField };

  const board = deps.board.fetchProject(boardRef);
  const idr = deriveProjectIdentity({ url: input.boardUrl, title: board.title });
  if (!idr.ok) return { ok: false, code: 1, reason: idr.reason, message: `Cannot derive project id (${idr.reason}).` };
  const { projectId, branch } = idr;

  if (!deps.authorize(boardRef)) {
    return { ok: false, code: 1, reason: "unauthorized", message: `Not authorized to join GitHub Project #${boardRef.number}.` };
  }

  const projectWorkRoot = path.join(config.agentWorkRoot, projectId);
  const orgGovClone = path.join(projectWorkRoot, config.workspaceRepo);

  const repos: string[] = [];
  try {
    log(`join ${projectId}: gov worktree on ${branch}`);
    materialize(deps, config.orgRepoUrl, orgGovClone, branch, config.agentWorkRoot, remote);
    if (input.identity) deps.vcs.setIdentity(orgGovClone, input.identity);

    for (const url of board.repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo)) {
      const dir = path.join(projectWorkRoot, repoNameFromUrl(url));
      materialize(deps, url, dir, branch, config.agentWorkRoot, remote);
      if (input.identity) deps.vcs.setIdentity(dir, input.identity);
      repos.push(dir);
    }
  } catch (e) {
    if (!(e instanceof BranchMissing)) throw e;
    const isGov = e.url === config.orgRepoUrl;
    return {
      ok: false, code: 1, reason: "branch-missing",
      message: [
        `Cannot join ${projectId}: its project branch ${branch} is not on ${e.url} (or that remote could not be reached).`,
        isGov
          ? `  The project has not been seeded yet — an anchor issue alone does not create the branch. Seed it:  gov seed ${input.boardUrl}`
          : `  The governance branch exists but this linked repo has none — the seed did not finish. Finish it:  gov seed ${input.boardUrl}`,
      ].join("\n"),
    };
  }

  return { ok: true, projectId, branch, orgGovClone, repos };
}
