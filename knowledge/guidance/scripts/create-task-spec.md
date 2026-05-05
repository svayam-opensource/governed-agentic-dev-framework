# Script Specification: create-task

**Purpose:** Creates a sub-branch for parallel work by a specific agent/developer on a GitHub Issue within a project.
**Compliance:** C02
**Policy Reference:** POL-073 to POL-075

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `SVM-007-invoice-api` |
| `github_issue_url` | Yes | URL to the GitHub Issue this task addresses |
| `assignee` | Yes | Individual email of the agent/developer for this task |

---

## Pre-conditions

- `project.yaml` `status` must be `active`
- GitHub Issue must belong to a repo listed in `project.yaml` `repos[]`
- `assignee` must be `locked_by` user or a member of `assigned_to` team
- Issue must not already have an active task in `project.yaml` `tasks[]`

---

## Steps

1. Verify pre-conditions
2. Derive `task-slug` from GitHub Issue title (lowercase, hyphen-separated)
3. Compose sub-branch name: `svm-NNN-slug/task-slug`
4. In `{{WORKSPACE_REPO}}`: create `svm-NNN-slug/task-slug` from `svm-NNN-slug`
5. For each repo in `repos[]`: create `svm-NNN-slug/task-slug` from `svm-NNN-slug`
6. Push all sub-branches to remote
7. Assign GitHub Issue to `assignee`
8. Add task entry to `tasks[]` in `project.yaml`:
   ```yaml
   - id: svm-NNN-slug/task-slug
     github_issue: <url>
     assigned_to: <assignee>
     status: active
     created_at: <today>
     completed_at: ~
   ```
9. Commit updated `project.yaml` to `svm-NNN-slug`

---

## Sub-branch Rules

- Sub-branches merge back to `svm-NNN-slug` ONLY — never directly to master or `base_branch`
- Each sub-branch has exactly one assignee — single-assignee rule applies at sub-branch level
- Multiple sub-branches can be active simultaneously for multi-agent parallel work

---

## Outputs

- Sub-branch `svm-NNN-slug/task-slug` created in all repos
- GitHub Issue assigned
- `project.yaml` tasks[] updated

---

## Error Conditions

| Error | Behavior |
|---|---|
| Project not active | Hard stop |
| Issue not in project repos | Hard stop — add repo first via add-repo script |
| Assignee not authorized | Hard stop (C01) |
| Sub-branch already exists | Hard stop — investigate before proceeding |
