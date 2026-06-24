# Script Specification: merge-task

**Purpose:** Merges a completed sub-branch back into the project integration branch. Archives sub-branch. Closes GitHub Issue.
**Compliance:** C02
**Policy Reference:** POL-073 to POL-075

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `PRJ-26-invoice-api` |
| `task_id` | Yes | e.g., `BRNCH-26-invoice-api.ISSUE-42` |

---

## Pre-conditions

- Task `status` must be `active` in `project.yaml` `tasks[]`
- No uncommitted changes on sub-branch (commit all work first)
- `project.yaml` project `status` must be `active`

---

## Steps

1. Verify pre-conditions
2. In `<WORKSPACE_REPO>`: merge `BRNCH-<board#>-<slug>.ISSUE-<n>` → `BRNCH-<board#>-<slug>`
3. For each repo in `repos[]`: merge `BRNCH-<board#>-<slug>.ISSUE-<n>` → `BRNCH-<board#>-<slug>`
4. Pause for human conflict resolution if merge conflicts exist, then resume
5. In all repos and `<WORKSPACE_REPO>`:
   - Create archive tag `archive/BRNCH-<board#>-<slug>.ISSUE-<n>`
   - Delete sub-branch `BRNCH-<board#>-<slug>.ISSUE-<n>`
6. Mark GitHub Issue as resolved/closed
7. Update task in `project.yaml` `tasks[]`:
   - `status: completed`
   - `completed_at: <today>`
8. Commit updated `project.yaml` to `BRNCH-<board#>-<slug>`

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
