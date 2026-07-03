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
import { deriveProjectIdentity, parseBoardUrl } from "./identity.js";
import { seedPathsFor, detectLeftovers, leftoversMessage, type LeftoverArtifact } from "./leftover.js";
import {
  renderProjectYaml,
  renderAgentMd,
  renderTodoMd,
  substituteTokens,
  type ProjectManifest,
  type RepoEntry,
} from "./content.js";
import { setupCodeRepoWorktree } from "./code-repo.js";
import { repoNameFromUrl } from "./repo.js";

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
# (Project #${i.boardNumber} + its 'anchor' issue), NOT in registry.yaml — GitHub
# is the sole source of truth (registry-elimination). The full project content
# (project.yaml, agent.md, knowledge/, etc.) lives on branch '${i.branch}'.
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
  const { projectId, branch, slug } = idr;
  const paths = seedPathsFor({ govHome: config.govHome, agentWorkRoot: config.agentWorkRoot, projectId, branch });
  const orgGovClone = path.join(paths.projectWorkRoot, config.workspaceRepo);
  const projectDir = path.join(orgGovClone, "projects", projectId);

  // ── Leftover-state guard ────────────────────────────────────────────────────
  const leftovers = detectLeftovers({ vcs: deps.vcs, fs: deps.fs }, paths);
  if (leftovers.length) {
    return { ok: false, code: 1, reason: "leftover-state", message: leftoversMessage(leftovers), leftovers };
  }

  const codeRepoUrls = board.repoUrls.filter((u) => repoNameFromUrl(u) !== config.workspaceRepo);
  const tx = new Transaction();

  try {
    // ── Phase A: home stub commit (local; pushed in D) ────────────────────────
    log(`Phase A: home stub projects/${projectId}/`);
    const preSha = deps.vcs.headSha(config.govHome);
    tx.onRollback("reset home", () => {
      deps.vcs.resetHard(config.govHome, preSha);
      deps.vcs.cleanUntracked(config.govHome, "projects");
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

    // ── Phase B.1: scaffold project content ───────────────────────────────────
    log("Phase B.1: scaffold content");
    deps.fs.rm(path.join(projectDir, ".gitkeep")); // replacing the stub with real content
    const repoEntries: RepoEntry[] = codeRepoUrls.map((url) => ({
      url,
      role: "primary",
      base_branch: input.repoBases?.[url] ?? config.defaultCodeBranch,
      added_at: input.today,
      added_reason: null,
    }));
    const manifest: ProjectManifest = {
      id: projectId,
      slug,
      branch,
      description: null,
      github_project: input.boardUrl,
      github_project_name: board.title,
      assigned_to: input.assignee,
      seeded_by: input.seededBy,
      status: "active",
      created_at: input.today,
      started_at: input.today,
      completed_at: null,
      paused_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      repos: repoEntries,
      knowledge_status: null,
      knowledge_pr: null,
      agent_config: { model: "auto", provider: "cursor" },
    };
    deps.fs.writeFile(path.join(projectDir, "project.yaml"), renderProjectYaml(manifest, config.defaultCodeBranch));
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
    return { ok: true, projectId, branch, projectWorkRoot: paths.projectWorkRoot, orgGovClone, repos, anchorRef };
  } catch (error) {
    const rollbackFailures = tx.rollback();
    return {
      ok: false,
      code: 1,
      reason: "seed-failed",
      message: (error as Error).message,
      rollbackFailures,
    };
  }
}
