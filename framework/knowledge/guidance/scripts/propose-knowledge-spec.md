# Script Specification: propose-knowledge

**Purpose:** Ad-hoc org knowledge proposals outside any project context. Used for initial bootstrap, policy updates, and standalone learnings.
**Compliance:** C02 — proposals require domain owner approval via PR
**Policy Reference:** POL-107 to POL-109

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `branch_slug` | Yes | Human-chosen description (e.g., `initial-policy-bootstrap`, `api-design-patterns`) |
| `description` | Yes | One-line description of what knowledge is being proposed |

---

## Pre-conditions

- Requester must be an authorized GitHub user in `<WORKSPACE_REPO>`
- Branch `knowledge-<slug>` must not already exist

---

## Steps

1. Create branch `knowledge-<slug>` from `<DEFAULT_BRANCH>` of `<WORKSPACE_REPO>`
2. Switch to new branch
3. Requester manually authors knowledge changes on this branch:
   - Add new files to appropriate `knowledge/` subfolders
   - Modify existing knowledge files
   - No LLM synthesis — this is manually authored content
4. Commit changes to `knowledge-<slug>` branch
5. Push branch to remote
6. Raise PR: `knowledge-<slug>` → `<DEFAULT_BRANCH>`
   - PR title: `[Knowledge Proposal] <description>`
   - PR description: human-written summary of what is being proposed and why
   - CODEOWNERS auto-assigns domain owners as reviewers based on folders touched
7. Domain owner reviews and merges (or requests changes)

---

## Post-merge

- On merge: CI/CD regenerates static site, PDFs, and vector embeddings
- Archive tag `archive/knowledge-<slug>` + delete branch

---

## Primary Use Cases

1. **Initial bootstrap**: Populating `knowledge/` before the first project is seeded
2. **Policy updates**: Policy Owner updating `knowledge/policies/` directly
3. **Ad-hoc learnings**: Knowledge that arises outside any project context
4. **Onboarding**: Adding new guidance, patterns, or environment documentation

---

## Differences from close-knowledge

| | propose-knowledge | close-knowledge |
|---|---|---|
| Context | Standalone | After project close |
| Authoring | Manual | LLM+RAG synthesis |
| Branch prefix | `knowledge-<slug>` | `BRNCH-<board#>-<slug>-knowledge` |
| Source | Human-written | Project knowledge folder |

---

## Error Conditions

| Error | Behavior |
|---|---|
| Branch already exists | Hard stop — investigate before proceeding |
| PR creation failure | Retry once; surface to human if failed |
