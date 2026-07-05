# Script Specification: resume

**Purpose:** Transitions a project from PAUSED to ACTIVE with mandatory <DEFAULT_BRANCH> sync. Ensures agent works with current org knowledge.
**Compliance:** C01 for knowledge sync (POL-122); C02 for state transition
**Policy Reference:** POL-049, POL-051, POL-122

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `PRJ-26-invoice-api` |

---

## Pre-conditions

- `project.yaml` `status` must be `paused`
- `locked_by` must match current user (or current user must be a team member)

---

## Steps

1. Verify `status: paused` and authorization
2. **Mandatory <DEFAULT_BRANCH> sync for `<WORKSPACE_REPO>`:**
   - Fetch latest `<DEFAULT_BRANCH>`
   - Merge `<DEFAULT_BRANCH>` → `BRNCH-<board#>-<slug>`
   - If merge conflicts: pause script, surface conflicts to human developer for resolution, then resume
3. **Mandatory <DEFAULT_BRANCH> sync for each repo in `repos[]`:**
   - Fetch latest `base_branch` for each repo
   - Merge `base_branch` → `BRNCH-<board#>-<slug>` in each repo
   - Pause on conflicts for human resolution
4. Clear `paused_at` (set to `~`)
5. Set `status: active`
6. Commit updated `project.yaml`
7. Push all branches
8. Reload all four knowledge layers fresh

---

## Outputs

- All project branches synced with latest base branches
- `project.yaml` status: `active`, `paused_at` cleared
- Knowledge layers refreshed

---

## Error Conditions

| Error | Behavior |
|---|---|
| Project not paused | Hard stop |
| Merge conflicts | Pause script, surface to human, resume after resolution |
| Push failure | Investigate remote state before retrying |
