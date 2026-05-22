# Knowledge Publication Specification

**Owner:** Infrastructure Owner (acting: `<POLICY_OWNER_EMAIL>`)
**Parent Policy:** `knowledge/policies/agentic-development-policy.md` (POL-083 to POL-086)

---

## Overview

Org-wide knowledge in `<WORKSPACE_REPO>` is published in three forms, all generated from the same markdown source on every <DEFAULT_BRANCH> merge via the CI/CD pipeline.

---

## Form 1: Static Site (Internal)

### Purpose
Primary knowledge consumption interface for developers, governance teams, and audit teams.

### Requirements
- **Access:** Internal only — behind authentication. No public access.
- **Authentication:** GitHub OAuth or equivalent SSO. Only <ORG_NAME> authorized users.
- **Content:** All markdown files in `knowledge/` and `projects/` rendered as navigable web pages
- **Navigation:** Hyperlinked — policies link to roles, roles link to exceptions, exceptions link to approvals, decisions link back to projects
- **Search:** Full-text search across all knowledge content
- **Currency:** Must reflect current `<DEFAULT_BRANCH>` within 1 hour of any merge
- **URL structure:** Mirrors the folder structure of `knowledge/` (e.g., `/policies/agentic-development-policy`)

### Content Coverage
- All `knowledge/` subfolders and documents
- All `projects/PRJ-NNN-<slug>/knowledge/` content
- `registry.yaml` rendered as a project dashboard
- CODEOWNERS rendered as domain ownership map
- `knowledge/policies/roles.md` rendered as an org chart

---

## Form 2: PDF Exports (Formal/External)

### Purpose
Formal documents suitable for regulators, external auditors, and legal review.

### Requirements
- **Download location:** Downloadable from the static site (linked from each policy document)
- **Trigger:** Regenerated on every merge touching `knowledge/policies/`
- **Format:** Professional PDF with page numbers, headers, footers
- **Required metadata on every PDF:**
  - Document title
  - Version (git commit SHA of the merge)
  - Effective date
  - Policy owner name and role
  - <ORG_NAME> branding
- **Scope:** One PDF per top-level policy document in `knowledge/policies/`

### PDF Documents Generated
- `agentic-development-policy.pdf`
- `data-classification.pdf`
- `llm-governance.pdf`
- `roles.pdf`
- Domain policy PDFs (generated when domain sections are populated)

---

## Form 3: Vector Embeddings (RAG)

### Purpose
Enables agents to semantically search org knowledge for context building without reading all files. Also used by `close-knowledge` script for LLM synthesis.

### Requirements
- **Scope:** All files in `knowledge/` are embedded
- **Update strategy:** Re-embed only changed files on each <DEFAULT_BRANCH> merge (not full re-index)
- **Chunking:** Each document section (defined by `##` headings) is a separate chunk with sufficient surrounding context to be self-contained
- **Metadata per chunk:** file path, section heading, last modified commit SHA, domain owner
- **Access:** Internal API accessible to agents during work sessions and to `close-knowledge` script
- **Infrastructure Owner** is responsible for vector store choice, maintenance, and uptime

### Agent Usage
Agents query the vector store at session start to build relevant context:
1. Pull project knowledge from `projects/PRJ-NNN-<slug>/`
2. Query vector store with project context to retrieve semantically relevant org knowledge
3. Assemble context from retrieved chunks + full priority layer stack

### close-knowledge Usage
The `close-knowledge` script queries the vector store to find existing org knowledge relevant to project learnings before proposing updates — ensuring proposals are additive and non-redundant.

---

## Infrastructure Owner Checklist

- [ ] Static site deployed and behind authentication
- [ ] PDF generation pipeline configured
- [ ] Vector store provisioned and ingestion pipeline active
- [ ] All three forms regenerate automatically on <DEFAULT_BRANCH> merge via CI/CD
- [ ] Monitoring and alerting in place for publication pipeline failures
