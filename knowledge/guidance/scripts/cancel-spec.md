# Script Specification: cancel

**Purpose:** Cancels a project. Archives all branches. No knowledge close. No knowledge PR.
**Compliance:** C01 for cancellation_reason requirement
**Policy Reference:** POL-052, POL-070

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `SVM-007-invoice-api` |
| `cancellation_reason` | Yes | Why the project is being cancelled |

---

## Pre-conditions

- `project.yaml` `status` must be `active` or `paused`
- `locked_by` must match current user

---

## Steps

1. Require `cancellation_reason` — hard stop if not provided
2. In `000-svm-prj`:
   - Create archive tag `archive/svm-NNN-slug` at current branch tip
   - Delete branch `svm-NNN-slug`
3. For each repo in `repos[]`:
   - Create archive tag `archive/svm-NNN-slug` at current branch tip
   - Delete branch `svm-NNN-slug`
4. Set `project.yaml` fields:
   - `status: cancelled`
   - `cancelled_at: <today>`
   - `cancellation_reason: <provided reason>`
5. Commit final `project.yaml` state to `master` in `000-svm-prj`

**Note:** No knowledge close is run. No knowledge PR is raised. All code changes are preserved in archive tags but not merged.

---

## Outputs

- Archive tags `archive/svm-NNN-slug` created in all repos
- All `svm-NNN-slug` branches deleted
- `project.yaml` committed to master with `status: cancelled`

---

## Error Conditions

| Error | Behavior |
|---|---|
| No cancellation_reason provided | Hard stop (C01) |
| Project not active or paused | Hard stop |
| Tag creation failure | Log and retry — do not delete branch until tag confirmed |
