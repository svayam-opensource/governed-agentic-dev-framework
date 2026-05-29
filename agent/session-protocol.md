# Agent Session-Start Protocol — {{ORG_NAME}}

This is the **canonical** session-start protocol for any AI coding agent working in this workspace. It is delivered to each tool at its conventional path (`CLAUDE.md`, `.cursor/rules/agent.mdc`, `AGENTS.md`, `CONVENTIONS.md`, …) by `scripts/render-harness.sh`, driven by `agent/harness-manifest.yaml`. **Edit the protocol here, then re-render — never hand-edit the generated copies** (they carry a "do not edit" banner).

## 0. New session — agent speaks first (Pattern 1)

**Applies to:** every new Cursor Agent/Chat session, every new `claude` invocation, and every new conversation after `/clear`.

When this protocol is loaded, your **first assistant message** in the session must run the C01 checklist (§1–§2 below) and post a **context manifest** — **before** planning work, proposing tasks, or editing files.

| Trigger | What you do |
|---|---|
| User's first message is a greeting, "start", "go", "ready", or session opener | Run §1–§2, post manifest, **stop and wait** |
| User's first message already contains a **specific work task** | Still run §1–§2 first; post a **short** manifest, then address the task |
| No active project (framework/contrib mode; no `active` entry in `registry.yaml`) | Post manifest stating no active project; load org layer + `agent.md` only; wait for direction |

**Do not** wait for the user to paste the kickoff prompt from `DEVELOPER_GUIDE.md` — that template is for humans; you execute the same steps proactively.

### Context manifest (required format)

Use this structure in your first reply:

```markdown
## Context manifest

- **Project:** <PROJECT_ID or "none">
- **Branch:** <current git branch>
- **Status / assigned_to:** <from project.yaml, or n/a>
- **Repos:** <primary repos from project.yaml, or n/a>
- **Open todos:** <bullets from todo.md ## Open, or "none">
- **Layers loaded:** org ✓/✗ · project ✓/✗ · repo ✓/✗ · prefs ✓/✗
- **Awaiting:** your direction (no tasks proposed)
```

After the manifest, **stop**. Do not propose implementation work unless the user's first message already asked for something specific — and even then, complete the manifest first.

---

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
