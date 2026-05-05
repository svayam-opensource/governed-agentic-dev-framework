---
version: pending-first-commit
effective_date: 2026-05-05
policy_owner: {{POLICY_OWNER_EMAIL}}
---

# {{ORG_NAME}} Agentic Development Policy

**Document:** Agentic Development Policy
**Organization:** {{ORG_NAME}}
**Effective Date:** 2026-05-05
**Policy Owner:** {{POLICY_OWNER_EMAIL}}
**Status:** Active

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Compliance Levels](#2-compliance-levels)
3. [Roles & Responsibilities](#3-roles--responsibilities)
4. [Units of Work (Projects)](#4-units-of-work-projects)
5. [Project Workspace](#5-project-workspace)
6. [Knowledge Management](#6-knowledge-management)
7. [Agent Operating Standards](#7-agent-operating-standards)
8. [Compliance & Enforcement](#8-compliance--enforcement)
9. [Exception Process](#9-exception-process)
10. [Policy Domains](#10-policy-domains)
11. [Appendices](#11-appendices)
- [Appendix A: Glossary](#appendix-a-glossary)
- [Appendix B: Script Inventory](#appendix-b-script-inventory)
- [Appendix C: Role Registry](#appendix-c-role-registry)
- [Clause Index](#clause-index)

---

## 1. Purpose & Scope

### 1.1 Purpose

This document is the primary governance instrument for all agentic development activity at {{ORG_NAME}} It establishes the rules, structures, and standards that all agents — whether AI coding agents, fully autonomous agents, or human developers using AI-assisted tools — must follow when performing work on behalf of the organization. **(POL-001)**

The goal of this policy is to ensure that agentic work is traceable, safe, compliant, and recoverable at every stage. Every rule in this document exists to serve that goal. **(POL-002)**

### 1.2 Scope

This policy applies to all agentic development work performed under the {{ORG_NAME}} GitHub organization, regardless of the autonomy level of the agent performing the work. **(POL-003)**

Specifically, this policy covers:

- **AI coding agents**: tools such as Cursor, GitHub Copilot, Claude Code, or any other AI assistant operating with write access to any organizational repository. **(POL-004)**
- **Fully autonomous agents**: agents that operate without continuous human supervision, executing multi-step plans, calling APIs, writing code, and making commits independently. **(POL-005)**
- **Human developers using AI tools**: human engineers who use any AI-assisted development tool during the course of their work. When an AI tool assists with a task, the human developer is responsible for ensuring the tool's output complies with this policy. **(POL-006)**

### 1.3 Platform

{{ORG_NAME}} builds and operates its own custom agents that call any supported LLM API (including but not limited to Anthropic, OpenAI, and Gemini). All such agents, regardless of the underlying LLM provider, must conform to the same workspace contract defined in this policy. **(POL-007)**

No agent — whether custom-built, vendor-provided, or operating in any hybrid mode — is exempt from this policy. Agents are expected to internalize and self-enforce these rules. **(POL-008)**

### 1.4 Effective Date

This policy takes effect on **2026-05-05**. All active projects initiated on or after this date must comply fully. **(POL-009)**

---

## 2. Compliance Levels

Every rule in this policy is assigned one of three compliance levels. These levels define how strictly a rule must be followed, the conditions under which exceptions are permitted, and how an agent must behave when a rule is implicated.

Understanding and correctly applying compliance levels is itself a non-negotiable requirement. **(POL-010)**

### 2.1 C01 — Non-Negotiable

**C01 rules admit no exceptions under any circumstances.** **(POL-011)**

When an agent detects that a C01 rule has been violated or is about to be violated, it must:

1. Hard stop all work immediately. **(POL-012)**
2. Commit nothing to any branch. **(POL-013)**
3. Surface the violation to the responsible human immediately and wait for explicit human resolution. **(POL-014)**

C01 rules cannot be waived, overridden, or deferred by any role — including the Policy Owner. They represent the absolute floor of organizational safety and integrity. **(POL-015)**

### 2.2 C02 — Always Apply

**C02 rules must be applied in all normal circumstances.** **(POL-016)**

Exceptions to C02 rules are permitted only when all of the following conditions are met:

1. A formal exception request file has been created in the appropriate subfolder under `knowledge/policies/exceptions/`. **(POL-017)**
2. The exception request PR has been reviewed and merged by the authorized domain representative (see Section 9). **(POL-018)**
3. The approved PR exists and is referenceable at the time the exception is exercised. **(POL-019)**

An agent encountering a C02 scenario where an exception may be needed must block all related work until the approved PR exists. Agents may not assume approval is forthcoming or proceed on the basis of verbal or informal confirmation. **(POL-020)**

### 2.3 C03 — Apply Intelligently

**C03 rules are strong defaults that must be applied unless specific context makes an adaptation appropriate.** **(POL-021)**

Adapting a C03 rule does not require a formal exception PR. However:

1. The decision to deviate from a C03 default must be deliberate — not casual or convenience-driven. **(POL-022)**
2. The reasoning for the deviation must be documented in the project knowledge or relevant file at the time the deviation occurs. **(POL-023)**
3. The intent behind the C03 rule must be honored even if the specific implementation is adapted. **(POL-024)**

"Apply Intelligently" is not a license to ignore C03 rules. An agent that ignores a C03 rule without documenting a reasoned adaptation is in violation of this policy. **(POL-025)**

---

## 3. Roles & Responsibilities

### 3.1 Role Types

All governance roles in this policy fall into one of two types:

**Owners** are the accountable parties for their domain. An Owner is responsible for the accuracy and completeness of knowledge in their domain, for the risk appetite of decisions made in their domain, and for the final approval of any PR affecting their domain. Only Owners may approve and merge PRs within their domain. **(POL-026)**

**Managers** are assigned by Owners to perform day-to-day repository and GitHub administrative work within a domain. A Manager may create PRs, manage branches, and perform operational tasks, but a Manager may never approve a PR — only Owners may approve. **(POL-027)**

### 3.2 Role Hierarchy

The following roles are defined in descending order of authority. Higher roles in this hierarchy have authority over lower roles in cross-domain disputes.

---

**Policy Owner**
*Organizational authority: CRO or equivalent executive*

The Policy Owner holds overall authority for this policy and for cross-domain governance decisions. The Policy Owner is the final escalation point for any unresolved conflict between domain owners. Current holder: **{{POLICY_OWNER_EMAIL}}**. **(POL-028)**

---

**Legal Owner**
*Organizational authority: Chief Counsel or equivalent*

The Legal Owner is accountable for all legal compliance knowledge, legal guidance documents, and legal C02 exceptions. Current holder: **TBD** — until filled, this role escalates to the Policy Owner. **(POL-029)**

---

**Infrastructure Owner**
*Organizational authority: CTO or equivalent*

The Infrastructure Owner is accountable for CI/CD pipelines, hosting infrastructure, the vector store, authentication systems, and LLM governance (approved providers and models). Current holder: **TBD** — until filled, this role escalates to the Policy Owner. **(POL-030)**

---

**System Architecture Owner**
*Organizational authority: CIO or equivalent*

The System Architecture Owner is accountable for system design standards and architectural decisions affecting the overall software architecture of organizational systems. Current holder: **TBD** — until filled, this role escalates to the Policy Owner. **(POL-031)**

---

**Data Architecture Owner**
*Organizational authority: CDO or equivalent*

The Data Architecture Owner is accountable for data standards, data modeling decisions, data pipeline architecture, and data governance. Current holder: **TBD** — until filled, this role escalates to the Policy Owner. **(POL-032)**

---

### 3.3 Role Assignment Rules

Every defined role must have a current, named holder at all times. **(POL-033)**

A role that becomes vacant for any reason — resignation, reassignment, organizational change — must be filled promptly. Until a new holder is named, the role's authority escalates to the Policy Owner. **(POL-034)**

One individual may hold multiple roles simultaneously if and only if that arrangement is explicitly documented in `knowledge/policies/roles.md`. A role held by implication or assumption does not constitute a valid assignment. **(POL-035)**

Manager assignments for each role are made exclusively by the role's Owner and must be recorded in `knowledge/policies/roles.md`. **(POL-036)**

Stakeholder and Developer roles are not defined in this policy. They are managed via GitHub organization permissions and team membership. **(POL-037)**

Any change to role assignments — including filling a vacant role, adding a manager, or transferring an owner role — requires a PR approved by the Policy Owner. **(POL-038)**

### 3.4 Approval Authority

Domain owners have final approval authority within their own domain. No other role may approve a PR that falls under a domain owner's purview. **(POL-039)**

When a PR spans multiple domains, each affected domain owner must approve. The Policy Owner resolves any dispute or deadlock between domain owners. **(POL-040)**

---

## 4. Units of Work (Projects)

### 4.1 Project Requirement

All work performed under the {{ORG_NAME}} GitHub organization must be done through a uniquely identifiable unit of work called a **project**. No code may be committed, no knowledge updated, and no organizational resource modified outside the context of an active project. **(POL-041)**

### 4.2 Project ID Format

Every project is identified by a globally unique Project ID in the format `SVM-NNN-slug`, where:

- `SVM` is the fixed organizational prefix.
- `NNN` is a zero-padded sequential number (e.g., `007`, `042`, `100`).
- `slug` is a lowercase, hyphenated identifier derived from the GitHub Project name at seed time.

**(POL-042)**

The NNN sequence number is issued exclusively by the `seed` script reading from `registry.yaml`. Project IDs must never be assigned manually. **(POL-043)**

### 4.3 Project Registry

The repository `{{WORKSPACE_REPO}}` maintains `registry.yaml` as the single authoritative source of truth for all project IDs and their current status. No project exists officially until it is recorded in `registry.yaml`. **(POL-044)**

### 4.4 Project Assignment

A project may be assigned to an individual (`assigned_to: user@email.com`) or to a team (`assigned_to: team-id`). **(POL-045)**

The `locked_by` field records the individual who ran the `seed` script for the project. This field is set once at seed time and never changed except via a C02 reassignment exception. **(POL-046)**

For team-assigned projects, authorized workers are: (a) the `locked_by` individual, or (b) any current member of the `assigned_to` team. **(POL-047)**

### 4.5 Project Lifecycle States

Projects move through the following states:

- **`proposed`**: The GitHub Project has been created by a stakeholder but the `seed` script has not yet been run. No project workspace exists yet. **(POL-048)**
- **`active`**: The `seed` script has been run, the workspace has been scaffolded, and work is in progress. **(POL-049)**
- **`paused`**: Work is temporarily halted. The assignee is unchanged. A project in `paused` state may be resumed by the `locked_by` individual or an authorized team member. **(POL-050)**
- **`completed`**: All work is done, knowledge has been documented, and all project branches have been merged. **(POL-051)**
- **`cancelled`**: The project has been abandoned. All project branches are archived. No knowledge close is performed on cancelled projects. **(POL-052)**

### 4.6 Project Reassignment

A project in `active` or `paused` status may not be reassigned to a different individual or team except via a C02 exception approved by the Policy Owner. **(POL-053)**

Any approved reassignment must document the following fields in `project.yaml`: `reassignment_reason`, `reassigned_at`, and `reassigned_approved_by`. **(POL-054)**

After a reassignment, the new assignee must run the `resume` script before beginning any work. Starting work without running `resume` after a reassignment is a C02 violation. **(POL-055)**

---

## 5. Project Workspace

### 5.1 Central Workspace Repository

`{{WORKSPACE_REPO}}` is the organization-wide central workspace repository. It is not a code repository. It contains the project registry, organizational knowledge, and the workspace folder for every project. **(POL-056)**

`{{WORKSPACE_REPO}}` is always an implicit participant in every project. It does not need to be — and must not be — listed in the `repos[]` array of `project.yaml`. **(POL-057)**

### 5.2 Repository Structure

The `{{WORKSPACE_REPO}}` repository is organized as follows:

```
{{WORKSPACE_REPO}}/
├── registry.yaml                    # project registry, issues SVM-NNN
├── CODEOWNERS                       # maps knowledge/ to domain owners
├── agent.md                         # org-level agent entry point
├── knowledge/                       # org-wide knowledge (see Section 6)
└── projects/
    └── SVM-NNN-slug/                # one folder per project
        ├── project.yaml             # project manifest
        ├── requirements/            # goals, scope, issues, features, tickets
        ├── environment/             # project-specific infra, tools, skills
        ├── knowledge/               # accumulated project knowledge (free-form)
        └── agent.md                 # project agent entry point
```

This structure must be maintained exactly. Agents must not create files or folders outside this structure within `{{WORKSPACE_REPO}}`. **(POL-058)**

### 5.3 Project Manifest (`project.yaml`)

Every active project must have a `project.yaml` file in its workspace folder. This file is the authoritative manifest for the project. **(POL-059)**

The following fields are mandatory in every `project.yaml`:

```yaml
id: SVM-007-invoice-api
slug: invoice-api
description: One-line project intent
github_project: <url>
github_project_name: Invoice API v2
assigned_to: {{POLICY_OWNER_EMAIL}}
locked_by: {{POLICY_OWNER_EMAIL}}
status: active
created_at: 2026-05-05
started_at: 2026-05-05
completed_at: ~
paused_at: ~
cancelled_at: ~
cancellation_reason: ~
reassignment_reason: ~
reassigned_at: ~
reassigned_approved_by: ~
repos:
  - url: https://github.com/{{GITHUB_ORG}}/repo-A
    role: primary          # primary | dependency | read-only
    base_branch: dev       # branch svm-NNN-slug created from; merge back here
    added_at: 2026-05-05
    added_reason: ~
tasks:
  - id: svm-007-invoice-api/api-design
    github_issue: <url>
    assigned_to: developer@your-org.com
    status: active
    created_at: 2026-05-05
    completed_at: ~
knowledge_status: pending_review   # pending_review | merged | rejected | under_revision | abandoned
knowledge_pr: ~
agent_config:
  model: auto
  provider: cursor
```

**(POL-060)**

Any `project.yaml` that is missing a mandatory field, or that contains values inconsistent with this policy, will cause CI/CD validation to fail. CI/CD failure on `project.yaml` schema validation is a C01 event. **(POL-061)**

### 5.4 GitHub Project Pre-Seeding Requirements

Before the `seed` script may be run, the GitHub Project must meet the following minimum conditions.

The following are **C01** (non-negotiable) requirements:

- The GitHub Project must have a name. **(POL-062)**
- The GitHub Project must have at least one linked Issue or PR. **(POL-063)**

The following are **C02** requirements:

- Each linked Issue or PR must belong to an identifiable repository. (Exception allowed only when a project targets `{{WORKSPACE_REPO}}` exclusively.) **(POL-064)**
- The GitHub Project must have a description. **(POL-065)**
- At least one linked Issue must mark the project's scope or goals. **(POL-066)**

### 5.5 Branching Standards

**`{{WORKSPACE_REPO}}` branching**: All project work in `{{WORKSPACE_REPO}}` must branch from `master` and merge back to `master`. **(POL-067)**

**Code repository branching**: The default base branch for code repositories is `dev`. This may be overridden at seed time (for example, to target a production hotfix branch) by specifying a different `base_branch` in `project.yaml`. **(POL-068)**

**Branch naming**: All project branches, in every repository, must be named `svm-NNN-slug`. This naming convention is mandatory and must be enforced by the `seed` script. **(POL-069)**

**Sub-branches for multi-agent work**: When a project involves parallel work across multiple agents or developers, sub-branches are created in the format `svm-NNN-slug/<task-slug>`. **(POL-070)**

**Knowledge close branch**: The knowledge close process uses a dedicated branch named `svm-NNN-slug-knowledge`. **(POL-071)**

**Branch cleanup**: Upon project completion or cancellation, all project branches must be tagged for archival (`archive/svm-NNN-slug`) and then deleted. **(POL-072)**

**Sub-branch merge rule**: Sub-branches must merge back to the parent `svm-NNN-slug` branch only. Sub-branches must never be merged directly to `master`, `dev`, or any base branch. **(POL-073)**

### 5.6 Multi-Agent Coordination

Teams may conduct parallel work using sub-branches (`svm-NNN-slug/<task-slug>`). Each sub-branch is the responsibility of exactly one agent or developer. Multiple assignees per sub-branch are not permitted. **(POL-074)**

Sub-branch tasks must be tracked as entries in the `tasks[]` array of `project.yaml`, each linked to a GitHub Issue. **(POL-075)**

---

## 6. Knowledge Management

### 6.1 Knowledge Layers

Organizational knowledge is organized in four layers. When conflicts arise between knowledge at different layers, the higher-priority layer always takes precedence. **(POL-076)**

The layers in descending order of authority are:

1. **Org-wide knowledge** — `{{WORKSPACE_REPO}}/knowledge/` — highest authority. **(POL-077)**
2. **Project knowledge** — `{{WORKSPACE_REPO}}/projects/SVM-NNN-slug/knowledge/` — second priority. **(POL-078)**
3. **Repo-local knowledge** — `<repo>/knowledge/` — third priority. **(POL-079)**
4. **Developer/agent preferences** — `<agent_work_root>/preferences/agent.md` — lowest priority. **(POL-080)**

Developer preferences cannot override repo-local knowledge. Repo-local knowledge cannot override org-wide knowledge. **(POL-081)**

### 6.2 Org-Wide Knowledge Structure

The `{{WORKSPACE_REPO}}/knowledge/` folder is organized as follows:

```
knowledge/
├── policies/          # formal policies — Policy Owner
│   └── exceptions/
│       ├── legal/
│       ├── infrastructure/
│       ├── architecture/
│       └── policy/
├── legal/             # legal guidance — Legal Owner
├── infrastructure/    # infra, CI/CD, hosting — Infrastructure Owner
├── architecture/
│   ├── system/        # system design — System Architecture Owner
│   └── data/          # data standards — Data Architecture Owner
├── guidance/          # best practices, standards — Policy Owner
├── patterns/          # reusable patterns, playbooks — Policy Owner
├── compliance/        # org-wide compliance summaries
└── accumulated/       # decisions, lessons learned, ADRs
```

**(POL-082)**

The `CODEOWNERS` file in `{{WORKSPACE_REPO}}` maps each folder in `knowledge/` to its domain owner. Agents and CI/CD pipelines rely on `CODEOWNERS` to determine who must review and approve PRs affecting each knowledge domain. **(POL-083)**

### 6.3 Repo-Local Knowledge Structure

Every code repository that participates in organizational projects must contain a `knowledge/` folder with the following structure:

```
knowledge/
├── agent.md           # repo knowledge entry point
├── repo/              # repo structure, environment, patterns
└── projects/
    └── SVM-NNN-slug/  # impact of this project on this repo
        ├── changelog.md
        ├── decisions.md
        └── impact-summary.md
```

**(POL-084)**

This structure is initialized by the `onboard-repo` script. Repositories that have not been onboarded must be onboarded before they can be added to any project. **(POL-085)**

### 6.4 Knowledge Write Restrictions

During an active project, no changes are permitted to `{{WORKSPACE_REPO}}/knowledge/` for any reason **(C01, POL-086)**. This restriction exists to protect the integrity of org-wide knowledge during concurrent project work.

All knowledge writes during an active project are strictly constrained to the project's own knowledge folder: `projects/SVM-NNN-slug/knowledge/`. **(POL-087)**

Project knowledge is intentionally free-form. There is no required structural coupling between project knowledge and org-wide knowledge structure during the project. **(POL-088)**

### 6.5 Knowledge Close Process

When a project is completed, accumulated project knowledge is synthesized and proposed for inclusion in org-wide knowledge through the knowledge close process. The steps are:

1. **Pre-close consolidation**: The developer or agent consolidates all project learnings, decisions, and artifacts into `projects/SVM-NNN-slug/knowledge/`. **(POL-089)**
2. **Script execution**: The `close-knowledge` script is run. It uses LLM+RAG synthesis to map project knowledge to proposed changes in org-wide knowledge. **(POL-090)**
3. **Branch creation**: The script creates a `svm-NNN-slug-knowledge` branch from `master`. **(POL-091)**
4. **PR creation**: The script proposes changes to `knowledge/` on that branch and raises a PR. CODEOWNERS automatically assigns the appropriate domain owners as reviewers. **(POL-092)**
5. **Review**: The Policy Owner and relevant domain owners review the proposed changes and either merge, reject, request revision, or allow abandonment. **(POL-093)**

### 6.6 Knowledge PR Outcomes

A knowledge PR may have one of four outcomes:

- **Merged**: The proposed changes are accepted. The branch is tagged `archive/svm-NNN-slug-knowledge` and deleted. `knowledge_status` in `project.yaml` is set to `merged`. **(POL-094)**
- **Rejected**: The proposed changes are not accepted. The branch is deleted or retained at the owner's discretion. `knowledge_status` is set to `rejected`. **(POL-095)**
- **Under revision**: The owner requests changes. The developer revises on the same branch and submits a new PR. `knowledge_status` is set to `under_revision`. **(POL-096)**
- **Abandoned**: The developer closes the PR and deletes the branch. `knowledge_status` is set to `abandoned`. **(POL-097)**

The code state of a completed project is immutable regardless of the knowledge PR outcome. A completed project remains completed whether its knowledge PR is merged, rejected, or abandoned. **(POL-098)**

### 6.7 Code Problems Discovered Post-Close

If a code defect or issue is discovered after a project has been completed, it must be addressed by raising new GitHub Issues and creating a new project. The original completed project is not reopened under any circumstances. **(POL-099)**

### 6.8 Knowledge Publication

On every merge to `master` in `{{WORKSPACE_REPO}}`, the CI/CD pipeline automatically generates and publishes knowledge in three forms **(C02, POL-100)**:

1. **Static site**: An internal-only website, accessible only behind authentication, intended for developers, governance teams, and audit teams. **(POL-101)**
2. **PDF exports**: Downloadable PDF versions of all knowledge documents, available through the static site, intended for regulators and external auditors. **(POL-102)**
3. **Vector embeddings (RAG)**: Changed files are re-embedded into the organizational vector store, providing agents with up-to-date context for retrieval-augmented generation. Only changed files are re-embedded. **(POL-103)**

All three publication forms are generated from the same markdown source. **(POL-104)**

### 6.9 Standalone Knowledge Operations

Two scripts support knowledge updates outside any active project context:

- **`propose-knowledge`**: Allows any authorized contributor to propose ad-hoc changes to org-wide knowledge. The script raises a PR via CODEOWNERS for domain owner review. **(POL-105)**
- **`onboard-repo`**: Initializes the `knowledge/` folder structure in an existing code repository. Both raises a PR via CODEOWNERS. **(POL-106)**

### 6.10 Quarterly Compliance Review

The Policy Owner must review the org-level compliance summary in `knowledge/compliance/` on a quarterly basis **(C02, POL-107)**. This review must assess whether C01 violations have been surfaced, C02 exceptions are being used appropriately, and C03 deviations are being documented.

Per-project `compliance.md` files feed into the org-level compliance summary. **(POL-108)**

Critical C01 violations escalate to the Policy Owner immediately, regardless of the quarterly review cadence. **(POL-109)**

### 6.11 Org Knowledge Update Proposals

Project knowledge proposals to org-wide knowledge flow through the following process:

1. The Project Knowledge Owner (`{{POLICY_OWNER_EMAIL}}`) reviews accumulated project knowledge at project close. **(POL-110)**
2. The `close-knowledge` script synthesizes proposals using LLM+RAG. **(POL-111)**
3. The `svm-NNN-slug-knowledge` PR is the formal, auditable proposal mechanism. Proposals that are merged become the new org knowledge version, versioned by the commit SHA on `master`. **(POL-112)**

---

## 7. Agent Operating Standards

### 7.1 Standard Work Session

Every agent work session is governed by a mandatory start protocol and a recommended end protocol. Deviating from the start protocol is a C01 violation.

#### Session Start Protocol **(C01)**

Before performing any work whatsoever, an agent must complete all of the following steps in order **(POL-113)**:

1. **Verify lock ownership**: Read `project.yaml` and confirm that the `locked_by` field matches the current user identity. If it does not match, the agent must refuse to proceed and surface this to the human immediately. **(POL-114)**
2. **Verify project status**: Confirm that `status` in `project.yaml` is `active`. Any other status — `paused`, `completed`, `cancelled` — requires the agent to refuse and surface to the human. **(POL-115)**
3. **Load knowledge layers fresh**: Load all four knowledge layers in priority order from their current state in the repository. Knowledge layers must never be used from a previous session's cache across session boundaries. The load order is: **(POL-116)**
   - `{{WORKSPACE_REPO}}/knowledge/` (org-wide, from `master`)
   - `projects/SVM-NNN-slug/knowledge/` (project knowledge)
   - `<cloned-repos>/knowledge/` (repo-local, from project branch)
   - `<agent_work_root>/preferences/agent.md` (developer preferences)
4. **Pull latest branch**: Pull the latest commits from the `svm-NNN-slug` branch in all participating repositories. **(POL-117)**

Only after all four steps are complete may the agent begin work. **(POL-118)**

#### Session End Protocol **(C02)**

At the conclusion of every work session, an agent should complete the following steps **(POL-119)**:

1. Commit all changes to the `svm-NNN-slug` branch. **(POL-120)**
2. Update `projects/SVM-NNN-slug/knowledge/` with any new learnings, decisions, or observations from the session. **(POL-121)**
3. Update `compliance.md` in the project knowledge folder if any compliance events — violations detected, exceptions exercised, C03 deviations made — occurred during the session. **(POL-122)**
4. Push all commits to the remote. **(POL-123)**

### 7.2 Mid-Session C01 Violation

If a C01 violation is detected at any point during a work session, the agent must immediately: hard stop all work, commit nothing, and surface the violation to the responsible human. The session may not continue until the human has explicitly resolved the violation. **(POL-124)**

### 7.3 Agent Work Directory

Each developer or agent must define an `agent_work_root` directory in their preferences (for example, `~/work/`). This directory serves as the local working environment for all project work. **(POL-125)**

Project repositories are cloned into `<agent_work_root>/SVM-NNN-slug/` — one subdirectory per project. **(POL-126)**

Developer preferences are maintained at `<agent_work_root>/preferences/agent.md`. **(POL-127)**

The `agent_work_root` path and its contents must never be committed to any repository. **(POL-128)**

### 7.4 Developer and Agent Preferences

Developer and agent preferences are **C03** instruments. They customize the experience of individual developers or agents within the bounds of org policy. **(POL-129)**

The following customizations are allowed in a preferences file **(POL-130)**:

- Personal coding style and formatting preferences
- Preferred tools, models, and local path configuration
- Personal shortcuts and workflow customizations
- Communication style preferences with the agent

The following must never appear in a preferences file **(POL-131)**:

- Organizational policies of any kind
- Security mandates or compliance level definitions
- Assignment or locking rules
- Knowledge layer priority order

Every preferences file must open with the following declaration **(POL-132)**:

```
# Developer Preferences — C03 only. Org and repo knowledge always take precedence.
```

An agent that detects a preferences file attempting to override org policy, security mandates, compliance levels, or knowledge layer priority must disregard the override and surface it to the human. **(POL-133)**

### 7.5 LLM Governance

Agents must declare both `model` and `provider` in the `agent_config` section of `project.yaml` before beginning work. **(POL-134)**

The organizational default is `model: auto, provider: cursor`. **(POL-135)**

The list of approved LLM providers and models is maintained by the Infrastructure Owner in `knowledge/policies/llm-governance.md`. This list is the authoritative source for what is and is not permitted. **(POL-136)**

Sending any confidential or restricted data to any LLM provider is prohibited regardless of whether the provider is approved **(C01, POL-137)**. Approval of a provider grants permission to use the provider for non-sensitive data only.

Using a prohibited LLM provider — one not listed in `knowledge/policies/llm-governance.md` — is a C01 violation **(POL-138)**. The agent must hard stop and surface this to the human immediately.

### 7.6 Data Classification

All data handled by agents is classified under one of four categories. Agents must apply classification rules without exception. **(POL-139)**

| Classification | Description | Allowed in Knowledge Base |
|---|---|---|
| **Public** | Information intended for public audiences | Yes **(POL-140)** |
| **Internal** | Internal organizational information | Yes **(POL-141)** |
| **Confidential** | Sensitive business information | Only with explicit C02 approval **(POL-142)** |
| **Restricted** | Credentials, secrets, PII, API keys, tokens | Never **(C01, POL-143)** |

Restricted data must never appear in any knowledge folder, any repository, or in any communication with any LLM provider. **(POL-144)**

An agent that detects restricted data in any repository context must immediately hard stop and escalate to the Policy Owner. **(POL-145)**

---

## 8. Compliance & Enforcement

### 8.1 Enforcement Layers

Compliance is enforced through three complementary layers. All three are required.

**Layer 1 — Agent Self-Check (C01)**: At every session start, the agent performs the self-check defined in Section 7.1. This is the first and most immediate line of enforcement. Agent failure to perform the self-check is itself a C01 violation. **(POL-146)**

**Layer 2 — Script Gates**: The lifecycle scripts (`seed`, `close`, `resume`, `cancel`, `pause`, `add-repo`) validate required conditions before executing. Hard blocks are applied on C01 condition failures. Warnings are issued on C02 condition gaps. Scripts must never be modified to bypass these gates. **(POL-147)**

**Layer 3 — CI/CD Checks**: The `{{WORKSPACE_REPO}}` CI/CD pipeline validates every PR to `master` on the following criteria: **(POL-148)**

- `project.yaml` schema compliance for all referenced projects
- `CODEOWNERS` coverage of all `knowledge/` subfolders
- `registry.yaml` integrity and sequential NNN assignment
- Workspace structure of all active projects

CI/CD failures on structural validation are C01 events. A PR that fails CI/CD structural validation must not be merged. **(POL-149)**

### 8.2 Compliance Tracking

Compliance events must be tracked at two levels:

**Per-project compliance**: Every project must maintain a `compliance.md` file in `projects/SVM-NNN-slug/knowledge/`. This file records: all C01 violations detected during the project, all C02 exceptions raised and their approval status, and all C03 deviations with their documented reasoning. **(POL-150)**

**Org-wide compliance**: The `knowledge/compliance/` folder contains the organization-wide compliance summary. This summary is updated automatically at every project close and reviewed by the Policy Owner quarterly. **(POL-151)**

---

## 9. Exception Process

### 9.1 C02 Exception Request Process

When a C02 rule cannot be applied in a specific circumstance, the exception must be formally requested and approved before work proceeds. The process is:

1. The requester creates an exception request file in the appropriate exceptions subfolder: **(POL-152)**
   - Legal exceptions → `knowledge/policies/exceptions/legal/`
   - Infrastructure exceptions → `knowledge/policies/exceptions/infrastructure/`
   - Architecture exceptions → `knowledge/policies/exceptions/architecture/`
   - Policy exceptions → `knowledge/policies/exceptions/policy/`

2. The requester raises a PR for this exception request file. **(POL-153)**

3. The appropriate domain owner reviews the PR and merges it. The act of merging constitutes formal approval. **(POL-154)**

4. The agent blocks all work dependent on the exception until the approved PR is merged and referenceable. **(POL-155)**

### 9.2 Exception File Requirements

An exception request file must document at minimum: the specific C02 rule being excepted (by clause ID), the project or context in which the exception applies, the business reason for the exception, the scope and duration of the exception, and any compensating controls that will be applied. **(POL-156)**

### 9.3 Authorized Representatives

The following individuals are authorized to approve exceptions in their respective domains. Until domain owners are appointed, all exception approvals fall to the Policy Owner. **(POL-157)**

| Domain | Authorized Approver | Current Holder |
|---|---|---|
| Legal exceptions | Legal Owner | {{POLICY_OWNER_EMAIL}} (until Legal Owner appointed) |
| Infrastructure exceptions | Infrastructure Owner | {{POLICY_OWNER_EMAIL}} (until Infrastructure Owner appointed) |
| Architecture exceptions | System/Data Architecture Owner | {{POLICY_OWNER_EMAIL}} (until Architecture Owners appointed) |
| Policy exceptions | Policy Owner | {{POLICY_OWNER_EMAIL}} |

**(POL-158)**

---

## 10. Policy Domains

### 10.1 Infrastructure Policy

**Status:** Pending — Infrastructure Owner to populate via the `propose-knowledge` script.
**Owner:** TBD (Infrastructure Owner). Until filled, Policy Owner holds authority.

The Infrastructure Policy will govern CI/CD pipeline standards, hosting platform requirements, vector store configuration, authentication and authorization requirements, and LLM provider governance. Once published, it will be the authoritative reference for all infrastructure decisions. **(POL-159)**

### 10.2 System Architecture Policy

**Status:** Pending — System Architecture Owner to populate via the `propose-knowledge` script.
**Owner:** TBD (System Architecture Owner). Until filled, Policy Owner holds authority.

The System Architecture Policy will govern system design standards, API contract requirements, inter-service communication patterns, and architectural decision-making processes. **(POL-160)**

### 10.3 Data Architecture Policy

**Status:** Pending — Data Architecture Owner to populate via the `propose-knowledge` script.
**Owner:** TBD (Data Architecture Owner). Until filled, Policy Owner holds authority.

The Data Architecture Policy will govern data modeling standards, data pipeline architecture, data residency and sovereignty requirements, and data governance processes. **(POL-161)**

### 10.4 Legal & Compliance Policy

**Status:** Pending — Legal Owner to populate via the `propose-knowledge` script.
**Owner:** TBD (Legal Owner). Until filled, Policy Owner holds authority.

The Legal & Compliance Policy will govern legal compliance requirements applicable to software development, contractual obligations with third-party tool providers, intellectual property policies, and jurisdictional compliance requirements. **(POL-162)**

---

## 11. Appendices

### Appendix A: Glossary

| Term | Definition |
|---|---|
| **Project** | A uniquely identifiable unit of work identified by `SVM-NNN-slug`. All organizational work must be conducted through a project. |
| **Workspace** | The folder `projects/SVM-NNN-slug/` within `{{WORKSPACE_REPO}}`. Contains all project-specific files and knowledge. |
| **Org-wide knowledge** | Content in `{{WORKSPACE_REPO}}/knowledge/`. The highest-authority knowledge layer. |
| **Project knowledge** | Content in `projects/SVM-NNN-slug/knowledge/`. Second-priority knowledge layer. |
| **Repo-local knowledge** | Content in `<repo>/knowledge/`. Third-priority knowledge layer. |
| **Developer preferences** | Content in `<agent_work_root>/preferences/`. Lowest-priority layer; C03 only. |
| **Seed** | The act of transitioning a project from `proposed` to `active` by running the `seed` script. Creates the project workspace and branches. |
| **Knowledge close** | The process of synthesizing accumulated project knowledge into org-wide knowledge proposals after project completion. |
| **C01** | Compliance level: Non-Negotiable. No exceptions. Agent hard stops on violation. |
| **C02** | Compliance level: Always Apply. Exceptions require formal approval via PR by authorized domain representative. |
| **C03** | Compliance level: Apply Intelligently. Strong default. Deviations allowed only when intent is honored and reasoning is documented. |
| **locked_by** | The individual who ran the `seed` script for a project. Authorizes work sessions. Set once; immutable except via C02 exception. |
| **base_branch** | The branch from which `svm-NNN-slug` was created in a code repository. The branch to which project changes are merged upon completion. |
| **agent_work_root** | The local directory on a developer or agent's machine where project repositories are cloned. Never committed. |
| **CODEOWNERS** | The GitHub file mapping repository folders to their responsible owners for PR review purposes. |
| **registry.yaml** | The authoritative project registry in `{{WORKSPACE_REPO}}`. Source of truth for all project IDs and statuses. |

**(POL-163)**

### Appendix B: Script Inventory

The following scripts constitute the authorized tooling for project and knowledge lifecycle management. Agents and developers must use these scripts rather than performing equivalent operations manually. **(POL-164)**

| Script | Context | Purpose |
|---|---|---|
| `seed` | Project lifecycle | Transitions a project from `proposed` to `active`. Scaffolds workspace, creates branches, issues SVM-NNN. |
| `add-repo` | Project lifecycle | Adds a new code repository to an active project mid-work. |
| `pause` | Project lifecycle | Transitions a project from `active` to `paused`. |
| `resume` | Project lifecycle | Transitions a project from `paused` to `active`. Pulls latest `master` into project branch. |
| `cancel` | Project lifecycle | Transitions a project to `cancelled`. Archives all project branches. |
| `close-project` | Project lifecycle | Transitions a project from `active` to `completed`. Merges all project branches to their base branches. |
| `close-knowledge` | Project lifecycle | Runs LLM+RAG synthesis of project knowledge. Creates knowledge branch and raises knowledge PR. |
| `sync` | Project lifecycle | Pulls latest `master` changes into the project branch on demand. |
| `create-task` | Multi-agent | Creates a sub-branch (`svm-NNN-slug/<task-slug>`) linked to a GitHub Issue. |
| `merge-task` | Multi-agent | Merges a sub-branch back to the parent `svm-NNN-slug` branch. Archives sub-branch and closes linked Issue. |
| `propose-knowledge` | Standalone | Proposes ad-hoc changes to org-wide knowledge outside any active project context. Raises a PR via CODEOWNERS. |
| `onboard-repo` | Standalone | Initializes the `knowledge/` folder structure in an existing code repository. Raises a PR via CODEOWNERS. |

**(POL-165)**

### Appendix C: Role Registry

Current role assignments and manager designations are maintained in `knowledge/policies/roles.md`. That file is the authoritative, up-to-date record of who holds each role. **(POL-166)**

This policy document records initial role assignments at the time of writing. All subsequent changes must be made via PR to `knowledge/policies/roles.md`, approved by the Policy Owner. **(POL-167)**

---

## Clause Index

```
POL-001: This policy is the primary governance instrument for all agentic development at {{ORG_NAME}}.
POL-002: Every rule in this policy exists to ensure agentic work is traceable, safe, compliant, and recoverable.
POL-003: This policy applies to all agentic development work under the {{ORG_NAME}} GitHub organization, regardless of autonomy level.
POL-004: AI coding agents (Cursor, Copilot, Claude Code, etc.) are in scope when they have write access to any org repository.
POL-005: Fully autonomous agents operating without continuous human supervision are in scope.
POL-006: Human developers using AI tools are in scope; they are responsible for tool output compliance.
POL-007: All custom agents calling any LLM API must conform to the same workspace contract defined in this policy.
POL-008: No agent — custom, vendor, or hybrid — is exempt from this policy.
POL-009: This policy takes effect on 2026-05-05; all projects initiated on or after this date must comply fully.
POL-010: Understanding and correctly applying compliance levels is itself a non-negotiable requirement.
POL-011: C01 rules admit no exceptions under any circumstances.
POL-012: On C01 violation, the agent must hard stop all work immediately.
POL-013: On C01 violation, the agent must commit nothing to any branch.
POL-014: On C01 violation, the agent must surface the violation to the responsible human and wait for resolution.
POL-015: C01 rules cannot be waived or overridden by any role, including the Policy Owner.
POL-016: C02 rules must be applied in all normal circumstances.
POL-017: C02 exceptions require a formal exception request file in the appropriate exceptions subfolder.
POL-018: C02 exceptions require the exception PR to be reviewed and merged by the authorized domain representative.
POL-019: The approved C02 exception PR must exist and be referenceable at the time the exception is exercised.
POL-020: Agents must block work until an approved C02 exception PR exists; informal confirmation is insufficient.
POL-021: C03 rules are strong defaults that must be applied unless specific context makes adaptation appropriate.
POL-022: C03 deviation must be deliberate — not casual or convenience-driven.
POL-023: Reasoning for C03 deviation must be documented at the time the deviation occurs.
POL-024: The intent behind a C03 rule must be honored even if the specific implementation is adapted.
POL-025: Ignoring a C03 rule without documented reasoning is a policy violation.
POL-026: Owners are accountable for domain knowledge accuracy, risk appetite, and have exclusive PR approval authority in their domain.
POL-027: Managers may perform administrative work but may never approve PRs; only Owners may approve.
POL-028: Policy Owner holds overall policy authority and is the final escalation point; current holder: {{POLICY_OWNER_EMAIL}}.
POL-029: Legal Owner is accountable for legal compliance knowledge and legal C02 exceptions; current holder: TBD.
POL-030: Infrastructure Owner is accountable for CI/CD, hosting, vector store, authentication, and LLM governance; current holder: TBD.
POL-031: System Architecture Owner is accountable for system design standards; current holder: TBD.
POL-032: Data Architecture Owner is accountable for data standards and data governance; current holder: TBD.
POL-033: Every defined role must have a current, named holder at all times.
POL-034: A vacant role escalates to the Policy Owner until a new holder is named.
POL-035: One person may hold multiple roles only if explicitly documented in knowledge/policies/roles.md.
POL-036: Manager assignments are made by the role's Owner and recorded in knowledge/policies/roles.md.
POL-037: Stakeholder and Developer roles are managed via GitHub org permissions, not defined in this policy.
POL-038: Any change to role assignments requires a PR approved by the Policy Owner.
POL-039: Domain owners have final approval authority within their own domain; no other role may approve domain PRs.
POL-040: Cross-domain PRs require approval from each affected domain owner; Policy Owner resolves disputes.
POL-041: All organizational work must be performed through an active, uniquely identifiable project.
POL-042: Every project is identified by the format SVM-NNN-slug (sequential NNN, lowercase slug from GitHub Project name).
POL-043: Project NNN sequence numbers are issued exclusively by the seed script from registry.yaml; never assigned manually.
POL-044: registry.yaml in {{WORKSPACE_REPO}} is the single authoritative source of truth for all project IDs and statuses.
POL-045: A project may be assigned to an individual (email) or a team (team-id).
POL-046: locked_by records who ran the seed script; set once, never changed except via C02 reassignment exception.
POL-047: For team projects, authorized workers are the locked_by individual or any current member of the assigned_to team.
POL-048: proposed status means the GitHub Project exists but the seed script has not been run.
POL-049: active status means the seed script has been run and work is in progress.
POL-050: paused status means work is temporarily halted; assignee is unchanged.
POL-051: completed status means all work is done, knowledge documented, and branches merged.
POL-052: cancelled status means the project is abandoned; branches are archived; no knowledge close is performed.
POL-053: A project in active or paused status may not be reassigned except via a C02 exception approved by Policy Owner.
POL-054: Approved reassignment must document reassignment_reason, reassigned_at, and reassigned_approved_by in project.yaml.
POL-055: After reassignment, the new assignee must run the resume script before beginning work.
POL-056: {{WORKSPACE_REPO}} is the org-wide central workspace repository; it is not a code repository.
POL-057: {{WORKSPACE_REPO}} is an implicit participant in every project and must not be listed in repos[].
POL-058: The {{WORKSPACE_REPO}} repository structure must be maintained exactly; agents must not create files outside this structure.
POL-059: Every active project must have a project.yaml file in its workspace folder.
POL-060: All mandatory fields must be present and valid in every project.yaml.
POL-061: Missing or invalid project.yaml mandatory fields cause CI/CD failure, which is a C01 event.
POL-062: The GitHub Project must have a name before seeding (C01).
POL-063: The GitHub Project must have at least one linked Issue or PR before seeding (C01).
POL-064: Each linked Issue/PR must belong to an identifiable repo before seeding (C02; exception for {{WORKSPACE_REPO}}-only projects).
POL-065: The GitHub Project must have a description before seeding (C02).
POL-066: At least one linked Issue must mark the project's scope or goals before seeding (C02).
POL-067: All {{WORKSPACE_REPO}} project work branches from master and merges back to master.
POL-068: Default base branch for code repositories is dev; overridable at seed time via base_branch in project.yaml.
POL-069: All project branches in every repository must be named svm-NNN-slug.
POL-070: Sub-branches for parallel multi-agent work are named svm-NNN-slug/<task-slug>.
POL-071: The knowledge close process uses a dedicated branch named svm-NNN-slug-knowledge.
POL-072: On completion or cancellation, all project branches must be tagged archive/svm-NNN-slug and deleted.
POL-073: Sub-branches must merge to svm-NNN-slug only; never directly to master, dev, or any base branch.
POL-074: Each sub-branch is assigned to exactly one agent or developer; multiple assignees per sub-branch are not permitted.
POL-075: Sub-branch tasks must be tracked as entries in tasks[] in project.yaml, each linked to a GitHub Issue.
POL-076: When knowledge layers conflict, higher-priority layers always take precedence.
POL-077: Org-wide knowledge in {{WORKSPACE_REPO}}/knowledge/ is the highest-authority knowledge layer.
POL-078: Project knowledge in projects/SVM-NNN-slug/knowledge/ is the second-priority knowledge layer.
POL-079: Repo-local knowledge in <repo>/knowledge/ is the third-priority knowledge layer.
POL-080: Developer preferences in <agent_work_root>/preferences/agent.md are the lowest-priority knowledge layer.
POL-081: Developer preferences cannot override repo knowledge; repo knowledge cannot override org knowledge.
POL-082: The {{WORKSPACE_REPO}}/knowledge/ folder must follow the defined subdirectory structure exactly.
POL-083: CODEOWNERS in {{WORKSPACE_REPO}} maps each knowledge/ subfolder to its domain owner for PR review.
POL-084: Every participating code repository must contain a knowledge/ folder with the defined structure.
POL-085: Repositories must be onboarded via the onboard-repo script before being added to any project.
POL-086: During an active project, no changes are permitted to {{WORKSPACE_REPO}}/knowledge/ (C01).
POL-087: All knowledge writes during an active project are constrained to projects/SVM-NNN-slug/knowledge/ only.
POL-088: Project knowledge is intentionally free-form; no structural coupling to org knowledge is required during the project.
POL-089: Pre-close consolidation: developer/agent consolidates all project learnings into projects/SVM-NNN-slug/knowledge/.
POL-090: The close-knowledge script uses LLM+RAG synthesis to map project knowledge to org knowledge proposals.
POL-091: The close-knowledge script creates the svm-NNN-slug-knowledge branch from master.
POL-092: The close-knowledge script raises a PR against master; CODEOWNERS auto-assigns domain owners as reviewers.
POL-093: Policy Owner and domain owners review the knowledge PR and determine its outcome.
POL-094: A merged knowledge PR results in archive tag, branch deletion, and knowledge_status: merged.
POL-095: A rejected knowledge PR results in branch deletion or retention at owner discretion and knowledge_status: rejected.
POL-096: An under-revision knowledge PR results in developer revision on the same branch and knowledge_status: under_revision.
POL-097: An abandoned knowledge PR results in developer closing the PR, deleting the branch, and knowledge_status: abandoned.
POL-098: The code state of a completed project is immutable regardless of knowledge PR outcome.
POL-099: Code problems discovered post-close require new GitHub Issues and a new project; the original project is not reopened.
POL-100: On every master merge in {{WORKSPACE_REPO}}, CI/CD generates and publishes knowledge in three forms (C02).
POL-101: Static site publication: internal only, behind authentication, for developers and governance teams.
POL-102: PDF export publication: downloadable from the static site, for regulators and external auditors.
POL-103: Vector embedding publication: changed files re-embedded into the org vector store for agent RAG context.
POL-104: All three publication forms are generated from the same markdown source.
POL-105: The propose-knowledge script allows authorized contributors to propose ad-hoc org knowledge changes via PR.
POL-106: The onboard-repo script initializes knowledge/ structure in an existing code repository via PR.
POL-107: The Policy Owner must review the org-level compliance summary quarterly (C02).
POL-108: Per-project compliance.md files feed into the org-wide compliance summary.
POL-109: Critical C01 violations escalate to the Policy Owner immediately, regardless of quarterly review cadence.
POL-110: Project Knowledge Owner reviews accumulated project knowledge at project close.
POL-111: The close-knowledge script synthesizes org knowledge proposals using LLM+RAG.
POL-112: The svm-NNN-slug-knowledge PR is the formal proposal mechanism; merged proposals are versioned by commit SHA.
POL-113: Before any work, an agent must complete all four session start steps in order (C01).
POL-114: Session start step 1 — verify locked_by matches current user identity; refuse and surface if mismatch (C01).
POL-115: Session start step 2 — verify status is active; refuse and surface if any other status (C01).
POL-116: Session start step 3 — load all four knowledge layers fresh in priority order; never use cached layers across sessions (C01).
POL-117: Session start step 4 — pull latest from svm-NNN-slug branch in all participating repositories (C01).
POL-118: No work may begin until all four session start steps are complete.
POL-119: At session end, agents should complete the four-step end protocol (C02).
POL-120: Session end step 1 — commit all changes to the svm-NNN-slug branch.
POL-121: Session end step 2 — update projects/SVM-NNN-slug/knowledge/ with session learnings.
POL-122: Session end step 3 — update compliance.md if any compliance events occurred during the session.
POL-123: Session end step 4 — push all commits to the remote.
POL-124: A mid-session C01 violation requires immediate hard stop, no commits, and escalation to the human.
POL-125: Each developer/agent must define an agent_work_root directory in their preferences.
POL-126: Project repositories are cloned into <agent_work_root>/SVM-NNN-slug/.
POL-127: Developer preferences are maintained at <agent_work_root>/preferences/agent.md.
POL-128: agent_work_root and its contents must never be committed to any repository.
POL-129: Developer and agent preferences are C03 instruments only.
POL-130: Allowed preference customizations: coding style, preferred tools/models, local paths, shortcuts, communication style.
POL-131: Prohibited preference content: org policies, security mandates, compliance levels, assignment rules, knowledge layer priority.
POL-132: Every preferences file must open with the declaration: "# Developer Preferences — C03 only. Org and repo knowledge always take precedence."
POL-133: An agent detecting a preferences file overriding org policy must disregard the override and surface it to the human.
POL-134: Agents must declare model and provider in agent_config of project.yaml before beginning work.
POL-135: Organizational default is model: auto, provider: cursor.
POL-136: Approved LLM providers and models are listed in knowledge/policies/llm-governance.md, maintained by Infrastructure Owner.
POL-137: Sending confidential or restricted data to any LLM provider is prohibited regardless of provider approval status (C01).
POL-138: Using a prohibited LLM provider is a C01 violation requiring hard stop and escalation.
POL-139: Agents must apply data classification rules without exception.
POL-140: Public data is allowed in the knowledge base.
POL-141: Internal data is allowed in the knowledge base.
POL-142: Confidential data is allowed in the knowledge base only with explicit C02 approval.
POL-143: Restricted data (credentials, secrets, PII, API keys) must never appear in any knowledge folder or repository (C01).
POL-144: Restricted data must never appear in any knowledge folder, repository, or LLM provider communication.
POL-145: An agent detecting restricted data must immediately hard stop and escalate to the Policy Owner.
POL-146: Agent failure to perform the session start self-check is a C01 violation.
POL-147: Script gates hard-block on C01 failures and warn on C02 gaps; scripts must never be modified to bypass gates.
POL-148: CI/CD on {{WORKSPACE_REPO}} validates project.yaml schema, CODEOWNERS coverage, registry.yaml integrity, and workspace structure on every PR to master.
POL-149: CI/CD structural validation failures are C01 events; a failing PR must not be merged.
POL-150: Per-project compliance.md records all C01 violations, C02 exceptions, and C03 deviations for the project.
POL-151: Org-wide compliance summary in knowledge/compliance/ is updated at every project close and reviewed quarterly.
POL-152: C02 exception requests must be filed in the appropriate exceptions subfolder under knowledge/policies/exceptions/.
POL-153: C02 exception requester must raise a PR for the exception request file.
POL-154: The appropriate domain owner reviews and merges the exception PR; the merge constitutes formal approval.
POL-155: Agents block all work dependent on a C02 exception until the approved PR is merged and referenceable.
POL-156: Exception request files must document: rule being excepted, context, business reason, scope/duration, and compensating controls.
POL-157: Until domain owners are appointed, all exception approvals fall to the Policy Owner.
POL-158: Authorized exception approvers by domain are recorded in this policy and kept current in knowledge/policies/roles.md.
POL-159: Infrastructure Policy (pending) will govern CI/CD, hosting, vector store, authentication, and LLM provider governance.
POL-160: System Architecture Policy (pending) will govern system design standards, API contracts, and architectural decisions.
POL-161: Data Architecture Policy (pending) will govern data modeling, pipeline architecture, data residency, and data governance.
POL-162: Legal & Compliance Policy (pending) will govern legal requirements, third-party obligations, IP policy, and jurisdictional compliance.
POL-163: The Glossary defines all key terms used in this policy.
POL-164: Agents and developers must use the authorized scripts rather than performing lifecycle operations manually.
POL-165: The Script Inventory lists all authorized lifecycle and standalone scripts with their purposes.
POL-166: Current role assignments and manager designations are maintained authoritatively in knowledge/policies/roles.md.
POL-167: Changes to role assignments require a PR to knowledge/policies/roles.md approved by the Policy Owner.
```
