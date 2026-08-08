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

## Write Restrictions During Active Projects

During an active project, NO changes are allowed to `knowledge/` (C01).
All writes must be constrained to `projects/PRJ-<board#>-<slug>/` only.
Org knowledge is read-only during projects — updated only via knowledge close PRs.

## Data Classification — Hard Rules

- **Restricted data** (credentials, secrets, PII, API keys): NEVER commit to any folder (C01)
- If restricted data is detected: hard stop, do not commit, escalate to Policy Owner immediately
- **Confidential data**: requires explicit C02 approval before inclusion in knowledge base

## Roles

Current role holders are defined in `knowledge/policies/roles.md`.
All policy roles are currently held by `<POLICY_OWNER_EMAIL>`.

## Lifecycle operations

Use the `gov` CLI (`npm i -g @svayam-opensource/gov`) for all lifecycle operations
(`gov-work seed`, `gov-work task`, `gov-work merge`, `gov-work close`, …) — never perform lifecycle
actions manually.
