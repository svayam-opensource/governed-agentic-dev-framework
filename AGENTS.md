# Agent Session-Start Protocol — {{ORG_NAME}}

This file is the **OpenAI Codex / `AGENTS.md`** entrypoint for any AI coding agent working in this workspace. Equivalent files exist for other tools at their conventional paths (`CLAUDE.md`, `.cursor/rules/agent.mdc`, `CONVENTIONS.md`, etc.) — they all restate this same protocol.

Before you change any code, complete the steps below.

## 1. Load four knowledge layers — fresh every session

Read these in priority order (highest first). Never use cached layers from a prior session:

1. **Org-wide knowledge** — `knowledge/` in this repo, from the `{{DEFAULT_BRANCH}}` branch.
2. **Active project** — `projects/<PROJECT_ID>/knowledge/` plus the project's own entrypoint at `projects/<PROJECT_ID>/agent.md`. To determine the active `PROJECT_ID`: check `registry.yaml` for entries with `status: active`, and check the current git branch (project branches are named `{{org_slug}}-NNN-slug`).
3. **Repo-local** — `<repo>/knowledge/` for each linked code repo at `$PRJ_GOV_LOC/projects/<PROJECT_ID>/repos/<repo-name>/`.
4. **Your developer preferences** — `$PRJ_GOV_LOC/preferences/<your-gh-login>.md`. Run `gh api user --jq .login` to determine your handle; load **only** your file. Other files in that directory belong to other developers — do not read them.

Higher layers always win. Developer preferences cannot override repo-local or org-wide knowledge.

## 2. Verify project state (C01 — hard stops)

If a project is active:

- `project.yaml`'s `assigned_to` must match the current user identity.
- `project.yaml`'s `status` must be `active`.
- Read `projects/<PROJECT_ID>/knowledge/todo.md` and surface its `## Open` items to the developer before planning new work.

If any of these can't be verified, hard-stop and surface to the human. Do not commit anything.

## 3. What's writable, what's not

During an active project:

- ✅ Writable: `projects/<PROJECT_ID>/` (workspace repo) and code on the project branch in cloned repos under `$PRJ_GOV_LOC/projects/<PROJECT_ID>/`.
- ❌ Read-only: `{{WORKSPACE_REPO}}/knowledge/` — never edit during an active project.
- ❌ Never hand-manage task state — tasks are GitHub Issues on the board (open = active, closed = done); create with `./prj task`, land with `./prj merge`.
- ❌ Don't create GitHub Issues unilaterally — those represent business intent that humans add to the GitHub Project board.

## 4. Where work happens

- Code repos are cloned at `$PRJ_GOV_LOC/projects/<PROJECT_ID>/repos/<repo-name>/`, each on the project branch.
- Code changes go in those cloned repos — **NOT** in the workspace repo's tree.
- Project metadata (knowledge, decisions, to-dos) goes in `projects/<PROJECT_ID>/` in the workspace repo.

## 5. During work

- Capture decisions, exceptions, and policy notes in `projects/<PROJECT_ID>/knowledge/` as you make them — not at session end.
- Capture intermediate to-dos in `projects/<PROJECT_ID>/knowledge/todo.md` under `## Open` as they arise.
- When an item from `todo.md` is resolved, move it to `## Done` with a short note (commit SHA, PR link, or one-line outcome).

---

For the canonical, full version of this protocol and the policy that governs it:

- **`docs/DEVELOPER_GUIDE.md`** — step-by-step session walkthrough with example prompts.
- **`knowledge/policies/agentic-development-policy.md`** — full policy text. POL-113 through POL-171 govern session protocol.

Per-project specifics (the actual `<PROJECT_ID>`, paths, GitHub Project URL, etc.) are filled in at `projects/<PROJECT_ID>/agent.md` once the project is seeded — that file is your project-specific entrypoint.
