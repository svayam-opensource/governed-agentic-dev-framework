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
import { flagStr } from "./args.js";
import { seed } from "../lifecycle/seed.js";
import { task } from "../lifecycle/task-run.js";
import { merge } from "../lifecycle/merge.js";
import { close } from "../lifecycle/close.js";
import { sync } from "../lifecycle/sync.js";
import { addRepo } from "../lifecycle/add-repo.js";
import { join } from "../lifecycle/join.js";
import { pause, resume, cancel } from "../lifecycle/state.js";
import { orgAdd, orgUse, orgList, orgRemove } from "../resolve/org.js";
import { expandTilde } from "../resolve/node-env.js";
import { manageList, manageAssign, formatOwnerRows, anchorShow, projectStatus } from "../lifecycle/manage.js";
import { proposeKnowledge, submitKnowledge, archiveKnowledge } from "../lifecycle/knowledge.js";
import { onboard } from "../lifecycle/onboard.js";
/** Tool files seed token-substitutes into the project (bash TOOL_FILES). */
export const TOOL_FILES = [
    "AGENTS.md", "CONVENTIONS.md", ".cursor/rules/agent.mdc", ".clinerules/agent.md",
    ".windsurf/rules/agent.md", ".github/copilot-instructions.md", ".gemini/styleguide.md",
    ".continue/rules.md", "CLAUDE.md",
];
const usage = (spec) => ({ code: 2, lines: [`usage: gov-work ${spec}`] });
/** Render a PAGINATED project list: "<header> (X–Y of TOTAL):" + rows + a next-page hint when there's more. */
function pagedListLines(header, cmd, res, page, limit) {
    const to = res.offset + res.rows.length;
    const from = res.total === 0 ? 0 : res.offset + 1;
    const lines = [`${header} (${from}–${to} of ${res.total}):`, ...formatOwnerRows(res.rows)];
    if (to < res.total)
        lines.push(`  … more — next: gov-work ${cmd} --page ${page + 1}${limit !== 20 ? ` --limit ${limit}` : ""}`);
    return lines;
}
/**
 * Route `prj org …` — the multi-home registry commands. Handled SEPARATELY from
 * {@link route} because they run WITHOUT a resolved workspace (`gov-work org add` is
 * the bootstrap that makes resolution work).
 */
export function routeOrg(positionals, deps) {
    const [sub, ...rest] = positionals;
    const toResult = (r) => r.ok ? { code: 0, lines: r.lines } : { code: r.code, lines: [r.message] };
    switch (sub) {
        case "add":
            if (rest.length < 2)
                return usage("org add <github_org> <home-path>");
            return toResult(orgAdd(deps, rest[0], path.resolve(expandTilde(rest[1]))));
        case "use":
            if (rest.length < 1)
                return usage("org use <github_org>");
            return toResult(orgUse(deps, rest[0]));
        case "list":
            return toResult(orgList(deps));
        case "remove":
            if (rest.length < 1)
                return usage("org remove <github_org>");
            return toResult(orgRemove(deps, rest[0]));
        default:
            return usage("org <add|use|list|remove> …");
    }
}
/** Route a parsed command to its orchestrator; returns an exit code + output. */
export function route(parsed, ctx) {
    const { command, positionals, flags } = parsed;
    const c = ctx.config;
    const projectWorkRoot = path.dirname(ctx.home);
    const ownerField = "organization";
    switch (command) {
        case "seed": {
            if (positionals.length < 1)
                return usage("seed <board-url> [assignee]");
            const r = seed({ board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, anchor: ctx.anchor, cloneRepo: ctx.cloneRepo, log: ctx.log }, {
                govHome: ctx.home,
                workspaceRepo: c.workspaceRepo,
                agentWorkRoot: c.agentWorkRoot,
                defaultBranch: c.defaultBranch,
                defaultCodeBranch: c.defaultCodeBranch,
                githubOrg: c.githubOrg,
                orgTokens: c.orgTokens,
                toolFiles: [...TOOL_FILES],
            }, {
                boardUrl: positionals[0],
                assignee: positionals[1] ?? ctx.seededBy,
                seededBy: ctx.seededBy,
                today: ctx.today,
                identity: ctx.identity,
                seederLogin: flagStr(flags, "login") ?? ctx.login ?? null,
            });
            return r.ok
                ? { code: 0, lines: [`Project ${r.projectId} seeded on ${r.branch}`, `  workspace: ${r.projectWorkRoot}`, `  anchor: ${r.anchorRef ?? "(none — designate with prj manage)"}`] }
                : { code: r.code, lines: [r.message] };
        }
        case "task": {
            if (positionals.length < 1)
                return usage("task <issue-url[,issue-url...]>");
            const r = task({ board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, { govClone: ctx.home, projectWorkRoot, issueUrls: positionals[0].split(","), assignee: flagStr(flags, "assignee") ?? ctx.login ?? ctx.seededBy });
            return r.ok
                ? { code: 0, lines: [`Task ${r.taskId}`, `  branched: ${r.reposBranched.length} repo(s)`, ...(r.reposSkipped.length ? [`  skipped (not cloned): ${r.reposSkipped.join(", ")}`] : [])] }
                : { code: r.code, lines: [r.message] };
        }
        case "merge": {
            if (positionals.length < 1)
                return usage("merge <issue-url | task-branch>");
            const r = merge({ board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, { govClone: ctx.home, projectWorkRoot, taskArg: positionals[0] });
            return r.ok
                ? { code: 0, lines: [`Merged ${r.taskId} → ${r.projectBranch}`, `  closed issue(s): ${r.issueUrls.length}`] }
                : { code: r.code, lines: [r.message] };
        }
        case "close": {
            const r = close({ board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, issues: ctx.issues, pulls: ctx.pulls, authorize: ctx.authorize, gate: ctx.gate, log: ctx.log }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, defaultBranch: c.defaultBranch, defaultCodeBranch: c.defaultCodeBranch }, { govClone: ctx.home, projectWorkRoot, today: ctx.today });
            return r.ok
                ? { code: 0, lines: [`Project ${r.projectId} closed`, `  PR: ${r.prUrl ?? "(merged)"}`] }
                : { code: r.code, lines: [r.message, ...(r.failures ?? [])] };
        }
        case "sync": {
            const r = sync({ board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, authorize: ctx.authorize, log: ctx.log }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, defaultBranch: c.defaultBranch, defaultCodeBranch: c.defaultCodeBranch }, { govClone: ctx.home, projectWorkRoot });
            return r.ok
                ? { code: 0, lines: [`Synced ${r.projectBranch}`, `  ${r.synced.length} repo(s) up to date`] }
                : { code: r.code, lines: [r.message] };
        }
        case "join": {
            if (positionals.length < 1)
                return usage("join <board-url>");
            const r = join({ board: ctx.board, vcs: ctx.vcs, fs: ctx.fs, cloneRepo: ctx.cloneRepo, authorize: ctx.authorize, log: ctx.log }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo, orgRepoUrl: c.orgRepoUrl, agentWorkRoot: c.agentWorkRoot }, { boardUrl: positionals[0], identity: ctx.identity });
            return r.ok
                ? { code: 0, lines: [`Joined ${r.projectId} on ${r.branch}`, `  workspace: ${r.orgGovClone}`, `  code repos: ${r.repos.length}`] }
                : { code: r.code, lines: [r.message] };
        }
        case "add-repo": {
            if (positionals.length < 1)
                return usage("add-repo <repo-url> [base-branch]");
            const r = addRepo({ vcs: ctx.vcs, fs: ctx.fs, cloneRepo: ctx.cloneRepo, authorize: ctx.authorize, log: ctx.log }, { githubOrg: c.githubOrg, ownerField, agentWorkRoot: c.agentWorkRoot, defaultCodeBranch: c.defaultCodeBranch }, { govClone: ctx.home, projectWorkRoot, repoUrl: positionals[0], baseBranch: positionals[1], identity: ctx.identity });
            return r.ok
                ? { code: 0, lines: [`Added ${r.repoDir} on ${r.projectBranch}`] }
                : { code: r.code, lines: [r.message] };
        }
        case "list":
        case "list-all": {
            const limit = Number(flagStr(flags, "limit") ?? 20);
            const page = Math.max(1, Number(flagStr(flags, "page") ?? 1));
            const res = manageList({ projects: ctx.projects, anchor: ctx.anchor }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, command === "list-all", limit, (page - 1) * limit);
            return { code: 0, lines: pagedListLines(command === "list-all" ? "All projects" : "Ongoing projects", command, res, page, limit) };
        }
        case "status": {
            const r = projectStatus({ vcs: ctx.vcs, projects: ctx.projects, anchor: ctx.anchor }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, ctx.home);
            return r.ok
                ? { code: 0, lines: [`Project #${r.boardNumber}: ${r.title}`, `  status: ${r.status}`, `  owners: ${r.owners.join(", ") || "(none)"}`, `  board:  ${r.url}`] }
                : { code: r.code, lines: [r.message] };
        }
        case "manage": {
            const sub = positionals[0];
            const mcfg = { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo };
            if (sub === "list" || sub === "list-all") {
                const limit = Number(flagStr(flags, "limit") ?? 20);
                const page = Math.max(1, Number(flagStr(flags, "page") ?? 1));
                const res = manageList({ projects: ctx.projects, anchor: ctx.anchor }, mcfg, sub === "list-all", limit, (page - 1) * limit);
                return { code: 0, lines: pagedListLines("Projects (owners = anchor assignees)", `manage ${sub}`, res, page, limit) };
            }
            if (sub === "assign" || sub === "unassign") {
                if (positionals.length < 2)
                    return usage(`manage ${sub} <github-login>`);
                const r = manageAssign({ vcs: ctx.vcs, anchor: ctx.anchor }, mcfg, ctx.home, positionals[1], sub === "assign" ? "add" : "remove");
                return r.ok
                    ? { code: 0, lines: [`${r.action === "add" ? "Added" : "Removed"} owner ${r.login}${r.applied ? "" : " (not applied — check gh access)"}`] }
                    : { code: r.code, lines: [r.message] };
            }
            return usage("manage <list|list-all|assign|unassign> …");
        }
        case "onboard": {
            if (positionals.length < 3)
                return usage("onboard <repo-url> <owner> <description>");
            const r = onboard({ vcs: ctx.vcs, fs: ctx.fs, pulls: ctx.pulls, cloneRepo: ctx.cloneRepo, log: ctx.log }, { agentWorkRoot: c.agentWorkRoot, workspaceRepo: c.workspaceRepo, orgName: c.orgName }, { repoUrl: positionals[0], owner: positionals[1], description: positionals.slice(2).join(" ") });
            return r.ok ? { code: 0, lines: r.lines } : { code: r.code, lines: [r.message] };
        }
        case "knowledge": {
            const sub = positionals[0];
            const kcfg = { defaultBranch: c.defaultBranch, githubOrg: c.githubOrg, workspaceRepo: c.workspaceRepo };
            const r = sub === "propose" ? proposeKnowledge(ctx.vcs, kcfg, ctx.home, positionals[1])
                : sub === "submit" ? submitKnowledge(ctx.pulls, kcfg, positionals[1], positionals.slice(2).join(" "))
                    : sub === "archive" ? archiveKnowledge(ctx.vcs, kcfg, ctx.home, positionals[1])
                        : null;
            if (r === null)
                return usage("knowledge <propose|submit|archive> <slug> [description]");
            return r.ok ? { code: 0, lines: r.lines } : { code: r.code, lines: [r.message] };
        }
        case "anchor": {
            const r = anchorShow({ vcs: ctx.vcs, anchor: ctx.anchor }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, ctx.home);
            return r.ok
                ? { code: 0, lines: [`Anchor #${r.number}: ${r.url}`, `  labels: ${r.labels.join(", ") || "(none)"}`, `  owners: ${r.owners.join(", ") || "(none)"}`] }
                : { code: r.code, lines: [r.message] };
        }
        case "pause":
        case "resume":
        case "cancel": {
            const fn = command === "pause" ? pause : command === "resume" ? resume : cancel;
            const r = fn({ vcs: ctx.vcs, anchor: ctx.anchor, issues: ctx.issues, authorize: ctx.authorize, log: ctx.log }, { githubOrg: c.githubOrg, ownerField, workspaceRepo: c.workspaceRepo }, { govClone: ctx.home });
            return r.ok
                ? { code: 0, lines: [`Project #${r.boardNumber} → ${r.status}${r.applied ? "" : " (anchor label not applied — check gh access)"}`] }
                : { code: r.code, lines: [r.message] };
        }
        default:
            return {
                code: 2,
                lines: [
                    `unknown command '${command}'`,
                    "bootstrap: setup org",
                    "lifecycle: seed join task merge sync add-repo close pause resume cancel",
                    "info+owners: list list-all status manage anchor validate",
                    "repo+knowledge+org: onboard knowledge org",
                    "maintain: bump-version doctor deps publish upgrade",
                ],
            };
    }
}
