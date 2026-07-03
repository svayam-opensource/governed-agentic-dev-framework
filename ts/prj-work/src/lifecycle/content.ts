// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Pure content generators for seed (SDD Part B, phase B.1): project.yaml,
 * agent.md, todo.md, and tool-file token substitution. This replaces the bash
 * heredocs + `perl` token substitution with typed, testable Node — no perl/yq.
 * Output is faithful to the bash seed (double-quoted string scalars, `~` nulls).
 */

/**
 * Quote a string as a YAML double-quoted scalar, injection-safe. Escape the
 * backslash FIRST, then the double-quote, so a value ending in `\` (e.g. a
 * hostile GitHub Project title) cannot escape the closing quote (seed.sh C10).
 */
export function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A `repos[]` entry in project.yaml. */
export interface RepoEntry {
  readonly url: string | null;
  readonly role: string;
  readonly base_branch: string;
  readonly added_at: string | null;
  readonly added_reason: string | null;
}

/** The typed project manifest rendered into project.yaml. */
export interface ProjectManifest {
  readonly id: string;
  readonly slug: string;
  readonly branch: string;
  readonly description: string | null;
  readonly github_project: string;
  readonly github_project_name: string;
  readonly assigned_to: string;
  readonly seeded_by: string;
  readonly status: string;
  readonly created_at: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly paused_at: string | null;
  readonly cancelled_at: string | null;
  readonly cancellation_reason: string | null;
  readonly repos: readonly RepoEntry[];
  readonly knowledge_status: string | null;
  readonly knowledge_pr: string | null;
  readonly agent_config: { readonly model: string; readonly provider: string };
}

/** `~` for null, else a bare (unquoted) date/enum literal. */
const bare = (v: string | null): string => (v === null ? "~" : v);
/** `~` for null, else a double-quoted string scalar. */
const quoted = (v: string | null): string => (v === null ? "~" : yamlQuote(v));

/** Render the `repos:` block body (unquoted scalars, matching the bash seed). */
export function renderReposBlock(repos: readonly RepoEntry[], defaultCodeBranch: string): string {
  const list = repos.length
    ? repos
    : [{ url: null, role: "primary", base_branch: defaultCodeBranch, added_at: null, added_reason: null }];
  return list
    .map((r) =>
      [
        `  - url: ${bare(r.url)}`,
        `    role: ${r.role}`,
        `    base_branch: ${r.base_branch}`,
        `    added_at: ${bare(r.added_at)}`,
        `    added_reason: ${bare(r.added_reason)}`,
      ].join("\n"),
    )
    .join("\n");
}

/** Render project.yaml from a manifest (field order matches the live files). */
export function renderProjectYaml(m: ProjectManifest, defaultCodeBranch: string): string {
  return (
    [
      `id: ${yamlQuote(m.id)}`,
      `slug: ${yamlQuote(m.slug)}`,
      `branch: ${yamlQuote(m.branch)}`,
      `description: ${quoted(m.description)}`,
      `github_project: ${yamlQuote(m.github_project)}`,
      `github_project_name: ${yamlQuote(m.github_project_name)}`,
      `assigned_to: ${yamlQuote(m.assigned_to)}`,
      `seeded_by: ${yamlQuote(m.seeded_by)}`,
      `status: ${m.status}`,
      `created_at: ${m.created_at}`,
      `started_at: ${m.started_at}`,
      `completed_at: ${bare(m.completed_at)}`,
      `paused_at: ${bare(m.paused_at)}`,
      `cancelled_at: ${bare(m.cancelled_at)}`,
      `cancellation_reason: ${quoted(m.cancellation_reason)}`,
      `repos:`,
      renderReposBlock(m.repos, defaultCodeBranch),
      `knowledge_status: ${bare(m.knowledge_status)}`,
      `knowledge_pr: ${bare(m.knowledge_pr)}`,
      `agent_config:`,
      `  model: ${m.agent_config.model}`,
      `  provider: ${m.agent_config.provider}`,
    ].join("\n") + "\n"
  );
}

/** Inputs for the project agent.md entrypoint. */
export interface AgentMdParams {
  readonly title: string;
  readonly projectId: string;
  readonly branch: string;
  readonly projectWorkRoot: string;
  readonly workspaceRepo: string;
  readonly agentWorkRoot: string;
  readonly githubProjectUrl: string;
  readonly defaultBranch: string;
  /** Linked code repos: {name, url}. */
  readonly repos: ReadonlyArray<{ name: string; url: string }>;
}

/** Render the project-specific agent.md entrypoint (faithful to seed.sh). */
export function renderAgentMd(p: AgentMdParams): string {
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
   GitHub Project** (the authorization source of truth). \`assigned_to\` in
   \`project.yaml\` is a display cache, not the gate.
2. Verify \`status: active\` in \`project.yaml\`.
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
export function renderTodoMd(template: string, projectId: string): string {
  return template.split("PRJ-NNN-<slug>").join(projectId);
}

/**
 * Substitute `<TOKEN>` placeholders in a tool file's text (replaces the bash
 * `perl` pass). Each key maps a token name to its value; e.g. `{ ORG_NAME: "Svayam" }`
 * replaces every `<ORG_NAME>`. Longer token names are applied first so a token
 * that is a prefix of another can't partially match.
 */
export function substituteTokens(text: string, tokens: Readonly<Record<string, string>>): string {
  let out = text;
  for (const key of Object.keys(tokens).sort((a, b) => b.length - a.length)) {
    out = out.split(`<${key}>`).join(tokens[key]);
  }
  return out;
}
