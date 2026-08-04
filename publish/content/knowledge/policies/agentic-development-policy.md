---
domain: policies
layer: mandate
compliance: C01
status: current
owner: <POLICY_OWNER_EMAIL>
version: pending-first-commit
effective_date: 2026-05-05
policy_owner: <POLICY_OWNER_EMAIL>
---

# <ORG_NAME> Agentic Development Policy

**Document:** Agentic Development Policy
**Organization:** <ORG_NAME>
**Effective Date:** 2026-05-05
**Policy Owner:** <POLICY_OWNER_EMAIL>
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

This document is the primary governance instrument for all agentic development activity at <ORG_NAME> It establishes the rules, structures, and standards that all agents — whether AI coding agents, fully autonomous agents, or human developers using AI-assisted tools — must follow when performing work on behalf of the organization. **(POL-001)**

The goal of this policy is to ensure that agentic work is traceable, safe, compliant, and recoverable at every stage. Every rule in this document exists to serve that goal. **(POL-002)**

### 1.2 Scope

This policy applies to all agentic development work performed under the <ORG_NAME> GitHub organization, regardless of the autonomy level of the agent performing the work. **(POL-003)**

Specifically, this policy covers:

- **AI coding agents**: tools such as Cursor, GitHub Copilot, Claude Code, or any other AI assistant operating with write access to any organizational repository. **(POL-004)**
- **Fully autonomous agents**: agents that operate without continuous human supervision, executing multi-step plans, calling APIs, writing code, and making commits independently. **(POL-005)**
- **Human developers using AI tools**: human engineers who use any AI-assisted development tool during the course of their work. When an AI tool assists with a task, the human developer is responsible for ensuring the tool's output complies with this policy. **(POL-006)**

### 1.3 Platform

<ORG_NAME> builds and operates its own custom agents that call any supported LLM API (including but not limited to Anthropic, OpenAI, and Gemini). All such agents, regardless of the underlying LLM provider, must conform to the same workspace contract defined in this policy. **(POL-007)**

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

The Policy Owner holds overall authority for this policy and for cross-domain governance decisions. The Policy Owner is the final escalation point for any unresolved conflict between domain owners. Current holder: **<POLICY_OWNER_EMAIL>**. **(POL-028)**

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

All work performed under the <ORG_NAME> GitHub organization must be done through a uniquely identifiable unit of work called a **project**. No code may be committed, no knowledge updated, and no organizational resource modified outside the context of an active project. **(POL-041)**

### 4.2 Project ID Format

Every project is identified by a globally unique Project ID in the format `PRJ-<board#>-<slug>`, where:

- `PRJ-` is the fixed prefix.
- `<board#>` is the GitHub project **board number** — the integer in the linked GitHub Project's URL — with **no leading zero** (e.g., `7`, `26`, `100`).
- `slug` is a lowercase, hyphenated identifier derived from the GitHub Project name at seed time.

**(POL-042)**

The Project ID is issued exclusively by `gov-work seed` from the linked GitHub project board; it must never be assigned manually. The project **branch** mirrors the ID with the `BRNCH-` prefix and the same board number and slug — `BRNCH-<board#>-<slug>` — and task sub-branches append `.ISSUE-<n>` (POL-074). GitHub is the source of truth for both the issued `id` and its `branch` — there is no `registry.yaml`. Projects seeded under the earlier zero-padded sequence scheme (`PRJ-NNN-<slug>` / `brnch-NNN-<slug>`) keep their original names. **(POL-043)**

### 4.3 Source of Truth (GitHub)

GitHub is the single authoritative source of truth for all project IDs and their current status. The active project is derived from the current git branch (`BRNCH-<board#>-<slug>`) and its linked GitHub Project board; project status is derived from whether that board is open (active) or closed (done). No project exists officially until its GitHub Project board and anchor issue exist. There is no `registry.yaml` or any other per-project state file. **(POL-044)**

### 4.4 Project Assignment

A project's ownership is reflected by the assignees of its anchor issue — an individual or a team. **(POL-045)**

The individual who ran `gov-work seed` for the project is recorded as an audit record (the seed commit / anchor issue); it is **not** an authorization gate. **(POL-046)**

Authorization to work a project derives from **write access to its linked GitHub Project** (`projectV2.viewerCanUpdate`), granted by an owner via `gov-work manage assign` (org owners/admins have access to everything). There is no single project-level lock; ownership of in-progress work is **per task** — each task sub-branch has exactly one assignee (POL-074) — and the session-start check verifies the worker owns the sub-branch they are on (POL-114). **(POL-047)**

### 4.5 Project Lifecycle States

Projects move through the following states:

- **`proposed`**: The GitHub Project has been created by a stakeholder but `gov-work seed` has not yet been run. No project workspace exists yet. **(POL-048)**
- **`active`**: `gov-work seed` has been run, the workspace has been scaffolded, the GitHub board is open, and work is in progress. **(POL-049)**
- **`paused`**: Work is temporarily halted. Ownership is unchanged. A project in `paused` state may be resumed by any worker authorized via write access to its linked GitHub Project (POL-047). **(POL-050)**
- **`completed`**: All work is done, knowledge has been documented, and all project branches have been merged. **(POL-051)**
- **`cancelled`**: The project has been abandoned. All project branches are archived. No knowledge close is performed on cancelled projects. **(POL-052)**

### 4.6 Project Reassignment

A project in `active` or `paused` status may not be reassigned to a different individual or team except via a C02 exception approved by the Policy Owner. **(POL-053)**

Any approved reassignment must document the reassignment reason, date, and approving authority in the approved C02 exception PR (`knowledge/policies/exceptions/policy/`); the change is then reflected by GitHub Project access and the anchor issue's assignees. There is no per-project state file to edit. **(POL-054)**

After a reassignment, the new assignee must run `gov-work resume` before beginning any work. Starting work without running `gov-work resume` after a reassignment is a C02 violation. **(POL-055)**

---

## 5. Project Workspace

### 5.1 Central Workspace Repository

`<WORKSPACE_REPO>` is the organization-wide central workspace repository. It is not a code repository. It contains organizational knowledge and the workspace folder for every project; project state itself is derived from GitHub, not stored here. **(POL-056)**

`<WORKSPACE_REPO>` is always an implicit participant in every project. It does not need to be — and must not be — listed among a project's linked code repos. **(POL-057)**

### 5.2 Repository Structure

The `<WORKSPACE_REPO>` repository is organized as follows:

```
<WORKSPACE_REPO>/
├── CODEOWNERS                       # maps knowledge/ to domain owners
├── agent.md                         # org-level agent entry point
├── knowledge/                       # org-wide knowledge (see Section 6)
└── projects/
    └── PRJ-<board#>-<slug>/                # one folder per project
        ├── requirements/            # goals, scope, issues, features, tickets
        ├── environment/             # project-specific infra, tools, skills
        ├── knowledge/               # accumulated project knowledge (free-form)
        └── agent.md                 # project agent entry point
```

This structure must be maintained exactly. Agents must not create files or folders outside this structure within `<WORKSPACE_REPO>`. **(POL-058)**

### 5.3 Project State (Derived from GitHub)

Every active project's authoritative state is derived live from GitHub — there is no `project.yaml` or any other per-project state file. The linked GitHub Project board plus the project's anchor issue together constitute the authoritative manifest for the project. **(POL-059)**

The following project facts are authoritative and must be resolvable for every active project, from GitHub rather than from a state file:

- **id / slug** — from the GitHub Project board number and name (`PRJ-<board#>-<slug>`).
- **description and goals** — from the GitHub Project and its anchor / scope issues.
- **linked code repos and their base branches** — the repos the board's issues touch; each project branch (`BRNCH-<board#>-<slug>`) is created from a base branch (default `dev`) and merges back to it.
- **ownership** — the anchor issue's assignees (individual or team).
- **authorization** — write access to the linked GitHub Project (`projectV2.viewerCanUpdate`).
- **status** — the board being open (active) or closed (done).
- **knowledge-close status** — reflected by the state of the knowledge-close PR (open / merged / rejected / abandoned).

Tasks are **not** stored in any state file — each task is a GitHub Issue on the board plus a sub-branch (`BRNCH-<board#>-<slug>.ISSUE-<n>`); the board is the source of truth for task state (POL-074). The agent's model and provider are declared in the agent's run configuration (default `model: auto, provider: cursor`; POL-134). **(POL-060)**

Any project whose GitHub-derived state is inconsistent with this policy — a missing anchor issue, a malformed branch name, an unresolvable linked repo — will cause CI/CD validation to fail. Such a validation failure is a C01 event. **(POL-061)**

### 5.4 GitHub Project Pre-Seeding Requirements

Before `gov-work seed` may be run, the GitHub Project must meet the following minimum conditions.

The following are **C01** (non-negotiable) requirements:

- The GitHub Project must have a name. **(POL-062)**
- The GitHub Project must have at least one linked Issue or PR. **(POL-063)**

The following are **C02** requirements:

- Each linked Issue or PR must belong to an identifiable repository. (Exception allowed only when a project targets `<WORKSPACE_REPO>` exclusively.) **(POL-064)**
- The GitHub Project must have a description. **(POL-065)**
- At least one linked Issue must mark the project's scope or goals. **(POL-066)**

### 5.5 Branching Standards

**`<WORKSPACE_REPO>` branching**: All project work in `<WORKSPACE_REPO>` must branch from `<DEFAULT_BRANCH>` and merge back to `<DEFAULT_BRANCH>`. **(POL-067)**

**Code repository branching**: The default base branch for code repositories is `dev`. This may be overridden at seed time (for example, to target a production hotfix branch) by specifying a different base branch when running `gov-work seed`. **(POL-068)**

**Branch naming**: All project branches, in every repository, must be named `BRNCH-<board#>-<slug>`. This naming convention is mandatory and must be enforced by `gov-work seed`. **(POL-069)**

**Sub-branches for multi-agent work**: When a project involves parallel work across multiple agents or developers, sub-branches are created in the format `BRNCH-<board#>-<slug>.ISSUE-<n>`. **(POL-070)**

**Knowledge close branch**: The knowledge close process uses a dedicated branch named `BRNCH-<board#>-<slug>-knowledge`. **(POL-071)**

**Branch cleanup**: Upon project completion or cancellation, all project branches must be tagged for archival (`archive/BRNCH-<board#>-<slug>`) and then deleted. **(POL-072)**

**Sub-branch merge rule**: Sub-branches must merge back to the parent `BRNCH-<board#>-<slug>` branch only. Sub-branches must never be merged directly to `<DEFAULT_BRANCH>`, `dev`, or any base branch. **(POL-073)**

### 5.6 Multi-Agent Coordination

Teams may conduct parallel work using sub-branches (`BRNCH-<board#>-<slug>.ISSUE-<n>`). Each sub-branch is the responsibility of exactly one agent or developer. Multiple assignees per sub-branch are not permitted. **(POL-074)**

Each task corresponds to a GitHub Issue on the project board plus a sub-branch named `BRNCH-<board#>-<slug>.ISSUE-<n>`. Task state lives on the board — an open issue is an active task, a closed issue is done — and is **not** duplicated in any per-project state file. The board is the authoritative source for task assignment and status. **(POL-075)**

---

## 6. Knowledge Management

### 6.1 Knowledge Layers

Organizational knowledge is organized in four layers. When conflicts arise between knowledge at different layers, the higher-priority layer always takes precedence. **(POL-076)**

The layers in descending order of authority are:

1. **Org-wide knowledge** — `<WORKSPACE_REPO>/knowledge/` — highest authority. **(POL-077)**
2. **Project knowledge** — `<WORKSPACE_REPO>/projects/PRJ-<board#>-<slug>/knowledge/` — second priority. **(POL-078)**
3. **Repo-local knowledge** — `<repo>/knowledge/` — third priority. **(POL-079)**
4. **Developer/agent preferences** — `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` — lowest priority. Per-user, keyed on GitHub login; an agent reads only the file matching its current GitHub identity. **(POL-080)**

Developer preferences cannot override repo-local knowledge. Repo-local knowledge cannot override org-wide knowledge. **(POL-081)**

### 6.2 Org-Wide Knowledge Structure

The `<WORKSPACE_REPO>/knowledge/` folder is organized as follows:

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

The `CODEOWNERS` file in `<WORKSPACE_REPO>` maps each folder in `knowledge/` to its domain owner. Agents and CI/CD pipelines rely on `CODEOWNERS` to determine who must review and approve PRs affecting each knowledge domain. **(POL-083)**

### 6.3 Repo-Local Knowledge Structure

Every code repository that participates in organizational projects must contain a `knowledge/` folder with the following structure:

```
knowledge/
├── agent.md           # repo knowledge entry point
├── repo/              # repo structure, environment, patterns
└── projects/
    └── PRJ-<board#>-<slug>/  # impact of this project on this repo
        ├── changelog.md
        ├── decisions.md
        └── impact-summary.md
```

**(POL-084)**

This structure is initialized by `gov-work onboard`. Repositories that have not been onboarded must be onboarded before they can be added to any project. **(POL-085)**

### 6.4 Knowledge Write Restrictions

During an active project, no changes are permitted to `<WORKSPACE_REPO>/knowledge/` for any reason **(C01, POL-086)**. This restriction exists to protect the integrity of org-wide knowledge during concurrent project work.

All knowledge writes during an active project are strictly constrained to the project's own knowledge folder: `projects/PRJ-<board#>-<slug>/knowledge/`. **(POL-087)**

Project knowledge is intentionally free-form. There is no required structural coupling between project knowledge and org-wide knowledge structure during the project. **(POL-088)**

### 6.5 Knowledge Close Process

When a project is completed, accumulated project knowledge is synthesized and proposed for inclusion in org-wide knowledge through the knowledge close process. The steps are:

1. **Pre-close consolidation**: The developer or agent consolidates all project learnings, decisions, and artifacts into `projects/PRJ-<board#>-<slug>/knowledge/`. **(POL-089)**
2. **Knowledge-close step**: The knowledge-close step of `gov-work close` runs. It uses LLM+RAG synthesis to map project knowledge to proposed changes in org-wide knowledge. **(POL-090)**
3. **Branch creation**: It creates a `BRNCH-<board#>-<slug>-knowledge` branch from `<DEFAULT_BRANCH>`. **(POL-091)**
4. **PR creation**: It proposes changes to `knowledge/` on that branch and raises a PR. CODEOWNERS automatically assigns the appropriate domain owners as reviewers. **(POL-092)**
5. **Review**: The Policy Owner and relevant domain owners review the proposed changes and either merge, reject, request revision, or allow abandonment. **(POL-093)**

### 6.6 Knowledge PR Outcomes

A knowledge PR may have one of four outcomes:

- **Merged**: The proposed changes are accepted. The branch is tagged `archive/BRNCH-<board#>-<slug>-knowledge` and deleted. The knowledge-close status is `merged` (reflected by the merged PR). **(POL-094)**
- **Rejected**: The proposed changes are not accepted. The branch is deleted or retained at the owner's discretion. The knowledge-close status is `rejected`. **(POL-095)**
- **Under revision**: The owner requests changes. The developer revises on the same branch and submits a new PR. The knowledge-close status is `under_revision`. **(POL-096)**
- **Abandoned**: The developer closes the PR and deletes the branch. The knowledge-close status is `abandoned`. **(POL-097)**

The code state of a completed project is immutable regardless of the knowledge PR outcome. A completed project remains completed whether its knowledge PR is merged, rejected, or abandoned. **(POL-098)**

### 6.7 Code Problems Discovered Post-Close

If a code defect or issue is discovered after a project has been completed, it must be addressed by raising new GitHub Issues and creating a new project. The original completed project is not reopened under any circumstances. **(POL-099)**

### 6.8 Knowledge Publication

On every merge to `<DEFAULT_BRANCH>` in `<WORKSPACE_REPO>`, the CI/CD pipeline automatically generates and publishes knowledge in three forms **(C02, POL-100)**:

1. **Static site**: An internal-only website, accessible only behind authentication, intended for developers, governance teams, and audit teams. **(POL-101)**
2. **PDF exports**: Downloadable PDF versions of all knowledge documents, available through the static site, intended for regulators and external auditors. **(POL-102)**
3. **Vector embeddings (RAG)**: Changed files are re-embedded into the organizational vector store, providing agents with up-to-date context for retrieval-augmented generation. Only changed files are re-embedded. **(POL-103)**

All three publication forms are generated from the same markdown source. **(POL-104)**

### 6.9 Standalone Knowledge Operations

Two `gov-work` subcommands support knowledge updates outside any active project context:

- **`gov-work knowledge`**: Allows any authorized contributor to propose ad-hoc changes to org-wide knowledge. It raises a PR via CODEOWNERS for domain owner review. **(POL-105)**
- **`gov-work onboard`**: Initializes the `knowledge/` folder structure in an existing code repository. It raises a PR via CODEOWNERS. **(POL-106)**

### 6.10 Quarterly Compliance Review

The Policy Owner must review the org-level compliance summary in `knowledge/compliance/` on a quarterly basis **(C02, POL-107)**. This review must assess whether C01 violations have been surfaced, C02 exceptions are being used appropriately, and C03 deviations are being documented.

Per-project `compliance.md` files feed into the org-level compliance summary. **(POL-108)**

Critical C01 violations escalate to the Policy Owner immediately, regardless of the quarterly review cadence. **(POL-109)**

### 6.11 Org Knowledge Update Proposals

Project knowledge proposals to org-wide knowledge flow through the following process:

1. The Project Knowledge Owner (`<POLICY_OWNER_EMAIL>`) reviews accumulated project knowledge at project close. **(POL-110)**
2. The knowledge-close step of `gov-work close` synthesizes proposals using LLM+RAG. **(POL-111)**
3. The `BRNCH-<board#>-<slug>-knowledge` PR is the formal, auditable proposal mechanism. Proposals that are merged become the new org knowledge version, versioned by the commit SHA on `<DEFAULT_BRANCH>`. **(POL-112)**

---

## 7. Agent Operating Standards

### 7.1 Standard Work Session

Every agent work session is governed by a mandatory start protocol and a recommended end protocol. Deviating from the start protocol is a C01 violation.

#### Session Start Protocol **(C01)**

Before performing any work whatsoever, an agent must complete all of the following steps in order **(POL-113)**:

1. **Verify authorization & task ownership**: Confirm the current user is authorized — they have **write access to the project's linked GitHub Project** (`projectV2.viewerCanUpdate`). When working on a task sub-branch (`BRNCH-<board#>-<slug>.ISSUE-<n>`), confirm that sub-branch's assignee is the current user (per-task lock). If authorization fails, the agent must refuse to proceed and surface this to the human immediately. (Running `gov-work seed` is an audit record, not a gate.) **(POL-114)**
2. **Verify project status**: Confirm the project's GitHub board is **open** (active). Any other state — the board closed (done), or the project paused or cancelled — requires the agent to refuse and surface to the human. **(POL-115)**
3. **Load knowledge layers fresh**: Load all four knowledge layers in priority order from their current state in the repository. Knowledge layers must never be used from a previous session's cache across session boundaries. The load order is: **(POL-116)**
   - `<WORKSPACE_REPO>/knowledge/` (org-wide, from `<DEFAULT_BRANCH>`)
   - `projects/PRJ-<board#>-<slug>/knowledge/` (project knowledge)
   - `<cloned-repos>/knowledge/` (repo-local, from project branch)
   - `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` (your own developer preferences only)
4. **Pull latest branch**: Pull the latest commits from the `BRNCH-<board#>-<slug>` branch in all participating repositories. **(POL-117)**

Only after all four steps are complete may the agent begin work. **(POL-118)**

#### Session End Protocol **(C02)**

At the conclusion of every work session, an agent should complete the following steps **(POL-119)**:

1. Commit all changes to the `BRNCH-<board#>-<slug>` branch. **(POL-120)**
2. Update `projects/PRJ-<board#>-<slug>/knowledge/` with any new learnings, decisions, or observations from the session. **(POL-121)**
3. Update `compliance.md` in the project knowledge folder if any compliance events — violations detected, exceptions exercised, C03 deviations made — occurred during the session. **(POL-122)**
4. Push all commits to the remote. **(POL-123)**

### 7.2 Mid-Session C01 Violation

If a C01 violation is detected at any point during a work session, the agent must immediately: hard stop all work, commit nothing, and surface the violation to the responsible human. The session may not continue until the human has explicitly resolved the violation. **(POL-124)**

### 7.3 Project-Governance Root

Each developer or agent must define a `AGENT_WORK_ROOT` directory — by exporting the env var in their shell (legacy `AGENT_WORK_ROOT` is still honored), or accepting the framework default of `~/prj_gov`. This is the local root for all project governance: the management gov clone, per-project clones, and developer preferences. **(POL-125)**

Per project, a governance clone and the code repos are placed under `$AGENT_WORK_ROOT/projects/PRJ-<board#>-<slug>/` — the gov clone at `$AGENT_WORK_ROOT/projects/PRJ-<board#>-<slug>/<gov-repo>/` and code repos under `.../repos/<repo-name>/`. **(POL-126)**

Developer preferences are maintained at `$AGENT_WORK_ROOT/preferences/<gh-login>.md` — one file per developer, keyed on GitHub login. The framework loads only the file matching the current agent's identity; other files in that directory belong to other developers and must not be read by an agent. **(POL-127)**

The `AGENT_WORK_ROOT` path and its contents must never be committed to any repository. **(POL-128)**

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

Agents must declare both `model` and `provider` in the agent's run configuration before beginning work. **(POL-134)**

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

**Layer 2 — Command Gates**: The lifecycle commands (`gov-work seed`, `gov-work close`, `gov-work resume`, `gov-work cancel`, `gov-work pause`, `gov-work add-repo`) validate required conditions before executing. Hard blocks are applied on C01 condition failures. Warnings are issued on C02 condition gaps. These gates must never be bypassed. **(POL-147)**

**Layer 3 — CI/CD Checks**: The `<WORKSPACE_REPO>` CI/CD pipeline validates every PR to `<DEFAULT_BRANCH>` on the following criteria: **(POL-148)**

- Project workspace structure of all active projects (required folders and `agent.md`)
- `CODEOWNERS` coverage of all `knowledge/` subfolders
- Project ID and branch naming consistency with GitHub (Project boards + anchor issues)
- (There is no `registry.yaml` or `project.yaml` to validate — project state is derived from GitHub)

CI/CD failures on structural validation are C01 events. A PR that fails CI/CD structural validation must not be merged. **(POL-149)**

### 8.2 Compliance Tracking

Compliance events must be tracked at two levels:

**Per-project compliance**: Every project must maintain a `compliance.md` file in `projects/PRJ-<board#>-<slug>/knowledge/`. This file records: all C01 violations detected during the project, all C02 exceptions raised and their approval status, and all C03 deviations with their documented reasoning. **(POL-150)**

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
| Legal exceptions | Legal Owner | <POLICY_OWNER_EMAIL> (until Legal Owner appointed) |
| Infrastructure exceptions | Infrastructure Owner | <POLICY_OWNER_EMAIL> (until Infrastructure Owner appointed) |
| Architecture exceptions | System/Data Architecture Owner | <POLICY_OWNER_EMAIL> (until Architecture Owners appointed) |
| Policy exceptions | Policy Owner | <POLICY_OWNER_EMAIL> |

**(POL-158)**

---

## 10. Policy Domains

### 10.1 Infrastructure Policy

**Status:** Pending — Infrastructure Owner to populate via `gov-work knowledge`.
**Owner:** TBD (Infrastructure Owner). Until filled, Policy Owner holds authority.

The Infrastructure Policy will govern CI/CD pipeline standards, hosting platform requirements, vector store configuration, authentication and authorization requirements, and LLM provider governance. Once published, it will be the authoritative reference for all infrastructure decisions. **(POL-159)**

### 10.2 System Architecture Policy

**Status:** Pending — System Architecture Owner to populate via `gov-work knowledge`.
**Owner:** TBD (System Architecture Owner). Until filled, Policy Owner holds authority.

The System Architecture Policy will govern system design standards, API contract requirements, inter-service communication patterns, and architectural decision-making processes. **(POL-160)**

### 10.3 Data Architecture Policy

**Status:** Pending — Data Architecture Owner to populate via `gov-work knowledge`.
**Owner:** TBD (Data Architecture Owner). Until filled, Policy Owner holds authority.

The Data Architecture Policy will govern data modeling standards, data pipeline architecture, data residency and sovereignty requirements, and data governance processes. **(POL-161)**

### 10.4 Legal & Compliance Policy

**Status:** Pending — Legal Owner to populate via `gov-work knowledge`.
**Owner:** TBD (Legal Owner). Until filled, Policy Owner holds authority.

The Legal & Compliance Policy will govern legal compliance requirements applicable to software development, contractual obligations with third-party tool providers, intellectual property policies, and jurisdictional compliance requirements. **(POL-162)**

---

## 11. Appendices

### Appendix A: Glossary

| Term | Definition |
|---|---|
| **Project** | A uniquely identifiable unit of work identified by `PRJ-<board#>-<slug>`. All organizational work must be conducted through a project. |
| **Workspace** | The folder `projects/PRJ-<board#>-<slug>/` within `<WORKSPACE_REPO>`. Contains all project-specific files and knowledge. |
| **Org-wide knowledge** | Content in `<WORKSPACE_REPO>/knowledge/`. The highest-authority knowledge layer. |
| **Project knowledge** | Content in `projects/PRJ-<board#>-<slug>/knowledge/`. Second-priority knowledge layer. |
| **Repo-local knowledge** | Content in `<repo>/knowledge/`. Third-priority knowledge layer. |
| **Developer preferences** | Content in `$AGENT_WORK_ROOT/preferences/<gh-login>.md` — one file per developer. Lowest-priority knowledge layer; C03 only. |
| **Seed** | The act of transitioning a project from `proposed` to `active` by running `gov-work seed`. Creates the project workspace and branches. |
| **Knowledge close** | The process of synthesizing accumulated project knowledge into org-wide knowledge proposals after project completion. |
| **C01** | Compliance level: Non-Negotiable. No exceptions. Agent hard stops on violation. |
| **C02** | Compliance level: Always Apply. Exceptions require formal approval via PR by authorized domain representative. |
| **C03** | Compliance level: Apply Intelligently. Strong default. Deviations allowed only when intent is honored and reasoning is documented. |
| **seeded_by** | The individual who ran `gov-work seed` for a project — an audit record, set once. Not an authorization gate: authorization is via write access to the linked GitHub Project, and ownership of in-progress work is per task. |
| **base_branch** | The branch from which `BRNCH-<board#>-<slug>` was created in a code repository. The branch to which project changes are merged upon completion. |
| **agent_work_root** | The local directory on a developer or agent's machine where project repositories are cloned. Never committed. |
| **CODEOWNERS** | The GitHub file mapping repository folders to their responsible owners for PR review purposes. |
| **Source of truth (GitHub)** | Project IDs, status, ownership, and authorization are all derived live from GitHub — the current git branch (`BRNCH-<board#>-<slug>`) plus the linked GitHub Project board and anchor issue. There is no `registry.yaml` or `project.yaml`. |

**(POL-163)**

### Appendix B: Command Inventory

The following `gov-work` subcommands constitute the authorized tooling for project and knowledge lifecycle management. `gov-work` is the org's CLI (npm package `@svayam-opensource/gov`, Node 24). Agents and developers must use these commands rather than performing equivalent operations manually. **(POL-164)**

| Command | Context | Purpose |
|---|---|---|
| `gov-work seed` | Project lifecycle | Transitions a project from `proposed` to `active`. Scaffolds workspace, creates branches, issues PRJ-<board#>-<slug>. |
| `gov-work join` | Project lifecycle | Joins an existing project the current user has GitHub Project access to. |
| `gov-work add-repo` | Project lifecycle | Adds a new code repository to an active project mid-work. |
| `gov-work pause` | Project lifecycle | Transitions a project from `active` to `paused`. |
| `gov-work resume` | Project lifecycle | Transitions a project from `paused` to `active`. Pulls latest `<DEFAULT_BRANCH>` into project branch. |
| `gov-work cancel` | Project lifecycle | Transitions a project to `cancelled`. Archives all project branches. |
| `gov-work close` | Project lifecycle | Transitions a project from `active` to `completed`. Merges all project branches to their base branches, then runs the knowledge-close step (LLM+RAG synthesis, knowledge branch, knowledge PR). |
| `gov-work sync` | Project lifecycle | Pulls latest `<DEFAULT_BRANCH>` changes into the project branch on demand. |
| `gov-work task` | Multi-agent | Creates a sub-branch (`BRNCH-<board#>-<slug>.ISSUE-<n>`) linked to a GitHub Issue. |
| `gov-work merge` | Multi-agent | Merges a sub-branch back to the parent `BRNCH-<board#>-<slug>` branch. Archives sub-branch and closes linked Issue. |
| `gov-work knowledge` | Standalone | Proposes ad-hoc changes to org-wide knowledge outside any active project context. Raises a PR via CODEOWNERS. |
| `gov-work onboard` | Standalone | Initializes the `knowledge/` folder structure in an existing code repository. Raises a PR via CODEOWNERS. |

**(POL-165)**

### Appendix C: Role Registry

Current role assignments and manager designations are maintained in `knowledge/policies/roles.md`. That file is the authoritative, up-to-date record of who holds each role. **(POL-166)**

This policy document records initial role assignments at the time of writing. All subsequent changes must be made via PR to `knowledge/policies/roles.md`, approved by the Policy Owner. **(POL-167)**

---

## Clause Index

```
POL-001: This policy is the primary governance instrument for all agentic development at <ORG_NAME>.
POL-002: Every rule in this policy exists to ensure agentic work is traceable, safe, compliant, and recoverable.
POL-003: This policy applies to all agentic development work under the <ORG_NAME> GitHub organization, regardless of autonomy level.
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
POL-028: Policy Owner holds overall policy authority and is the final escalation point; current holder: <POLICY_OWNER_EMAIL>.
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
POL-042: Every project is identified by the format PRJ-<board#>-<slug> (GitHub project board number, no leading zero; lowercase slug from GitHub Project name).
POL-043: Project IDs are issued exclusively by gov-work seed from the linked GitHub board; the branch mirrors the id as BRNCH-<board#>-<slug> (task sub-branches append .ISSUE-<n>); never assigned manually. Legacy PRJ-NNN / brnch-NNN projects keep their names.
POL-044: GitHub (the current branch + the linked Project board + anchor issue) is the single authoritative source of truth for all project IDs and statuses; there is no registry.yaml.
POL-045: A project's ownership is reflected by its anchor issue's assignees (an individual or a team).
POL-046: Running gov-work seed is recorded as an audit record — not an authorization gate.
POL-047: Authorization derives from write access to the linked GitHub Project; no project-level lock — ownership is per task.
POL-048: proposed status means the GitHub Project exists but gov-work seed has not been run.
POL-049: active status means gov-work seed has been run, the board is open, and work is in progress.
POL-050: paused status means work is temporarily halted; assignee is unchanged.
POL-051: completed status means all work is done, knowledge documented, and branches merged.
POL-052: cancelled status means the project is abandoned; branches are archived; no knowledge close is performed.
POL-053: A project in active or paused status may not be reassigned except via a C02 exception approved by Policy Owner.
POL-054: Approved reassignment must document the reassignment reason, date, and approver in the approved C02 exception PR; the change is reflected by GitHub Project access and anchor-issue assignees — there is no project.yaml.
POL-055: After reassignment, the new assignee must run gov-work resume before beginning work.
POL-056: <WORKSPACE_REPO> is the org-wide central workspace repository; it is not a code repository.
POL-057: <WORKSPACE_REPO> is an implicit participant in every project and must not be listed among a project's linked code repos.
POL-058: The <WORKSPACE_REPO> repository structure must be maintained exactly; agents must not create files outside this structure.
POL-059: Every active project's authoritative state is derived from GitHub (Project board + anchor issue); there is no project.yaml or per-project state file.
POL-060: All authoritative project facts (id, description, linked repos, ownership, authorization, status, knowledge-close status) must be resolvable from GitHub.
POL-061: Inconsistent or unresolvable GitHub-derived project state (missing anchor issue, malformed branch, unresolvable repo) causes CI/CD failure, which is a C01 event.
POL-062: The GitHub Project must have a name before seeding (C01).
POL-063: The GitHub Project must have at least one linked Issue or PR before seeding (C01).
POL-064: Each linked Issue/PR must belong to an identifiable repo before seeding (C02; exception for <WORKSPACE_REPO>-only projects).
POL-065: The GitHub Project must have a description before seeding (C02).
POL-066: At least one linked Issue must mark the project's scope or goals before seeding (C02).
POL-067: All <WORKSPACE_REPO> project work branches from <DEFAULT_BRANCH> and merges back to <DEFAULT_BRANCH>.
POL-068: Default base branch for code repositories is dev; overridable at seed time via a base-branch argument to gov-work seed.
POL-069: All project branches in every repository must be named BRNCH-<board#>-<slug>.
POL-070: Sub-branches for parallel multi-agent work are named BRNCH-<board#>-<slug>.ISSUE-<n>.
POL-071: The knowledge close process uses a dedicated branch named BRNCH-<board#>-<slug>-knowledge.
POL-072: On completion or cancellation, all project branches must be tagged archive/BRNCH-<board#>-<slug> and deleted.
POL-073: Sub-branches must merge to BRNCH-<board#>-<slug> only; never directly to <DEFAULT_BRANCH>, dev, or any base branch.
POL-074: Each sub-branch is assigned to exactly one agent or developer; multiple assignees per sub-branch are not permitted.
POL-075: Each task is a GitHub Issue on the board plus a sub-branch; task state lives on the board (open=active, closed=done), not in any per-project state file.
POL-076: When knowledge layers conflict, higher-priority layers always take precedence.
POL-077: Org-wide knowledge in <WORKSPACE_REPO>/knowledge/ is the highest-authority knowledge layer.
POL-078: Project knowledge in projects/PRJ-<board#>-<slug>/knowledge/ is the second-priority knowledge layer.
POL-079: Repo-local knowledge in <repo>/knowledge/ is the third-priority knowledge layer.
POL-080: Developer preferences in $AGENT_WORK_ROOT/preferences/<gh-login>.md are the lowest-priority knowledge layer; per-user, keyed on GitHub login.
POL-081: Developer preferences cannot override repo knowledge; repo knowledge cannot override org knowledge.
POL-082: The <WORKSPACE_REPO>/knowledge/ folder must follow the defined subdirectory structure exactly.
POL-083: CODEOWNERS in <WORKSPACE_REPO> maps each knowledge/ subfolder to its domain owner for PR review.
POL-084: Every participating code repository must contain a knowledge/ folder with the defined structure.
POL-085: Repositories must be onboarded via gov-work onboard before being added to any project.
POL-086: During an active project, no changes are permitted to <WORKSPACE_REPO>/knowledge/ (C01).
POL-087: All knowledge writes during an active project are constrained to projects/PRJ-<board#>-<slug>/knowledge/ only.
POL-088: Project knowledge is intentionally free-form; no structural coupling to org knowledge is required during the project.
POL-089: Pre-close consolidation: developer/agent consolidates all project learnings into projects/PRJ-<board#>-<slug>/knowledge/.
POL-090: The knowledge-close step of gov-work close uses LLM+RAG synthesis to map project knowledge to org knowledge proposals.
POL-091: The knowledge-close step of gov-work close creates the BRNCH-<board#>-<slug>-knowledge branch from <DEFAULT_BRANCH>.
POL-092: The knowledge-close step of gov-work close raises a PR against <DEFAULT_BRANCH>; CODEOWNERS auto-assigns domain owners as reviewers.
POL-093: Policy Owner and domain owners review the knowledge PR and determine its outcome.
POL-094: A merged knowledge PR results in archive tag, branch deletion, and a knowledge-close status of merged.
POL-095: A rejected knowledge PR results in branch deletion or retention at owner discretion and a knowledge-close status of rejected.
POL-096: An under-revision knowledge PR results in developer revision on the same branch and a knowledge-close status of under_revision.
POL-097: An abandoned knowledge PR results in developer closing the PR, deleting the branch, and a knowledge-close status of abandoned.
POL-098: The code state of a completed project is immutable regardless of knowledge PR outcome.
POL-099: Code problems discovered post-close require new GitHub Issues and a new project; the original project is not reopened.
POL-100: On every <DEFAULT_BRANCH> merge in <WORKSPACE_REPO>, CI/CD generates and publishes knowledge in three forms (C02).
POL-101: Static site publication: internal only, behind authentication, for developers and governance teams.
POL-102: PDF export publication: downloadable from the static site, for regulators and external auditors.
POL-103: Vector embedding publication: changed files re-embedded into the org vector store for agent RAG context.
POL-104: All three publication forms are generated from the same markdown source.
POL-105: gov-work knowledge allows authorized contributors to propose ad-hoc org knowledge changes via PR.
POL-106: gov-work onboard initializes knowledge/ structure in an existing code repository via PR.
POL-107: The Policy Owner must review the org-level compliance summary quarterly (C02).
POL-108: Per-project compliance.md files feed into the org-wide compliance summary.
POL-109: Critical C01 violations escalate to the Policy Owner immediately, regardless of quarterly review cadence.
POL-110: Project Knowledge Owner reviews accumulated project knowledge at project close.
POL-111: The knowledge-close step of gov-work close synthesizes org knowledge proposals using LLM+RAG.
POL-112: The BRNCH-<board#>-<slug>-knowledge PR is the formal proposal mechanism; merged proposals are versioned by commit SHA.
POL-113: Before any work, an agent must complete all four session start steps in order (C01).
POL-114: Session start step 1 — verify authorization (write access to the linked GitHub Project) and, on a task sub-branch, that you own it; refuse and surface otherwise (C01).
POL-115: Session start step 2 — verify the GitHub board is open (active); refuse and surface if the board is closed or the project is paused/cancelled (C01).
POL-116: Session start step 3 — load all four knowledge layers fresh in priority order; never use cached layers across sessions (C01).
POL-117: Session start step 4 — pull latest from BRNCH-<board#>-<slug> branch in all participating repositories (C01).
POL-118: No work may begin until all four session start steps are complete.
POL-119: At session end, agents should complete the four-step end protocol (C02).
POL-120: Session end step 1 — commit all changes to the BRNCH-<board#>-<slug> branch.
POL-121: Session end step 2 — update projects/PRJ-<board#>-<slug>/knowledge/ with session learnings.
POL-122: Session end step 3 — update compliance.md if any compliance events occurred during the session.
POL-123: Session end step 4 — push all commits to the remote.
POL-124: A mid-session C01 violation requires immediate hard stop, no commits, and escalation to the human.
POL-125: Each developer/agent defines AGENT_WORK_ROOT (shell env var; legacy AGENT_WORK_ROOT honored; default ~/prj_gov) — the local project-governance root.
POL-126: Per-project clones live under $AGENT_WORK_ROOT/projects/PRJ-<board#>-<slug>/ (gov clone + repos/<repo-name>).
POL-127: Developer preferences are maintained at $AGENT_WORK_ROOT/preferences/<gh-login>.md — one file per developer, keyed on GitHub login.
POL-128: AGENT_WORK_ROOT and its contents must never be committed to any repository.
POL-129: Developer and agent preferences are C03 instruments only.
POL-130: Allowed preference customizations: coding style, preferred tools/models, local paths, shortcuts, communication style.
POL-131: Prohibited preference content: org policies, security mandates, compliance levels, assignment rules, knowledge layer priority.
POL-132: Every preferences file must open with the declaration: "# Developer Preferences — C03 only. Org and repo knowledge always take precedence."
POL-133: An agent detecting a preferences file overriding org policy must disregard the override and surface it to the human.
POL-134: Agents must declare model and provider in the agent's run configuration before beginning work.
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
POL-147: gov command gates hard-block on C01 failures and warn on C02 gaps; these gates must never be bypassed.
POL-148: CI/CD on <WORKSPACE_REPO> validates project workspace structure, CODEOWNERS coverage, and project ID/branch naming against GitHub (no registry.yaml or project.yaml) on every PR to <DEFAULT_BRANCH>.
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
POL-164: Agents and developers must use the authorized gov commands rather than performing lifecycle operations manually.
POL-165: The Command Inventory lists all authorized gov lifecycle and standalone subcommands with their purposes.
POL-166: Current role assignments and manager designations are maintained authoritatively in knowledge/policies/roles.md.
POL-167: Changes to role assignments require a PR to knowledge/policies/roles.md approved by the Policy Owner.
POL-168: Each project maintains a carry-forward to-do list at projects/PRJ-<board#>-<slug>/knowledge/todo.md, scaffolded by gov-work seed from knowledge/guidance/todo-template.md.
POL-169: At session start, an agent must read the project's todo.md and surface its Open items to the developer before planning new work (C01).
POL-170: During work, an agent (or developer) must capture intermediate to-dos in the project's todo.md as they arise — not at session end.
POL-171: Projects are stateful and session-spanning; sessions are not project-bound. When an agent switches to a different project's branch within the same session, it must re-run the full session-start protocol for the new project (POL-113 through POL-116, POL-169) and must not carry forward in-memory context from the previous project.
```
