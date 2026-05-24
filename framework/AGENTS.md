# Agent Session-Start Protocol — <ORG_NAME>

This file is the **OpenAI Codex / `AGENTS.md`** entrypoint for any AI coding agent working in this workspace. Equivalent files exist for other tools at their conventional paths (`CLAUDE.md`, `.cursor/rules/agent.mdc`, `CONVENTIONS.md`, etc.) — they all restate this same protocol.

Before you change any code, complete the steps below.

## 1. Read `org-config.yaml` first — every framework file references its values

Read `org-config.yaml` at the workspace repo root before anything else. The framework ships with no org-specific values baked in; instead, files refer to org values via angle-bracketed tokens that map to keys in `org-config.yaml`:

| Token | Key in `org-config.yaml` |
| --- | --- |
| `<ORG_NAME>` | `org_name` |
| `<ORG_SHORT_NAME>` | `org_short_name` |
| `<ORG_SLUG>` | `org_slug` |
| `<org_slug>` (lowercase) | `org_slug_lower` |
| `<ORG_REPO_URL>` | `org_repo_url` |
| `<GITHUB_ORG>` | `github_org` |
| `<WORKSPACE_REPO>` | `workspace_repo` |
| `<DEFAULT_BRANCH>` | `default_branch` |
| `<DEFAULT_CODE_BRANCH>` | `default_code_branch` |
| `<AGENT_WORK_ROOT>` | `agent_work_root` |
| `<POLICY_OWNER_EMAIL>` | `policy_owner_email` |
| `<POLICY_OWNER_GITHUB>` | `policy_owner_github` |
| `<LEGAL_OWNER_GITHUB>` etc. | `legal_owner_github`, `infra_owner_github`, `system_arch_owner_github`, `data_arch_owner_github` |
| `<POLICY_EFFECTIVE_DATE>` | `policy_effective_date` |

Tokens like `<PROJECT_ID>`, `<repo-name>`, `<your-gh-login>` are per-session values you'll discover from the current branch, `registry.yaml`, and `gh api user`.

If `org-config.yaml` has empty values (`org_name: ""`), the workspace is still in TEMPLATE state. Hard-stop and tell the human to run `./setup.sh`.

## 2. Load four knowledge layers — fresh every session

Read these in priority order (highest first). Never use cached layers from a prior session:

1. **Org-wide knowledge** — `knowledge/` in this repo, from the `<DEFAULT_BRANCH>` branch.
2. **Active project** — `projects/<PROJECT_ID>/knowledge/` plus the project's own entrypoint at `projects/<PROJECT_ID>/agent.md`. To determine the active `PROJECT_ID`: check `registry.yaml` for entries with `status: active`, and check the current git branch (project branches are named `brnch-NNN-<slug>`).
3. **Repo-local** — `<repo>/knowledge/` for each linked code repo at `$AGENT_WORK_ROOT/<PROJECT_ID>/<repo-name>/`.
4. **Your developer preferences** — `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md`. Run `gh api user --jq .login` to determine your handle; load **only** your file. Other files in that directory belong to other developers — do not read them.

Higher layers always win. Developer preferences cannot override repo-local or org-wide knowledge.

## 3. Verify project state (C01 — hard stops)

If a project is active:

- `project.yaml`'s `locked_by` must match the current user identity.
- `project.yaml`'s `status` must be `active`.
- Read `projects/<PROJECT_ID>/knowledge/todo.md` and surface its `## Open` items to the developer before planning new work.

If any of these can't be verified, hard-stop and surface to the human. Do not commit anything.

## 4. What's writable, what's not

During an active project:

- ✅ Writable: `projects/<PROJECT_ID>/` (workspace repo) and code on the project branch in cloned repos under `$AGENT_WORK_ROOT/<PROJECT_ID>/`.
- ❌ Read-only: `<WORKSPACE_REPO>/knowledge/` — never edit during an active project.
- ❌ Don't edit `project.yaml`'s `tasks` list directly — use `./prj task` / `./prj merge`.
- ❌ Don't create GitHub Issues unilaterally — those represent business intent that humans add to the GitHub Project board.

## 5. Where work happens

- Code repos are cloned at `$AGENT_WORK_ROOT/<PROJECT_ID>/<repo-name>/`, each on the project branch.
- Code changes go in those cloned repos — **NOT** in the workspace repo's tree.
- Project metadata (knowledge, decisions, to-dos) goes in `projects/<PROJECT_ID>/` in the workspace repo.

## 6. During work

- Capture decisions, exceptions, and policy notes in `projects/<PROJECT_ID>/knowledge/` as you make them — not at session end.
- Capture intermediate to-dos in `projects/<PROJECT_ID>/knowledge/todo.md` under `## Open` as they arise.
- When an item from `todo.md` is resolved, move it to `## Done` with a short note (commit SHA, PR link, or one-line outcome).

---

For the canonical, full version of this protocol and the policy that governs it:

- **`docs/DEVELOPER_GUIDE.md`** — step-by-step session walkthrough with example prompts.
- **`knowledge/policies/agentic-development-policy.md`** — full policy text. POL-113 through POL-171 govern session protocol.

Per-project specifics (the actual `<PROJECT_ID>`, paths, GitHub Project URL, etc.) are filled in at `projects/<PROJECT_ID>/agent.md` once the project is seeded — that file is your project-specific entrypoint.
