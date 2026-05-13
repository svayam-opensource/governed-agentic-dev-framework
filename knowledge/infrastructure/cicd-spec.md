# CI/CD Pipeline Specification — {{WORKSPACE_REPO}}

**Owner:** Infrastructure Owner (acting: `{{POLICY_OWNER_EMAIL}}`)
**Scope:** This specification applies to `{{WORKSPACE_REPO}}` ONLY.
**Note:** Other repos are not covered by this spec. They adopt the agentic development policy via the `onboard-repo` script without CI/CD changes.

---

## Overview

The `{{WORKSPACE_REPO}}` CI/CD pipeline runs on every PR and every merge to `{{DEFAULT_BRANCH}}`. It enforces structural integrity and keeps knowledge publications current.

---

## On Every PR to Master (Validation Gates)

These checks run on every PR targeting `{{DEFAULT_BRANCH}}`. Failures block the merge. **(C01)**

### 1. `project.yaml` Schema Validation
- All files matching `projects/*/project.yaml` must conform to the required schema
- All mandatory fields must be present
- `status` must be a valid enum value
- `repos[].role` must be `primary`, `dependency`, or `read-only`
- `knowledge_status` must be a valid enum value if set

### 2. CODEOWNERS Coverage
- Every subfolder in `knowledge/` must have a mapped owner in `CODEOWNERS`
- No unmapped paths

### 3. `registry.yaml` Integrity
- `last_issued` must be a non-negative integer
- No duplicate project IDs in `projects[]`
- All IDs must match the `{{ORG_SLUG}}-NNN-slug` format

### 4. Active Project Workspace Structure
- All `active` projects must have:
  - `projects/{{ORG_SLUG}}-NNN-slug/requirements/` folder
  - `projects/{{ORG_SLUG}}-NNN-slug/environment/` folder
  - `projects/{{ORG_SLUG}}-NNN-slug/knowledge/` folder
  - `projects/{{ORG_SLUG}}-NNN-slug/agent.md`
  - `projects/{{ORG_SLUG}}-NNN-slug/project.yaml`

### 5. Data Classification Scan
- Scan all committed files for patterns matching Restricted data (credentials, keys, tokens)
- Hard block if detected **(C01)**

---

## On Merge to Master (Publication Pipeline)

These jobs run after every successful merge to `{{DEFAULT_BRANCH}}`. **(C02)**

### 1. Static Site Rebuild
- Rebuild and redeploy the internal knowledge site
- SLA: complete within 1 hour of merge
- Authentication: internal only

### 2. PDF Regeneration
- Trigger: only when merge touches `knowledge/policies/`
- Regenerate PDF exports for all policy documents
- Each PDF must include: title, version (commit SHA), effective date, policy owner

### 3. Vector Re-embedding
- Re-embed only the knowledge files changed in this merge (not a full re-index)
- Update vector store with new embeddings
- Used by agents for RAG-based context building and by `close-knowledge` script

### 4. Compliance Summary Update
- Aggregate per-project `compliance.md` files into `knowledge/compliance/`
- Update org-level compliance summary

---

## Infrastructure Owner Responsibilities

- Build, maintain, and monitor this pipeline
- Ensure SLAs are met for publication jobs
- Alert Policy Owner on repeated C01 gate failures
- Maintain authentication for the internal static site
- Maintain the vector store and embedding pipeline
