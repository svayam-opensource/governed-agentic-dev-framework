# Script Specification: pause

**Purpose:** Transitions a project from ACTIVE to PAUSED. Preserves all state for later resumption.
**Compliance:** C02
**Policy Reference:** POL-049, POL-051

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `SVM-007-invoice-api` |

---

## Pre-conditions

- `project.yaml` `status` must be `active`
- No uncommitted changes in any project repo (agent must commit first)

---

## Steps

1. Check for uncommitted changes across all repos — hard stop if any exist
2. Verify `status: active`
3. Set `status: paused`
4. Set `paused_at: <today>`
5. Commit updated `project.yaml` to `svm-NNN-slug` branch
6. Push all branches to remote

---

## Outputs

- `project.yaml` status: `paused`, `paused_at` stamped
- All changes committed and pushed

---

## Error Conditions

| Error | Behavior |
|---|---|
| Uncommitted changes present | Hard stop — commit or stash first |
| Project not active | Hard stop — cannot pause a non-active project |
