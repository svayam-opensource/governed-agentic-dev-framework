# Svayam Infoware — Org-Level Agent Entry Point
# Repository: 000-svm-prj
# This file is the primary context entry point for all agents working in this repository.

## About This Repository

`000-svm-prj` is Svayam Infoware's central workspace repository for all agentic development projects.
It is NOT a code repository. It contains:
- Org-wide knowledge (`knowledge/`)
- All project workspaces (`projects/SVM-NNN-slug/`)
- The project registry (`registry.yaml`)

`000-svm-prj` is an implicit participant in every project — it does not need to be listed in `repos[]`.

## Authoritative Policy

All work in this repository and all agentic development at Svayam Infoware is governed by:
`knowledge/policies/agentic-development-policy.md`

Read this policy before beginning any work session.

## Knowledge Layer Priority (Highest to Lowest)

1. **Org-wide knowledge** → `knowledge/` (this repository, master branch)
2. **Project knowledge** → `projects/SVM-NNN-slug/knowledge/`
3. **Repo-local knowledge** → `<cloned-repo>/knowledge/`
4. **Developer preferences** → `<agent_work_root>/preferences/agent.md`

Higher priority always wins. In case of conflict, apply the rule from the higher-priority layer.

## Conflict Resolution by Compliance Level

- **C01 — Non-Negotiable**: Hard stop. Refuse to proceed. Surface to human immediately.
- **C02 — Always Apply**: Block work. Require approved PR in `knowledge/policies/exceptions/` before continuing.
- **C03 — Apply Intelligently**: Proceed with deviation, but document reasoning in `projects/SVM-NNN-slug/knowledge/compliance.md`.

## Session Start Checklist (C01 — complete before any work)

1. Read `projects/SVM-NNN-slug/project.yaml` → verify `locked_by` matches your user identity
2. Verify `status: active`
3. Load all four knowledge layers fresh (never use cached layers from a prior session)
4. Pull latest `svm-NNN-slug` branch in all repos

## Write Restrictions During Active Projects

During an active project, NO changes are allowed to `knowledge/` (C01).
All writes must be constrained to `projects/SVM-NNN-slug/` only.
Org knowledge is read-only during projects — updated only via knowledge close PRs.

## Data Classification — Hard Rules

- **Restricted data** (credentials, secrets, PII, API keys): NEVER commit to any folder (C01)
- If restricted data is detected: hard stop, do not commit, escalate to Policy Owner immediately
- **Confidential data**: requires explicit C02 approval before inclusion in knowledge base

## Roles

Current role holders are defined in `knowledge/policies/roles.md`.
All policy roles are currently held by `rkant@svayamtech.com`.

## Scripts

All operational scripts are specified in `knowledge/guidance/scripts/`.
Use scripts for all lifecycle operations — never perform lifecycle actions manually.
