# Script Specification: close-project

**Purpose:** Closes project work. Validates completion, merges branches to their base, archives. Triggers close-knowledge on success.
**Compliance:** C01 for pre-close gate
**Policy Reference:** POL-087 to POL-096

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `SVM-007-invoice-api` |

---

## Pre-close Gate (C01 — Hard Block)

Script refuses to proceed if ANY of the following are missing:

- `projects/SVM-NNN-slug/knowledge/` contains at least one file
- `projects/SVM-NNN-slug/knowledge/compliance.md` exists
- `project.yaml` has all mandatory fields populated
- `completed_at` is NOT yet set (prevents double-close)

---

## Steps

1. Run pre-close gate — hard stop on any failure
2. For each repo in `repos[]`:
   - Auto-merge `svm-NNN-slug` → `base_branch`
   - If merge conflicts: **pause script**, surface conflicts to human developer
   - Human resolves conflicts, then re-runs script to continue
3. Merge `svm-NNN-slug` → `master` in `{{WORKSPACE_REPO}}`
4. For each repo and `{{WORKSPACE_REPO}}`:
   - Create archive tag `archive/svm-NNN-slug`
   - Delete branch `svm-NNN-slug`
5. Set `project.yaml`:
   - `status: completed`
   - `completed_at: <today>`
6. Commit final `project.yaml` to `master` in `{{WORKSPACE_REPO}}`
7. **Automatically trigger `close-knowledge` script**

---

## Outputs

- All `svm-NNN-slug` branches merged to their respective base branches
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
