// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Pure content generators for seed (SDD Part B, phase B.1) — the *authored
 * content* scaffold: agent.md (the project entrypoint), todo.md, and tool-file
 * token substitution. Replaces the bash heredocs + `perl` pass with typed Node.
 *
 * NOTE (SDD-012, model A): there is **no `project.yaml`** — GitHub is the sole
 * source of truth (board + anchor issue + linked items). We only generate
 * repo-committed *content*, never machine state.
 */
/** Render the project-specific agent.md entrypoint (faithful to seed.sh). */
export function renderAgentMd(p) {
    const repoLinesInside = p.repos
        .map((r) => `- \`${r.name}/\` — clone of ${r.url} on branch \`${p.branch}\`. Code changes go here.`)
        .join("\n");
    return `# ${p.title} — Project Agent Entry Point
# Project: ${p.projectId}  |  Branch: ${p.branch}

This file is the project-specific entrypoint. Combined with the framework's
universal session-start protocol (CLAUDE.md / AGENTS.md / etc. at repo root),
it tells you everything you need to start work on ${p.projectId}.

## Working Directory

Your per-project workspace lives at:

    ${p.projectWorkRoot}/

Inside it:

- \`${p.workspaceRepo}/\` — clone of ORG GOVERNANCE on branch \`${p.branch}\`. This is where
  you are right now. \`projects/${p.projectId}/\` here is your project metadata workspace.
${repoLinesInside}

## Knowledge Layer Priority

1. **Org-wide knowledge** → \`${p.workspaceRepo}/knowledge/\` (read-only this project)
2. **This project** → \`${p.workspaceRepo}/projects/${p.projectId}/knowledge/\`
3. **Repo-local** → \`<repo>/knowledge/\` in each cloned code repo
4. **Your developer preferences** → \`${p.agentWorkRoot}/preferences/<your-gh-login>.md\`
   - At session start, run \`gh api user --jq .login\` to determine your handle.
   - Load only the file matching your handle.

## Session Start Checklist (C01)

1. Verify you are authorized: you have **write access to this project's linked
   GitHub Project** (the authoritative gate — GitHub is the source of truth).
2. Confirm the project is active: its **board is open** (a \`paused\`/\`cancelled\`
   label on the anchor issue drives derived status). There is no \`project.yaml\`.
3. Read \`projects/${p.projectId}/knowledge/todo.md\` and surface \`## Open\` items.
4. Load all four knowledge layers fresh.

## Operational Workflow

1. Pick an issue from the GitHub Project board: ${p.githubProjectUrl}
2. Start a task sub-branch: \`./prj task <issue-url>\`
3. Do code work in the cloned code repos on the task sub-branch.
4. When the task is complete: \`./prj merge\`.
5. When the whole project is complete: \`./prj close\`.

## Do Not

- Never hand-manage task state — tasks are GitHub Issues on the board.
- Create GitHub Issues unilaterally — those are humans-only.
- Touch \`${p.workspaceRepo}/knowledge/\` — read-only this project.
- Push the project branch from the home ORG GOVERNANCE checkout — that
  checkout stays on ${p.defaultBranch}.
`;
}
/** Substitute a todo.md template's `PRJ-NNN-<slug>` header placeholder. */
export function renderTodoMd(template, projectId) {
    return template.split("PRJ-NNN-<slug>").join(projectId);
}
/**
 * Substitute `<TOKEN>` placeholders in a tool file's text (replaces the bash
 * `perl` pass). Each key maps a token name to its value; e.g. `{ ORG_NAME: "Svayam" }`
 * replaces every `<ORG_NAME>`. Longer token names are applied first so a token
 * that is a prefix of another can't partially match.
 */
export function substituteTokens(text, tokens) {
    let out = text;
    for (const key of Object.keys(tokens).sort((a, b) => b.length - a.length)) {
        out = out.split(`<${key}>`).join(tokens[key]);
    }
    return out;
}
