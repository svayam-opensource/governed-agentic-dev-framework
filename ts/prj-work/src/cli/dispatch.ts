// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `prj` command router — maps a parsed command to its lifecycle orchestrator,
 * building each command's config/input from the assembled {@link CliContext} +
 * argv. Model A (SDD-012): project context comes from the resolved workspace +
 * GitHub, never a state file. Pure over the injected ports, so it's fully testable.
 *
 * Context asymmetry: `seed` runs from the gov HOME (creates the workspace);
 * task/merge/close/pause/resume/cancel run from WITHIN the project workspace
 * (ctx.home is the project clone; projectWorkRoot is its parent).
 */
import * as path from "node:path";
import { type ParsedArgs, flagStr } from "./args.js";
import type { OrgConfig } from "../config/org-config.js";
import type { Board } from "../lifecycle/board.js";
import type { Vcs } from "../lifecycle/vcs.js";
import type { Fs } from "../lifecycle/fs-io.js";
import type { Issues } from "../lifecycle/issues.js";
import type { AnchorCreator } from "../lifecycle/anchor.js";
import type { Pulls } from "../lifecycle/pulls.js";
import type { BoardRef } from "../lifecycle/identity.js";
import type { GateResult } from "../lifecycle/close-gate.js";
import { seed } from "../lifecycle/seed.js";
import { task } from "../lifecycle/task-run.js";
import { merge } from "../lifecycle/merge.js";
import { close } from "../lifecycle/close.js";
import { sync } from "../lifecycle/sync.js";
import { addRepo } from "../lifecycle/add-repo.js";
import { join } from "../lifecycle/join.js";
import { pause, resume, cancel } from "../lifecycle/state.js";
import { orgAdd, orgUse, orgList, orgRemove, type OrgDeps } from "../resolve/org.js";
import { expandTilde } from "../resolve/node-env.js";

/** Tool files seed token-substitutes into the project (bash TOOL_FILES). */
export const TOOL_FILES = [
  "AGENTS.md", "CONVENTIONS.md", ".cursor/rules/agent.mdc", ".clinerules/agent.md",
  ".windsurf/rules/agent.md", ".github/copilot-instructions.md", ".gemini/styleguide.md",
  ".continue/rules.md", "CLAUDE.md",
] as const;

/** Everything the router needs: config, the resolved workspace, identity + ports. */
export interface CliContext {
  readonly config: OrgConfig;
  /** The resolved gov workspace — the gov HOME for seed, else the project clone. */
  readonly home: string;
  readonly today: string;
  /** The current user's git email — recorded as seeded_by. */
  readonly seededBy: string;
  /** The current user's gh login — the default issue assignee / anchor assignee. */
  readonly login?: string;
  readonly identity?: { name?: string; email?: string };
  readonly board: Board;
  readonly vcs: Vcs;
  readonly fs: Fs;
  readonly issues: Issues;
  readonly anchor: AnchorCreator;
  readonly pulls: Pulls;
  readonly cloneRepo: (url: string, dest: string) => void;
  readonly authorize?: (ref: BoardRef) => boolean;
  /** close's test-merge gate (wire governance.runSuite here). */
  readonly gate?: () => GateResult;
  readonly log?: (msg: string) => void;
}

export interface CommandResult {
  readonly code: number;
  readonly lines: readonly string[];
}

const usage = (spec: string): CommandResult => ({ code: 2, lines: [`usage: prj ${spec}`] });

/**
 * Route `prj org …` — the multi-home registry commands. Handled SEPARATELY from
 * {@link route} because they run WITHOUT a resolved workspace (`prj org add` is
 * the bootstrap that makes resolution work).
 */
export function routeOrg(positionals: readonly string[], deps: OrgDeps): CommandResult {
  const [sub, ...rest] = positionals;
  const toResult = (r: ReturnType<typeof orgList>): CommandResult =>
    r.ok ? { code: 0, lines: r.lines } : { code: r.code, lines: [r.message] };
  switch (sub) {
    case "add":
      if (rest.length < 2) return usage("org add <github_org> <home-path>");
      return toResult(orgAdd(deps, rest[0], path.resolve(expandTilde(rest[1]))));
    case "use":
      if (rest.length < 1) return usage("org use <github_org>");
      return toResult(orgUse(deps, rest[0]));
    case "list":
      return toResult(orgList(deps));
    case "remove":
      if (rest.length < 1) return usage("org remove <github_org>");
      return toResult(orgRemove(deps, rest[0]));
    default:
      return usage("org <add|use|list|remove> …");
  }
}

/** Route a parsed command to its orchestrator; returns an exit code + output. */
export function route(parsed: ParsedArgs, ctx: CliContext): CommandResult {
  const { command, positionals, flags } = parsed;
  const c = ctx.config;
  const projectWorkRoot = path.dirname(ctx.home);
  const ownerField = "organization" as const;

  switch (command) {
    case "seed": {
      if (positionals.length < 1) return usage("seed <board-url> [assignee]");
      const r = seed(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, anchor: ctx.anchor, cloneRepo: ctx.cloneRepo, log: ctx.log },
        {
          govHome: ctx.home,
          workspaceRepo: c.workspaceRepo,
          agentWorkRoot: c.agentWorkRoot,
          defaultBranch: c.defaultBranch,
          defaultCodeBranch: c.defaultCodeBranch,
          githubOrg: c.githubOrg,
          orgTokens: c.orgTokens,
          toolFiles: [...TOOL_FILES],
        },
        {
          boardUrl: positionals[0],
          assignee: positionals[1] ?? ctx.seededBy,
          seededBy: ctx.seededBy,
          today: ctx.today,
          identity: ctx.identity,
          seederLogin: flagStr(flags, "login") ?? ctx.login ?? null,
        },
      );
      return r.ok
        ? { code: 0, lines: [`Project ${r.projectId} seeded on ${r.branch}`, `  workspace: ${r.projectWorkRoot}`, `  anchor: ${r.anchorRef ?? "(none — designate with prj manage)"}`] }
        : { code: r.code, lines: [r.message] };
    }

    case "task": {
      if (positionals.length < 1) return usage("task <issue-url[,issue-url...]>");
      const r = task(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo },
        { govClone: ctx.home, projectWorkRoot, issueUrls: positionals[0].split(","), assignee: flagStr(flags, "assignee") ?? ctx.login ?? ctx.seededBy },
      );
      return r.ok
        ? { code: 0, lines: [`Task ${r.taskId}`, `  branched: ${r.reposBranched.length} repo(s)`, ...(r.reposSkipped.length ? [`  skipped (not cloned): ${r.reposSkipped.join(", ")}`] : [])] }
        : { code: r.code, lines: [r.message] };
    }

    case "merge": {
      if (positionals.length < 1) return usage("merge <issue-url | task-branch>");
      const r = merge(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo },
        { govClone: ctx.home, projectWorkRoot, taskArg: positionals[0] },
      );
      return r.ok
        ? { code: 0, lines: [`Merged ${r.taskId} → ${r.projectBranch}`, `  closed issue(s): ${r.issueUrls.length}`] }
        : { code: r.code, lines: [r.message] };
    }

    case "close": {
      const r = close(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, pulls: ctx.pulls, authorize: ctx.authorize, gate: ctx.gate, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, defaultBranch: c.defaultBranch, defaultCodeBranch: c.defaultCodeBranch },
        { govClone: ctx.home, projectWorkRoot, today: ctx.today },
      );
      return r.ok
        ? { code: 0, lines: [`Project ${r.projectId} closed`, `  PR: ${r.prUrl ?? "(merged)"}`] }
        : { code: r.code, lines: [r.message, ...(r.failures ?? [])] };
    }

    case "sync": {
      const r = sync(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, defaultBranch: c.defaultBranch, defaultCodeBranch: c.defaultCodeBranch },
        { govClone: ctx.home, projectWorkRoot },
      );
      return r.ok
        ? { code: 0, lines: [`Synced ${r.projectBranch}`, `  ${r.synced.length} repo(s) up to date`] }
        : { code: r.code, lines: [r.message] };
    }

    case "join": {
      if (positionals.length < 1) return usage("join <board-url>");
      const r = join(
        { board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, cloneRepo: ctx.cloneRepo, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, orgRepoUrl: c.orgRepoUrl, agentWorkRoot: c.agentWorkRoot },
        { boardUrl: positionals[0], identity: ctx.identity },
      );
      return r.ok
        ? { code: 0, lines: [`Joined ${r.projectId} on ${r.branch}`, `  workspace: ${r.orgGovClone}`, `  code repos: ${r.repos.length}`] }
        : { code: r.code, lines: [r.message] };
    }

    case "add-repo": {
      if (positionals.length < 1) return usage("add-repo <repo-url> [base-branch]");
      const r = addRepo(
        { vcs: ctx.vcs, fs: ctx.fs, cloneRepo: ctx.cloneRepo, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, agentWorkRoot: c.agentWorkRoot, defaultCodeBranch: c.defaultCodeBranch },
        { govClone: ctx.home, projectWorkRoot, repoUrl: positionals[0], baseBranch: positionals[1], identity: ctx.identity },
      );
      return r.ok
        ? { code: 0, lines: [`Added ${r.repoDir} on ${r.projectBranch}`] }
        : { code: r.code, lines: [r.message] };
    }

    case "pause":
    case "resume":
    case "cancel": {
      const fn = command === "pause" ? pause : command === "resume" ? resume : cancel;
      const r = fn(
        { vcs: ctx.vcs, anchor: ctx.anchor, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log },
        { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo },
        { govClone: ctx.home },
      );
      return r.ok
        ? { code: 0, lines: [`Project #${r.boardNumber} → ${r.status}${r.applied ? "" : " (anchor label not applied — check gh access)"}`] }
        : { code: r.code, lines: [r.message] };
    }

    default:
      return { code: 2, lines: [`unknown command '${command}'`, "commands: seed join task merge sync add-repo close pause resume cancel org"] };
  }
}
