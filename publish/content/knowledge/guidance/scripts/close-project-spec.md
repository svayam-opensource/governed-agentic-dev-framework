# Script Specification: close-project

**Purpose:** Closes project work. Validates completion, merges branches to their base, archives. Triggers close-knowledge on success.
**Compliance:** C01 for pre-close gate
**Policy Reference:** POL-087 to POL-096

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `PRJ-26-invoice-api` |

---

## Pre-close Gate (C01 — Hard Block)

Script refuses to proceed if ANY of the following are missing:

- `projects/PRJ-<board#>-<slug>/knowledge/` contains at least one file
- `projects/PRJ-<board#>-<slug>/knowledge/compliance.md` exists
- `project.yaml` has all mandatory fields populated
- `completed_at` is NOT yet set (prevents double-close)

---

## Steps

1. Run pre-close gate — hard stop on any failure
2. For each repo in `repos[]`:
   - Auto-merge `BRNCH-<board#>-<slug>` → `base_branch`
   - If merge conflicts: **pause script**, surface conflicts to human developer
   - Human resolves conflicts, then re-runs script to continue
3. Merge `BRNCH-<board#>-<slug>` → `<DEFAULT_BRANCH>` in `<WORKSPACE_REPO>`
4. For each repo and `<WORKSPACE_REPO>`:
   - Create archive tag `archive/BRNCH-<board#>-<slug>`
   - Delete branch `BRNCH-<board#>-<slug>`
5. Set `project.yaml`:
   - `status: completed`
   - `completed_at: <today>`
6. Commit final `project.yaml` to `<DEFAULT_BRANCH>` in `<WORKSPACE_REPO>`
7. **Automatically trigger `close-knowledge` script**

---

## Outputs

- All `BRNCH-<board#>-<slug>` branches merged to their respective base branches
- Archive tags created and branches deleted
- `project.yaml` status: `completed`, `completed_at` stamped
- `close-knowledge` triggered

---

## Error Conditions

| Error | Behavior |
|---|---|
| Pre-close gate failure | Hard stop (C01) — list specific failures |
| Merge conflicts | Pause, surface to human, resume after resolution |
| Archive tag failure | Do not delete branch until tag confirmed |
