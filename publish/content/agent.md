# <ORG_NAME> — Org-Level Agent Entry Point
# Repository: <WORKSPACE_REPO>
# This file is the primary context entry point for all agents working in this repository.

## About This Repository

`<WORKSPACE_REPO>` is <ORG_NAME>'s central workspace repository for all agentic development projects.
It is NOT a code repository. It contains:
- Org-wide knowledge (`knowledge/`)
- All project workspaces (`projects/PRJ-<board#>-<slug>/`)

Project state is derived live from GitHub (boards + anchor issues) — there is no
`registry.yaml` or `project.yaml`.

`<WORKSPACE_REPO>` is an implicit participant in every project — it does not need to be listed in `repos[]`.

## Authoritative Policy

All work in this repository and all agentic development at <ORG_NAME> is governed by:
`knowledge/policies/agentic-development-policy.md`

Read this policy before beginning any work session.

## Knowledge Layer Priority (Highest to Lowest)

1. **Org-wide knowledge** → `knowledge/` (this repository, <DEFAULT_BRANCH> branch)
2. **Project knowledge** → `projects/PRJ-<board#>-<slug>/knowledge/`
3. **Repo-local knowledge** → `<cloned-repo>/knowledge/`
4. **Your developer preferences** → `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md`
   (run `gh api user --jq .login` to get your handle; load only your file)

Higher priority always wins. In case of conflict, apply the rule from the higher-priority layer.

## Conflict Resolution by Compliance Level

- **C01 — Non-Negotiable**: Hard stop. Refuse to proceed. Surface to human immediately.
- **C02 — Always Apply**: Block work. Require approved PR in `knowledge/policies/exceptions/` before continuing.
- **C03 — Apply Intelligently**: Proceed with deviation, but document reasoning in `projects/PRJ-<board#>-<slug>/knowledge/compliance.md`.

## Session Start Checklist (C01 — complete before any work)

1. Read `org-config.yaml` at workspace root — org identity, branches, owners, `agent_work_root`. Every other step references its values.
2. Verify you are authorized via **write access to the project's GitHub Project** (or you own the current task sub-branch)
3. Verify the project's GitHub board is **open** (active)
4. Load all four knowledge layers fresh (never use cached layers from a prior session)
5. Pull latest `BRNCH-<board#>-<slug>` branch in all repos

## Governance Authority & Project-Branch Proposals (C01)

Governance is sourced from **`<DEFAULT_BRANCH>`**: your session-start context and all governing
knowledge/policy (`knowledge/`, `agent/session-protocol.md`, `policies/`) are built from
`<DEFAULT_BRANCH>`, never from the project branch (POL-086a). Project work — **including edits to org
`knowledge/`** — is committed to the **project branch**, where such edits are **proposals with no
governing force**. Never self-govern by your own unratified edits. Project-specific context
(`projects/PRJ-<board#>-<slug>/…`) is read from the project branch (POL-086b).

A `knowledge/` change becomes organizational standard only when merged to `<DEFAULT_BRANCH>` via a PR
approved by the Policy Owner **and** the CODEOWNERS domain owner(s) whose folders it touches — all
owners for `policies/`/`mandates/` (POL-086c). See
`knowledge/policies/agentic-development-policy.md` §6.4.

## Data Classification — Hard Rules

- **Restricted data** (credentials, secrets, PII, API keys): NEVER commit to any folder (C01)
- If restricted data is detected: hard stop, do not commit, escalate to Policy Owner immediately
- **Confidential data**: requires explicit C02 approval before inclusion in knowledge base

## Roles

Current role holders are defined in `knowledge/policies/roles.md`.
All policy roles are currently held by `<POLICY_OWNER_EMAIL>`.

## Lifecycle operations

Use the `gov` CLI (`npm i -g @svayam-opensource/gov`) for all lifecycle operations
(`gov seed`, `gov task`, `gov merge`, `gov close`, …) — never perform lifecycle
actions manually.
