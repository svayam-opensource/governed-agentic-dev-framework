# Script Specification: close-knowledge

**Purpose:** Synthesizes project knowledge into org knowledge proposals using LLM+RAG. Raises PR for domain owner review.
**Compliance:** C02
**Policy Reference:** POL-097 to POL-106
**Triggered by:** close-project script automatically after successful project close

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `project_id` | Yes | e.g., `{{ORG_SLUG}}-007-invoice-api` (passed from close-project) |

---

## Pre-conditions

- `project.yaml` `status` must be `completed`
- `projects/{{ORG_SLUG}}-NNN-slug/knowledge/` must contain content to synthesize

---

## Steps

1. Read all content from `projects/{{ORG_SLUG}}-NNN-slug/knowledge/` holistically
2. Query vector store (RAG) for semantically relevant existing org knowledge in `knowledge/`
3. Use LLM to synthesize: map project learnings to appropriate org knowledge locations
   - Identify new content to add
   - Identify existing content to update
   - Identify patterns, guidance, decisions, or compliance notes worth promoting
4. Generate a human-readable narrative summary of proposals (for PR description)
5. Checkout new branch `{{org_slug}}-NNN-slug-knowledge` from `{{DEFAULT_BRANCH}}` of `{{WORKSPACE_REPO}}`
6. Apply proposed changes to `knowledge/` on that branch
7. Commit changes
8. Raise PR: `{{org_slug}}-NNN-slug-knowledge` → `{{DEFAULT_BRANCH}}`
   - PR title: `[Knowledge Close] {{ORG_SLUG}}-NNN-slug`
   - PR description: LLM-generated narrative summary of what was learned and what is proposed
   - CODEOWNERS auto-assigns appropriate domain owners as reviewers
9. Update `project.yaml` on {{DEFAULT_BRANCH}}:
   - `knowledge_status: pending_review`
   - `knowledge_pr: <pr_url>`

---

## Outputs

- Branch `{{org_slug}}-NNN-slug-knowledge` created with proposed org knowledge changes
- PR raised for domain owner review
- `project.yaml` updated with `knowledge_status` and `knowledge_pr`

---

## Knowledge PR Lifecycle

| Outcome | Action |
|---|---|
| **Merged** | Archive tag `archive/{{org_slug}}-NNN-slug-knowledge` + delete branch; `knowledge_status: merged` |
| **Rejected** | Owner deletes or keeps branch; `knowledge_status: rejected` |
| **Under revision** | Owner comments; developer revises and submits new PR; `knowledge_status: under_revision` |
| **Abandoned** | Developer closes PR and deletes branch; `knowledge_status: abandoned` |

Code state is immutable regardless of knowledge PR outcome.

---

## Error Conditions

| Error | Behavior |
|---|---|
| LLM synthesis failure | Log error, fall back to creating empty PR with all project knowledge attached as-is for manual review |
| Vector store unavailable | Proceed with LLM synthesis only (no RAG context) — log warning |
| PR creation failure | Retry once; if failed, log error and surface to human |
