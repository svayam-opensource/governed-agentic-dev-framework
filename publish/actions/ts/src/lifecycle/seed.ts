// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The seed orchestrator (SDD Part B) — wires the phases through a Transaction so
 * any failure unwinds. The HOME workspace stays on the default branch throughout;
 * all project-branch work happens in the per-project worktree.
 *
 *   A   home stub commit on the default branch (local; pushed in D)
 *   B   gov worktree (project branch) + carry identity
 *   B.1 scaffold projects/<id>/ content (project.yaml/agent.md/todo.md/tool files)
 *   C   code-repo worktrees (setupCodeRepoWorktree)
 *   D   push project branch + home default; best-effort anchor issue
 */
import * as path from "node:path";
import { Transaction, type RollbackFailure } from "./transaction.js";
import { type Board, validateBoard, boardValidationMessage } from "./board.js";
import type { Vcs } from "./vcs.js";
import type { Fs } from "./fs-io.js";
import type { AnchorCreator } from "./anchor.js";
import { ensureRootProtocol } from "./root-protocol.js";
import { deriveProjectIdentity, parseBoardUrl } from "./identity.js";
import { seedPathsFor, detectLeftovers, leftoversMessage, type LeftoverArtifact } from "./leftover.js";
import { renderAgentMd, renderTodoMd, substituteTokens } from "./content.js";
import { setupCodeRepoWorktree } from "./code-repo.js";
import { repoNameFromUrl } from "./repo.js";
import { classifyProjectBranch, preconditionFailures, adoptions, type RepoPrecondition, type RemoteRef } from "./branch-adoption.js";

/** Org-config-derived settings for a seed run. */
export interface SeedConfig {
  readonly govHome: string;
  readonly workspaceRepo: string;
  readonly agentWorkRoot: string;
  readonly defaultBranch: string;
  readonly defaultCodeBranch: string;
  readonly githubOrg: string;
  /** Token → value for tool-file substitution (e.g. ORG_NAME). */
  readonly orgTokens: Readonly<Record<string, string>>;
  /** Tool files (paths under `framework/`) to token-substitute into the project. */
  readonly toolFiles?: readonly string[];
  readonly remote?: string;
}

/** Per-run inputs. */
export interface SeedInput {
  readonly boardUrl: string;
  readonly assignee: string;
  readonly seededBy: string;
  /** YYYY-MM-DD (injected — no Date in pure code). */
  readonly today: string;
  readonly identity?: { name?: string; email?: string };
  /** gh login to assign the anchor issue to. */
  readonly seederLogin?: string | null;
  /** repo url → chosen base branch (else defaultCodeBranch). */
  readonly repoBases?: Readonly<Record<string, string>>;
  /** Frozen legacy branch overrides for grandfathered ids. */
  readonly legacyBranches?: Readonly<Record<string, string>>;
}

/** Ports + effects the orchestrator drives. */
export interface SeedDeps {
  readonly board: Board;
  readonly vcs: Vcs;
  readonly fs: Fs;
  readonly anchor: AnchorCreator;
  readonly cloneRepo: (url: string, dest: string) => void;
  readonly log?: (msg: string) => void;
}

export interface SeedSuccess {
  readonly ok: true;
  readonly projectId: string;
  readonly branch: string;
  readonly projectWorkRoot: string;
  readonly orgGovClone: string;
  readonly repos: ReadonlyArray<{ name: string; url: string; repoDir: string }>;
  readonly anchorRef: string | null;
}

export type SeedResult =
  | SeedSuccess
  | { readonly ok: false; readonly code: number; readonly reason: string; readonly message: string; readonly leftovers?: readonly LeftoverArtifact[]; readonly rollbackFailures?: readonly RollbackFailure[] };

function gitkeepStub(i: {
  projectId: string;
  branch: string;
  boardNumber: number;
  defaultBranch: string;
}): string {
  return `# Active project — full content lives on branch '${i.branch}'.
#
# This folder is a stub on ${i.defaultBranch}. The project is registered on GitHub
# (Project #${i.boardNumber} + its 'anchor' issue) — GitHub is the SOLE source of
# truth (no project.yaml / registry.yaml, SDD-012). The authored content
# (agent.md, knowledge/) lives on branch '${i.branch}'.
`;
}

/** Seed a project workspace from its GitHub Project board. */
export function seed(deps: SeedDeps, config: SeedConfig, input: SeedInput): SeedResult {
  const log = deps.log ?? (() => {});
  const remote = config.remote ?? "origin";

  // ── Validate + derive identity ──────────────────────────────────────────────
  const ref = parseBoardUrl(input.boardUrl);
  if (!ref) return { ok: false, code: 1, reason: "bad-url", message: `Not a GitHub Project URL: ${input.boardUrl}` };

  const board = deps.board.fetchProject(ref);
  const gate = validateBoard(board);
  if (!gate.ok) return { ok: false, code: 1, reason: gate.reason, message: boardValidationMessage(gate) };

  const idr = deriveProjectIdentity({ url: input.boardUrl, title: board.title, legacyBranches: input.legacyBranches });
  if (!idr.ok) {
    return { ok: false, code: 1, reason: idr.reason, message: `Cannot derive project id (${idr.reason}).` };
  }
  const { projectId, branch } = idr;
  const paths = seedPathsFor({ govHome: config.govHome, agentWorkRoot: config.agentWorkRoot, projectId, branch });
  const orgGovClone = path.join(paths.projectWorkRoot, config.workspaceRepo);
  const projectDir = path.join(orgGovClone, "projects", projectId);

  // ── Leftover-state guard ────────────────────────────────────────────────────
  const leftovers = detectLeftovers({ vcs: deps.vcs, fs: deps.fs }, paths);
  if (leftovers.length) {
    return { ok: false, code: 1, reason: "leftover-state", message: leftoversMessage(leftovers), leftovers };
  }

  const codeRepoUrls = board.repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo);

  // ── REMOTE PREFLIGHT, before the first write (#180) ─────────────────────────
  //
  // These conditions used to be evaluated in Phase C, after three phases of writes.
  // Nothing about them needs those phases: a branch either exists on a remote or it
  // does not, and that is knowable from `ls-remote` before anything is created. The
  // adopter met the answer as a failure four phases in, and the failed run left a
  // pushed branch behind that made every retry fail at the same place.
  //
  // Same discipline as `create.ts`: nothing is created until everything is known.
  const checks: RepoPrecondition[] = codeRepoUrls.map((url) => {
    let refs: readonly RemoteRef[];
    try {
      refs = deps.vcs.lsRemoteRefs(url);
    } catch (e) {
      // Unreadable is its own answer, and a common one: a private repo the adopter
      // has not been granted, or a URL with a typo. Say which repo, and what git said.
      return { url, verdict: { kind: "no-base" as const, detail: `Cannot read ${url}: ${(e as Error).message}` } };
    }
    return { url, verdict: classifyProjectBranch(refs, config.defaultCodeBranch ?? "dev", branch, url) };
  });
  const blockers = preconditionFailures(checks);
  if (blockers.length) {
    return {
      ok: false,
      code: 1,
      reason: "preflight-failed",
      message: `Cannot seed ${projectId} — nothing has been created:\n${blockers.join("\n")}`,
    };
  }
  const reused = adoptions(checks);
  if (reused.length) {
    // Say it. Reusing a branch is a decision made on the adopter's behalf, and the
    // reason it is safe — no commits of its own — is exactly what they would check.
    log(`Reusing the project branch left by an earlier attempt in: ${reused.join(", ")}`);
  }
  const adoptIn = new Set(reused);

  const tx = new Transaction();

  // The one file that makes this directory a governance workspace. Recorded before
  // anything runs so its disappearance can be REPORTED rather than discovered by
  // the next command, several minutes later, as "no gov workspace resolved" (#191).
  const orgConfigPath = path.join(config.govHome, "org-config.yaml");
  const orgConfigWasThere = deps.fs.pathExists(orgConfigPath);

  try {
    // ── Phase A: home stub commit (local; pushed in D) ────────────────────────
    log(`Phase A: home stub projects/${projectId}/`);
    const preSha = deps.vcs.headSha(config.govHome);
    // UNDO WITHOUT `reset --hard`, and without `clean` (#191).
    //
    // Both were pointed at `config.govHome` — the resolved workspace itself, not a
    // scratch copy — and they are the two git commands that destroy work rather
    // than move pointers. A seed that failed in Phase C therefore left an adopter
    // with a workspace that no longer resolved: `org-config.yaml` is written by
    // `gov setup` and committed by the human, so between those two moments it is an
    // untracked file sitting in the blast radius.
    //
    // The invariant: undoing a PROJECT may touch `projects/<id>/` and that project's
    // worktrees. It may not touch anything that makes the workspace resolvable.
    //
    // `reset --mixed` un-commits and unstages while leaving every file on disk; the
    // one path this phase created is then removed by name. Nothing else is reachable.
    tx.onRollback("reset home", () => {
      deps.vcs.resetKeepingFiles(config.govHome, preSha);
      deps.fs.rm(paths.homeStub);
    });
    deps.fs.writeFile(
      path.join(paths.homeStub, ".gitkeep"),
      gitkeepStub({ projectId, branch, boardNumber: ref.number, defaultBranch: config.defaultBranch }),
    );
    deps.vcs.addPath(config.govHome, `projects/${projectId}/.gitkeep`);
    deps.vcs.commit(config.govHome, `seed: scaffold project folder for ${projectId} (GitHub #${ref.number})`);

    // ── Phase B: gov worktree on the project branch ───────────────────────────
    log("Phase B: gov worktree");
    tx.step("mkdir workRoot", () => deps.fs.mkdirp(paths.projectWorkRoot), () => deps.fs.rm(paths.projectWorkRoot));
    tx.step(
      "gov worktree",
      () => deps.vcs.worktreeAdd(config.govHome, branch, orgGovClone, config.defaultBranch),
      () => {
        deps.vcs.worktreeRemove(config.govHome, orgGovClone);
        deps.vcs.branchDelete(config.govHome, branch);
      },
    );
    if (input.identity) deps.vcs.setIdentity(orgGovClone, input.identity);

    // ── Phase B.1: scaffold authored content (agent.md/todo/tool-files) ───────
    // No project.yaml — GitHub is the sole source of truth (SDD-012, model A).
    log("Phase B.1: scaffold content");
    deps.fs.rm(path.join(projectDir, ".gitkeep")); // replacing the stub with real content
    deps.fs.writeFile(
      path.join(projectDir, "agent.md"),
      renderAgentMd({
        title: board.title,
        projectId,
        branch,
        projectWorkRoot: paths.projectWorkRoot,
        workspaceRepo: config.workspaceRepo,
        agentWorkRoot: config.agentWorkRoot,
        githubProjectUrl: input.boardUrl,
        defaultBranch: config.defaultBranch,
        repos: codeRepoUrls.map((url) => ({ name: repoNameFromUrl(url), url })),
      }),
    );
    const todoTemplate = deps.fs.readFile(
      path.join(orgGovClone, "framework", "knowledge", "guidance", "todo-template.md"),
    );
    if (todoTemplate !== null) {
      deps.fs.writeFile(path.join(projectDir, "knowledge", "todo.md"), renderTodoMd(todoTemplate, projectId));
    }
    const tokens = { ...config.orgTokens, PROJECT_ID: projectId };
    for (const rel of config.toolFiles ?? []) {
      const src = deps.fs.readFile(path.join(orgGovClone, "framework", rel));
      if (src !== null) deps.fs.writeFile(path.join(projectDir, rel), substituteTokens(src, tokens));
    }
    deps.vcs.addPath(orgGovClone, `projects/${projectId}`);
    deps.vcs.commit(orgGovClone, `seed: scaffold project content for ${projectId}`);

    // ── Phase C: code-repo worktrees ──────────────────────────────────────────
    log(`Phase C: ${codeRepoUrls.length} code repo(s)`);
    const repos = codeRepoUrls.map((url) => {
      const { repoDir } = setupCodeRepoWorktree(
        { vcs: deps.vcs, fs: deps.fs, tx, cloneRepo: deps.cloneRepo },
        {
          url,
          adoptExisting: adoptIn.has(url),
          baseBranch: input.repoBases?.[url] ?? config.defaultCodeBranch,
          projectBranch: branch,
          agentWorkRoot: config.agentWorkRoot,
          projectWorkRoot: paths.projectWorkRoot,
          remote,
          identity: input.identity,
        },
      );
      return { name: repoNameFromUrl(url), url, repoDir };
    });

    // ── Phase D: push ─────────────────────────────────────────────────────────
    log("Phase D: push");
    tx.step(
      "push gov branch",
      () => deps.vcs.push(orgGovClone, remote, branch, { setUpstream: true }),
      () => deps.vcs.pushDelete(orgGovClone, remote, branch),
    );
    // The home default-branch push (the stub commit) is not compensated — the
    // default branch cannot be deleted, and it is shared.
    deps.vcs.push(config.govHome, remote, config.defaultBranch);

    // ── Anchor issue (best-effort; not transactional) ─────────────────────────
    const anchorRef = deps.anchor.createAnchorIssue({
      boardNumber: ref.number,
      title: board.title,
      owner: ref.owner,
      workspaceRepo: config.workspaceRepo,
      assigneeLogin: input.seederLogin ?? null,
    });

    tx.commit();
    // Make an agent launched at the project ROOT run session-start: mirror the harness + drop the Claude
    // SessionStart hook. Best-effort finalization — the workspace worktree (with the rendered harness) is
    // present by now. Same helper the interactive Work flow uses.
    ensureRootProtocol(deps.fs, paths.projectWorkRoot, config.workspaceRepo);
    return { ok: true, projectId, branch, projectWorkRoot: paths.projectWorkRoot, orgGovClone, repos, anchorRef };
  } catch (error) {
    const rollbackFailures = tx.rollback();
    // A rollback that leaves the workspace unresolvable is a bigger event than the
    // failure that triggered it, and it used to be silent: the reader was told the
    // seed failed, and found out about the workspace on their next command, phrased
    // as though they had never had one.
    const lostOrgConfig = orgConfigWasThere && !deps.fs.pathExists(orgConfigPath);
    const message = lostOrgConfig
      ? `${(error as Error).message}\n\n` +
        `AND THE ROLLBACK DAMAGED THE WORKSPACE: ${orgConfigPath} is gone.\n` +
        "  That file is what makes this directory a governance workspace, so gov will\n" +
        "  now report 'no gov workspace resolved' even though the workspace is registered.\n" +
        "  Restore it with:  git -C " + config.govHome + " checkout -- org-config.yaml\n" +
        "  or, if it was never committed:  cd " + config.govHome + " && gov setup\n" +
        "  Please report this — a project's rollback must never un-configure the org."
      : (error as Error).message;
    return {
      ok: false,
      code: 1,
      reason: lostOrgConfig ? "rollback-damaged-workspace" : "seed-failed",
      message,
      rollbackFailures,
    };
  }
}
