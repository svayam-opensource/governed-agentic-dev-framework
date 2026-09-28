---
domain: infrastructure
layer: spec
compliance: descriptive
status: current
owner: <POLICY_OWNER_EMAIL>
---

# CI/CD Pipeline Specification — <ORG_GOV_REPO>

> **This is a specification, not a policy.** It describes what the pipeline DOES; it states no rule anybody can
> comply with or deviate from, which is why its front matter says `layer: spec` and `compliance: descriptive`.
> It moved out of `framework/policies/` on 2026-09-28 because a document under that folder teaches a reader that
> everything there governs — and `gov rules build` found 21 clauses here and 0 rules, which is the signature of a
> spec in a policy folder.

**Owner:** Infrastructure Owner (acting: `<POLICY_OWNER_EMAIL>`)
**Scope:** This specification applies to `<ORG_GOV_REPO>` ONLY.
**Note:** Other repos are not covered by this spec. They adopt the agentic development policy via `gov onboard` without CI/CD changes.

---

## Overview

The `<ORG_GOV_REPO>` CI/CD pipeline runs on every PR and every merge to `<DEFAULT_BRANCH>`. It enforces structural integrity and keeps knowledge publications current.

---

## On Every PR to Master (Validation Gates)

These checks run on every PR targeting `<DEFAULT_BRANCH>` — the same validators `gov validate` runs locally. Failures block the merge. **(C01)**

Project state is derived live from GitHub (Project boards + anchor issues); there is no `registry.yaml` or `project.yaml` to validate. The gates below check structural and naming invariants against that GitHub-derived state.

### 1. Project ID & Branch Naming
- Every project folder under `projects/` must be named `PRJ-<board#>-<slug>` and correspond to a GitHub Project board
- No duplicate project IDs
- Project branches follow `BRNCH-<board#>-<slug>` (legacy `brnch-NNN-<slug>` projects keep their names)

### 2. CODEOWNERS Coverage
- Every subfolder in `knowledge/` must have a mapped owner in `CODEOWNERS`
- No unmapped paths

### 3. Active Project Workspace Structure
- All active projects (those whose GitHub board is open) must have:
  - `projects/PRJ-<board#>-<slug>/requirements/` folder
  - `projects/PRJ-<board#>-<slug>/environment/` folder
  - `projects/PRJ-<board#>-<slug>/knowledge/` folder
  - `projects/PRJ-<board#>-<slug>/agent.md`

### 4. Data Classification Scan
- Scan all committed files for patterns matching Restricted data (credentials, keys, tokens)
- Hard block if detected **(C01)**

---

## On merge to the default branch

### 1. Compliance summary

An organization that aggregates its per-project `compliance.md` files does so on merge, into wherever its own
policy says they live. Nothing in the framework requires it.

> **The publication pipeline that used to be specified here is gone.** It described a static knowledge site, PDF
> exports of every policy, and re-embedding changed files into a vector store — infrastructure the framework
> never shipped, so every adopter was non-compliant with it on the day they adopted. POL-100…POL-104 were
> withdrawn on 2026-09-23 and publication became an organization's own decision, recorded as
> `knowledge_publication` in `org-config.yaml` (`none` by default). `gov knowledge search|show|list` reads the
> markdown already on the machine, which is what the portal was for.

---

## Infrastructure Owner Responsibilities

- Build, maintain, and monitor this pipeline
- Ensure SLAs are met for publication jobs
- Alert Policy Owner on repeated C01 gate failures
- Maintain authentication for the internal static site
- Maintain the vector store and embedding pipeline
