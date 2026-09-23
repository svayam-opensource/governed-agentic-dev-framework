---
domain: policies
layer: policy
owner: <POLICY_OWNER_EMAIL>
compliance: C02
status: seed
---

<!-- YOURS AFTER THE FIRST INSTALL. gov seeds this file once and never touches it again (MANIFEST: seed-once),
     so an upgrade cannot overwrite what your organization decides here. The clause numbers are kept: the
     framework's policy points at this file for them, and everything that cites them still resolves. -->

# Knowledge publication — <ORG_NAME>'s decision

**How this organization publishes its knowledge, if it does.** The framework ships none of this
infrastructure and requires none of it: `knowledge_publication` in `org-config.yaml` says what you have
chosen (`none` by default), and `gov knowledge search` reads what is already on every machine.

What holds whatever you choose: every form is generated from the same markdown source, and access follows
your own rules. The starter below is the arrangement Svayam runs; keep it, cut it down, or replace it.

## The three forms (starter)

On every merge to `<DEFAULT_BRANCH>` in `<ORG_GOV_REPO>`, the CI/CD pipeline automatically generates and publishes knowledge in three forms **(C02, POL-100)**:

1. **Static site**: An internal-only website, accessible only behind authentication, intended for developers, governance teams, and audit teams. **(POL-101)**
2. **PDF exports**: Downloadable PDF versions of all knowledge documents, available through the static site, intended for regulators and external auditors. **(POL-102)**
3. **Vector embeddings (RAG)**: Changed files are re-embedded into the organizational vector store, providing agents with up-to-date context for retrieval-augmented generation. Only changed files are re-embedded. **(POL-103)**

All three publication forms are generated from the same markdown source. **(POL-104)**

---

## How it is built, if you build it (was knowledge-publication-spec.md)

<!-- ONE FILE, not two: the decision and the arrangement that carries it out. Two documents about
     one thing is the shape POL-402 forbids, and the one that drifts is always the one nobody opened. -->

# Knowledge Publication Specification

**Owner:** Infrastructure Owner (acting: `<POLICY_OWNER_EMAIL>`)
**Parent Policy:** `framework/policies/framework-policy.md` (POL-083 to POL-086)

---

## Overview

Org-wide knowledge in `<ORG_GOV_REPO>` is published in three forms, all generated from the same markdown source on every <DEFAULT_BRANCH> merge via the CI/CD pipeline.

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
- **URL structure:** Mirrors the folder structure of `knowledge/` (e.g., `/policies/org-ai-agent-governance-policy`)

### Content Coverage
- All `knowledge/` subfolders and documents
- All `projects/PRJ-<board#>-<slug>/knowledge/` content
- A project dashboard derived from GitHub (Project boards + anchor issues) — there is no `registry.yaml`
- CODEOWNERS rendered as domain ownership map
- the governance policy's §3.2 roles rendered as an org chart

---

## Form 2: PDF Exports (Formal/External)

### Purpose
Formal documents suitable for regulators, external auditors, and legal review.

### Requirements
- **Download location:** Downloadable from the static site (linked from each policy document)
- **Trigger:** Regenerated on every merge touching `framework/policies/`
- **Format:** Professional PDF with page numbers, headers, footers
- **Required metadata on every PDF:**
  - Document title
  - Version (git commit SHA of the merge)
  - Effective date
  - Policy owner name and role
  - <ORG_NAME> branding
- **Scope:** One PDF per top-level policy document in `framework/policies/`

### PDF Documents Generated
- `framework-policy.pdf`
- `data-classification.pdf`
- `knowledge-organization-standard.pdf`
- `roles.pdf`
- Domain policy PDFs (generated when domain sections are populated)

---

## Form 3: Vector Embeddings (RAG)

### Purpose
Enables agents to semantically search org knowledge for context building without reading all files. Also used by the knowledge-close step of `gov close` for LLM synthesis.

### Requirements
- **Scope:** All files in `knowledge/` are embedded
- **Update strategy:** Re-embed only changed files on each <DEFAULT_BRANCH> merge (not full re-index)
- **Chunking:** Each document section (defined by `##` headings) is a separate chunk with sufficient surrounding context to be self-contained
- **Metadata per chunk:** file path, section heading, last modified commit SHA, domain owner
- **Access:** Internal API accessible to agents during work sessions and to the knowledge-close step of `gov close`
- **Infrastructure Owner** is responsible for vector store choice, maintenance, and uptime

### Agent Usage
Agents query the vector store at session start to build relevant context:
1. Pull project knowledge from `projects/PRJ-<board#>-<slug>/`
2. Query vector store with project context to retrieve semantically relevant org knowledge
3. Assemble context from retrieved chunks + full priority layer stack

### Knowledge-close Usage
The knowledge-close step of `gov close` queries the vector store to find existing org knowledge relevant to project learnings before proposing updates — ensuring proposals are additive and non-redundant.

---

## Infrastructure Owner Checklist

- [ ] Static site deployed and behind authentication
- [ ] PDF generation pipeline configured
- [ ] Vector store provisioned and ingestion pipeline active
- [ ] All three forms regenerate automatically on <DEFAULT_BRANCH> merge via CI/CD
- [ ] Monitoring and alerting in place for publication pipeline failures
