# Script Specification: sync

**Purpose:** Merges latest master/base into active project branch on demand. Use when you want latest org knowledge mid-project without pausing/resuming.
**Compliance:** C03 — encouraged but not mandatory
**Policy Reference:** POL-122

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `SVM-007-invoice-api` |

---

## Pre-conditions

- `project.yaml` `status` must be `active`
- No uncommitted changes (commit first)

---

## Steps

1. Verify `status: active` and no uncommitted changes
2. Fetch latest `master` in `000-svm-prj`
3. Merge `master` → `svm-NNN-slug` in `000-svm-prj`
4. Pause for human conflict resolution if needed, then continue
5. For each repo in `repos[]`:
   - Fetch latest `base_branch`
   - Merge `base_branch` → `svm-NNN-slug`
   - Pause on conflicts for human resolution
6. Reload all four knowledge layers fresh
7. Push updated branches

---

## Outputs

- All project branches updated with latest org knowledge and base branch changes
- Knowledge layers refreshed with any org knowledge updates

---

## Use Cases

- Pulling in recently merged org knowledge policy updates
- Staying current during a long-running project
- Pre-task sync before starting a new work session on a long-running project

---

## Error Conditions

| Error | Behavior |
|---|---|
| Project not active | Hard stop |
| Uncommitted changes | Hard stop — commit first |
| Merge conflicts | Pause, surface to human, resume after resolution |
