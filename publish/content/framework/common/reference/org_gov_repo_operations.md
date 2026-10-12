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
> It moved out of the framework's policy folder on 2026-09-28 because a document under that folder teaches a reader that
> everything there governs — and `gov rules build` found 21 clauses here and 0 rules, which is the signature of a
> spec in a policy folder.

**Owner:** Infrastructure Owner (acting: `<POLICY_OWNER_EMAIL>`)
**Scope:** This specification applies to `<ORG_GOV_REPO>` ONLY.
**Note:** Other repos are not covered by this spec. They adopt the agentic development policy via `gov onboard` without CI/CD changes.

---

## Overview

The `<ORG_GOV_REPO>` CI/CD pipeline runs on every PR and every merge to `<DEFAULT_BRANCH>`. It enforces structural integrity and keeps knowledge publications current.

---

## The repository's layout

The governance repository is split by OWNER (the framework's, the organization's) and, inside each, by PHASE:
`common/` for what every phase shares and `build/` for building software. Each owner keeps one `rules/` store at its
root. `F` = the framework's (`gov upgrade` overwrites it), `O` = the organization's (seeded once, then changed only by
approved pull requests), `G` = gov writes it at run time.

```
framework/                                   F
  framework-specification.md                 how the framework works; every framework rule cites it
  rules/{rules.yaml, checks-catalog.yaml, pol-aliases.yaml, rule-row.schema.yaml}
  common/reference/                          org-config.schema.yaml, gov-command-reference.md, this document
  common/guides/  ·  common/templates/exception-template.md
  build/guides/   ·  build/templates/        todo, project-impact, repo-agent, preferences, workflows/approver-check.yml
  upgrade-moves.json                         G  the record of each move an upgrade made
policies/                                    O
  org-policy.md  governance.yaml  ownership.yaml  VERSION  CHANGELOG.md
  rules/{rules.yaml, checks-catalog.yaml}    G  written by approved policy pull requests (`gov rules propose`)
  common/{authorized-representatives.md, data-classification.md, policy-domains.md}
  build/approved-technologies.md             the list the approved-technology check reads
  history/<version>/                         G  frozen snapshots
  exceptions/<domain>/  ·  actions/<id>/     the organization's exception records and check actions
```

Two phase folders are **reserved**, and gov creates neither: `policies/deploy/unit-catalog/` is reserved for gov-cicd
(the deploy phase's unit catalog), and `policies/run/fleet-catalog/` is reserved for gov-infra (the run phase's fleet
catalog). Each arrives with its own tool, as a phase folder like `common/` and `build/`.

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
> never shipped, so every adopter was non-compliant with it on the day they adopted. Those clauses (§8.8 of the old policy) were
> withdrawn on 2026-09-23 and publication became an organization's own decision, recorded as
> `knowledge_publication` in `policies/governance.yaml` (`none` by default). `gov knowledge search|show|list` reads the
> markdown already on the machine, which is what the portal was for.

---

## How gov setup and gov upgrade treat each shipped file

Every file the framework ships has a mode in the framework's manifest. The mode decides what `gov setup` does
when it creates `<ORG_GOV_REPO>`, and what `gov upgrade` does to it later.

| Mode | `gov setup` (a new org) | `gov upgrade` — file missing | `gov upgrade` — file present and different |
| --- | --- | --- | --- |
| `scaffold-auto` | creates it | creates it | replaces it: the framework owns the file |
| `seed-once` | creates it | creates it | leaves it alone: the file is yours |
| `seed-new` | creates it | does nothing; the dry run lists it as a "starter for new orgs" | leaves it alone: the file is yours |
| `scaffold-prompt` | creates it | creates it | flags it for you to review (no shipped file uses this mode) |

A `seed-new` file is a starter for organizations that adopt after it ships. An organization that adopted earlier
is not handed it by an upgrade: it has written its own, or chosen not to. If you want the starter, copy it from
the framework's content by hand.

Everything under `policies/`, and `org-config.yaml`, is yours whatever mode the manifest gives it: an upgrade
never overwrites it.

### The move record: `framework/upgrade-moves.json`

When a framework release moves one of your files to a new place, `gov upgrade` moves it once and records the move
in `framework/upgrade-moves.json`. A later upgrade reads the record and does not move the file again, so a file you
put back at its old place stays where you put it.

- Only `gov upgrade` writes the record. With `gov upgrade --pr` it is written on the upgrade branch, so it reaches
  `<DEFAULT_BRANCH>` in the same pull request as the moves it records.
- Each entry names the move and the gov version that made it: `{ "move": "<from> → <to>", "version": "<gov version>" }`.
- The framework never ships this file and never removes it. Do not edit it by hand.

---

## Infrastructure Owner Responsibilities

- Build, maintain, and monitor this pipeline
- Ensure SLAs are met for publication jobs
- Alert Policy Owner on repeated C01 gate failures
- Maintain authentication for the internal static site
- Maintain the vector store and embedding pipeline
