# Script Specification: add-repo

**Purpose:** Adds a new repository to an active project when scope expands beyond initial GitHub Issues/PRs.
**Compliance:** C02
**Policy Reference:** POL-062 to POL-066

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `{{ORG_SLUG}}-007-invoice-api` |
| `repo_url` | Yes | Full GitHub repository URL |
| `role` | Yes | `primary` \| `dependency` \| `read-only` |
| `added_reason` | Yes | Why this repo is being added post-seed |
| `base_branch` | No | Override base branch (default: `dev`) |

---

## Pre-conditions

- `project.yaml` `status` must be `active`
- `locked_by` must match current user (or current user must be a team member)
- Repo must not already be listed in `project.yaml` `repos[]`

---

## Steps

1. Verify pre-conditions (C01 if status not active)
2. Prompt for `base_branch` if not provided (default: `dev`)
3. Clone repo into `<agent_work_root>/{{ORG_SLUG}}-NNN-slug/<repo-name>/`
4. Create branch `{{org_slug}}-NNN-slug` from `base_branch`
5. Push branch to remote
6. Add entry to `repos[]` in `project.yaml`:
   ```yaml
   - url: <repo_url>
     role: <role>
     base_branch: <base_branch>
     added_at: <today>
     added_reason: <added_reason>
   ```
7. Commit updated `project.yaml` to `{{org_slug}}-NNN-slug` branch in `{{WORKSPACE_REPO}}`

---

## Outputs

- Repo cloned locally under project work directory
- Branch `{{org_slug}}-NNN-slug` created in repo and pushed
- `project.yaml` updated with new repo entry

---

## Error Conditions

| Error | Behavior |
|---|---|
| Project not active | Hard stop (C01) |
| Repo already in project | Hard stop — use existing entry |
| Branch creation failure | Hard stop — investigate remote state |
| Clone failure | Hard stop — verify repo access |
