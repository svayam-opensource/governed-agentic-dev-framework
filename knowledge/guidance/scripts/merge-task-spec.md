# Script Specification: merge-task

**Purpose:** Merges a completed sub-branch back into the project integration branch. Archives sub-branch. Closes GitHub Issue.
**Compliance:** C02
**Policy Reference:** POL-073 to POL-075

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `SVM-007-invoice-api` |
| `task_id` | Yes | e.g., `svm-007-invoice-api/api-design` |

---

## Pre-conditions

- Task `status` must be `active` in `project.yaml` `tasks[]`
- No uncommitted changes on sub-branch (commit all work first)
- `project.yaml` project `status` must be `active`

---

## Steps

1. Verify pre-conditions
2. In `{{WORKSPACE_REPO}}`: merge `svm-NNN-slug/task-slug` → `svm-NNN-slug`
3. For each repo in `repos[]`: merge `svm-NNN-slug/task-slug` → `svm-NNN-slug`
4. Pause for human conflict resolution if merge conflicts exist, then resume
5. In all repos and `{{WORKSPACE_REPO}}`:
   - Create archive tag `archive/svm-NNN-slug/task-slug`
   - Delete sub-branch `svm-NNN-slug/task-slug`
6. Mark GitHub Issue as resolved/closed
7. Update task in `project.yaml` `tasks[]`:
   - `status: completed`
   - `completed_at: <today>`
8. Commit updated `project.yaml` to `svm-NNN-slug`

---

## Outputs

- Sub-branch merged into project branch
- Archive tags created, sub-branches deleted
- GitHub Issue closed
- `project.yaml` task status: `completed`

---

## Error Conditions

| Error | Behavior |
|---|---|
| Uncommitted changes | Hard stop — commit first |
| Merge conflicts | Pause, surface to human, resume after resolution |
| Tag creation failure | Do not delete branch until tag confirmed |
| Task not found in project.yaml | Hard stop — verify task_id |
