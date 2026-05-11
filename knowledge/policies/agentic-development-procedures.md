---
version: pending-first-commit
effective_date: 2026-05-05
policy_owner: {{POLICY_OWNER_EMAIL}}
parent_policy: knowledge/policies/agentic-development-policy.md
---

# {{ORG_NAME}} — Agentic Development Procedures

This document defines the operational procedures for all agentic development work at {{ORG_NAME}}
Every procedure references the governing policy clause(s) from `agentic-development-policy.md`.

Agents must read this document as part of the knowledge layer stack during every work session.
See `agent.md` for layer loading order.

---

## PROC-01: Onboarding a Code Repository

**Governs:** POL-001, POL-076, POL-079
**Script:** `onboard-repo`
**Spec:** `knowledge/guidance/scripts/onboard-repo-spec.md`

### When to Use
When an existing code repository needs to be brought under the {{ORG_NAME}} Agentic Development Policy for the first time.

### Steps
1. Verify the repo does not already have a `knowledge/` folder
2. Run: `onboard-repo <repo_url> "<repo_description>" "<repo_owner>"`
3. Script creates `knowledge/agent.md` and `knowledge/repo/` placeholder files
4. Script raises PR to repo's default branch
5. Repo owner reviews and merges
6. After merge: repo owner populates `knowledge/repo/structure.md`, `knowledge/repo/environment.md`, `knowledge/repo/patterns.md`

### Success Criteria
- `knowledge/` folder exists in repo's default branch
- `knowledge/agent.md` references org policy correctly
- `knowledge/repo/` is populated with accurate repo knowledge

---

## PROC-02: Creating a Project (PROPOSED State)

**Governs:** POL-041, POL-042, POL-056, POL-057, POL-058, POL-059, POL-060

### Who Performs This
Any authorized GitHub user with access to `{{WORKSPACE_REPO}}`.

### Steps
1. Go to `{{WORKSPACE_REPO}}` on GitHub
2. Create a new GitHub Project with a descriptive name (e.g., "Invoice API v2")
3. Add Issues and/or PRs that define the project scope:
   - At least one Issue or PR is required **(POL-058 — C01)**
   - Issues from other repos identify which repos are involved
4. Add a project description **(POL-059 — C02)**
5. Mark at least one Issue as defining the scope/goals **(POL-060 — C02)**
6. Project is now in `PROPOSED` state — no workspace exists yet

### Notes
- The project ID (`{{ORG_SLUG}}-NNN`) is NOT assigned at this stage — it is assigned by the seed script
- `{{WORKSPACE_REPO}}` is always an implicit participant — do not create an Issue in it to include it

---

## PROC-03: Seeding a Project Workspace (PROPOSED → ACTIVE)

**Governs:** POL-041 to POL-075
**Script:** `seed`
**Spec:** `knowledge/guidance/scripts/seed-spec.md`

### Who Performs This
The developer or agent assigned to the project.

### Pre-conditions
- GitHub Project exists in `{{WORKSPACE_REPO}}` and meets minimum requirements (PROC-02)
- Assignee has `AGENT_WORK_ROOT` configured (env var; defaults to `~/work` if unset)
- Assignee has push access to all repos that will be involved

### Steps
1. Clone `{{WORKSPACE_REPO}}` if not already cloned: `git clone <{{WORKSPACE_REPO}}-url>`
2. Ensure you are on `{{DEFAULT_BRANCH}}` with latest changes: `git checkout {{DEFAULT_BRANCH}} && git pull`
3. Run: `seed <github_project_url> <assignee>`
4. Script prompts for `base_branch` override per repo (default: `dev`) — specify if working on emergency fixes
5. Script scaffolds workspace, clones repos, creates branches
6. Verify: `projects/{{ORG_SLUG}}-NNN-slug/` exists on branch `{{org_slug}}-NNN-slug`
7. Verify: all repos cloned under `<agent_work_root>/{{ORG_SLUG}}-NNN-slug/`
8. Begin work — project is now `ACTIVE`

### Success Criteria
- `projects/{{ORG_SLUG}}-NNN-slug/project.yaml` exists with `status: active`
- Branch `{{org_slug}}-NNN-slug` exists in `{{WORKSPACE_REPO}}` and all identified repos
- `registry.yaml` updated with new project entry

---

## PROC-04: Standard Work Session

**Governs:** POL-113 to POL-130
**Applies to:** Every agent/developer work session on an active project

### Session Start (C01 — complete before any work)

1. **Verify authorization** — read `projects/{{ORG_SLUG}}-NNN-slug/project.yaml`:
   - Confirm `locked_by` matches your identity, OR you are a member of `assigned_to` team
   - Confirm `status: active`
   - Hard stop if either check fails **(POL-113, POL-114)**

2. **Load knowledge layers fresh** — never use cached layers from a prior session **(POL-115)**:
   - Layer 1: Read `{{WORKSPACE_REPO}}/knowledge/` (org-wide, from {{DEFAULT_BRANCH}}) **(POL-076)**
   - Layer 2: Read `projects/{{ORG_SLUG}}-NNN-slug/knowledge/` (project knowledge) **(POL-077)**
   - Layer 3: Read `<cloned-repos>/knowledge/` (repo-local, from project branch) **(POL-078)**
   - Layer 4: Read `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` (your own developer preferences only — do not read other developers' files in this folder) **(POL-079)**

3. **Pull latest** — fetch and pull `{{org_slug}}-NNN-slug` branch in all repos **(POL-116)**

### During Work

- All writes must go to `projects/{{ORG_SLUG}}-NNN-slug/` or to code in cloned repos on `{{org_slug}}-NNN-slug` branch **(POL-087 — C01)**
- Do NOT write to `{{WORKSPACE_REPO}}/knowledge/` **(POL-087 — C01)**
- If a C01 violation is detected mid-session: hard stop, commit nothing, surface to human immediately **(POL-117)**

### Session End (C02)

1. Commit all changes to `{{org_slug}}-NNN-slug` branch in all affected repos **(POL-118)**
2. Update `projects/{{ORG_SLUG}}-NNN-slug/knowledge/` with new learnings **(POL-119)**
3. Update `projects/{{ORG_SLUG}}-NNN-slug/knowledge/compliance.md` if any compliance events occurred **(POL-120)**
4. Push all branches to remote **(POL-121)**

---

## PROC-05: Creating a Task (Multi-Agent Parallel Work)

**Governs:** POL-073 to POL-075
**Script:** `create-task`
**Spec:** `knowledge/guidance/scripts/create-task-spec.md`

### When to Use
When a team needs to split project work among multiple agents/developers working in parallel.

### Steps
1. Identify the GitHub Issue that defines this unit of work
2. Run: `create-task <project_id> <github_issue_url> <assignee_email>`
3. Script creates sub-branch `{{org_slug}}-NNN-slug/<task-slug>` in all repos
4. Assigned developer/agent works exclusively on this sub-branch
5. Sub-branch session start: same as PROC-04 but on sub-branch
6. Sub-branch session end: commit to sub-branch; use `merge-task` when done

### Rules
- Sub-branches merge back to `{{org_slug}}-NNN-slug` ONLY — never to {{DEFAULT_BRANCH}} **(POL-073)**
- Single assignee per sub-branch **(POL-074)**
- Multiple sub-branches can be active simultaneously **(POL-075)**

---

## PROC-06: Merging a Task

**Governs:** POL-073 to POL-075
**Script:** `merge-task`
**Spec:** `knowledge/guidance/scripts/merge-task-spec.md`

### Steps
1. Ensure all work on sub-branch is committed and pushed
2. Run: `merge-task <project_id> <task_id>`
3. Script merges sub-branch into `{{org_slug}}-NNN-slug`
4. Resolve any merge conflicts if prompted
5. Sub-branch is archived and deleted
6. GitHub Issue is marked resolved

---

## PROC-07: Adding a Repository Mid-Project

**Governs:** POL-062 to POL-066
**Script:** `add-repo`
**Spec:** `knowledge/guidance/scripts/add-repo-spec.md`

### When to Use
When project scope expands to require a repo that was not identified at seeding.

### Steps
1. Run: `add-repo <project_id> <repo_url> <role> "<added_reason>"`
2. Optionally specify `--base-branch <branch>` to override the default (`dev`)
3. Script clones repo, creates branch, updates `project.yaml`
4. Verify new repo appears in `project.yaml` `repos[]`

---

## PROC-08: Syncing Org Knowledge Mid-Project

**Governs:** POL-122
**Script:** `sync`
**Spec:** `knowledge/guidance/scripts/sync-spec.md`

### When to Use
When you want to pull in the latest org knowledge updates without pausing/resuming.
Especially useful after a knowledge ingest PR is merged to {{DEFAULT_BRANCH}}.

### Steps
1. Commit all current work first
2. Run: `sync <project_id>`
3. Resolve any merge conflicts if prompted
4. Reload knowledge layers after sync completes

---

## PROC-09: Pausing a Project

**Governs:** POL-049, POL-051
**Script:** `pause`
**Spec:** `knowledge/guidance/scripts/pause-spec.md`

### Steps
1. Commit all current work — no uncommitted changes allowed
2. Run: `pause <project_id>`
3. Verify `project.yaml` shows `status: paused` and `paused_at` is set
4. Project can be resumed at any time via PROC-10

---

## PROC-10: Resuming a Project

**Governs:** POL-049, POL-051, POL-122
**Script:** `resume`
**Spec:** `knowledge/guidance/scripts/resume-spec.md`

### Important
Resuming triggers a **mandatory {{DEFAULT_BRANCH}} sync** **(POL-122 — C01)**. Org knowledge may have changed while the project was paused. The agent must work with current org knowledge.

### Steps
1. Run: `resume <project_id>`
2. Script fetches and merges latest `{{DEFAULT_BRANCH}}`/`base_branch` into all project branches
3. Resolve merge conflicts if prompted — script pauses until resolved
4. Knowledge layers are automatically reloaded
5. Verify `project.yaml` shows `status: active`

---

## PROC-11: Cancelling a Project

**Governs:** POL-052, POL-070
**Script:** `cancel`
**Spec:** `knowledge/guidance/scripts/cancel-spec.md`

### Important
Cancellation does NOT trigger a knowledge close. Code changes are archived but not merged.

### Steps
1. Prepare a clear `cancellation_reason`
2. Run: `cancel <project_id> "<cancellation_reason>"`
3. Script archives and deletes all project branches
4. Verify `project.yaml` on {{DEFAULT_BRANCH}} shows `status: cancelled`

---

## PROC-12: Closing a Project

**Governs:** POL-087 to POL-106
**Scripts:** `close-project` then `close-knowledge` (auto-triggered)
**Specs:** `knowledge/guidance/scripts/close-project-spec.md`, `knowledge/guidance/scripts/close-knowledge-spec.md`

### Pre-close Checklist (C01 — must be complete before running close-project)

- [ ] `projects/{{ORG_SLUG}}-NNN-slug/knowledge/` contains meaningful content
- [ ] `projects/{{ORG_SLUG}}-NNN-slug/knowledge/compliance.md` exists and is current
- [ ] All task sub-branches are merged (via PROC-06)
- [ ] All `project.yaml` mandatory fields are populated
- [ ] `completed_at` is NOT yet set

### Steps — Project Close
1. Complete all items in pre-close checklist
2. Run: `close-project <project_id>`
3. Script merges all project branches to their base branches
4. Resolve merge conflicts if prompted — script pauses until resolved
5. Branches are archived and deleted
6. `project.yaml` status set to `completed`
7. `close-knowledge` is triggered automatically

### Steps — Knowledge Close (auto-triggered)
8. Script reads all content in `projects/{{ORG_SLUG}}-NNN-slug/knowledge/`
9. LLM+RAG synthesizes proposals for org knowledge
10. Branch `{{org_slug}}-NNN-slug-knowledge` created from {{DEFAULT_BRANCH}}
11. PR raised with auto-assigned domain owner reviewers
12. `project.yaml` updated: `knowledge_status: pending_review`

### After Knowledge PR is Raised
- Org Knowledge Owner reviews PR
- **Approved/Merged:** CI/CD updates site, PDFs, vectors; `knowledge_status: merged`
- **Revision requested:** Address comments, submit new PR; `knowledge_status: under_revision`
- **Rejected:** Owner closes PR; `knowledge_status: rejected`
- **Abandoned:** Developer closes PR and deletes branch; `knowledge_status: abandoned`

---

## PROC-13: Requesting a C02 Exception

**Governs:** POL-152 to POL-158

### Steps
1. Identify which exception path applies:
   - Legal constraint → `knowledge/policies/exceptions/legal/`
   - Infrastructure constraint → `knowledge/policies/exceptions/infrastructure/`
   - Architecture constraint → `knowledge/policies/exceptions/architecture/`
   - Other policy constraint → `knowledge/policies/exceptions/policy/`
2. Copy the appropriate `TEMPLATE.md` from that folder
3. Rename: `YYYY-MM-DD-{{ORG_SLUG}}-NNN-slug-brief-description.md`
4. Fill in all required fields
5. Commit to your project branch `{{org_slug}}-NNN-slug`
6. Raise PR to {{DEFAULT_BRANCH}}
7. **Do NOT proceed with the excepted action until the PR is merged** **(POL-154 — C01)**
8. Appropriate domain owner reviews and merges

### Authorization
| Exception Type | Authorized Approver | Current Holder |
|---|---|---|
| Legal | Legal Owner | {{POLICY_OWNER_EMAIL}} |
| Infrastructure | Infrastructure Owner | {{POLICY_OWNER_EMAIL}} |
| Architecture | System/Data Architecture Owner | {{POLICY_OWNER_EMAIL}} |
| Policy | Policy Owner | {{POLICY_OWNER_EMAIL}} |

---

## PROC-14: Proposing Org Knowledge (Standalone)

**Governs:** POL-107 to POL-109
**Script:** `propose-knowledge`
**Spec:** `knowledge/guidance/scripts/propose-knowledge-spec.md`

### When to Use
- Initial bootstrap of `knowledge/` before first project
- Policy Owner updating `knowledge/policies/` directly
- Ad-hoc knowledge that arises outside any project

### Steps
1. Run: `propose-knowledge <branch_slug> "<description>"`
2. Script creates branch `knowledge-<slug>` from {{DEFAULT_BRANCH}}
3. Author knowledge changes manually on this branch
4. Commit and push
5. Run: `propose-knowledge raise-pr <branch_slug>` (or raise PR manually)
6. CODEOWNERS routes PR to appropriate domain owners
7. Domain owner reviews and merges

---

## PROC-15: Developer Offboarding / Emergency Reassignment

**Governs:** POL-053 — C02 Exception Required
**Exception Path:** `knowledge/policies/exceptions/policy/`

### When to Use
When `locked_by` developer becomes unavailable (departure, illness, role change) and the project must continue.

### Steps (Policy Owner performs)
1. Create exception request file in `knowledge/policies/exceptions/policy/` using TEMPLATE.md
   - Include `reassignment_from`, `reassignment_to`, `reassignment_reason`
2. Raise PR to {{DEFAULT_BRANCH}}
3. Policy Owner reviews and merges (or delegates to Policy Representative)
4. After PR is merged:
   - Update `project.yaml` on {{DEFAULT_BRANCH}}: `assigned_to`, `locked_by`, `reassignment_reason`, `reassigned_at`, `reassigned_approved_by`
5. New assignee runs `resume` script before starting any work **(POL-122)**

---

## PROC-16: Quarterly Compliance Review

**Governs:** POL-146 to POL-151
**Frequency:** Quarterly
**Owner:** Policy Owner (`{{POLICY_OWNER_EMAIL}}`)

### Steps
1. Review `knowledge/compliance/` org-level summary
2. Collect per-project `compliance.md` files from completed projects in the quarter
3. Identify patterns: recurring C01 violations, frequent C02 exceptions, C03 deviation clusters
4. Assess whether recurring issues indicate a policy gap or enforcement gap
5. Draft compliance summary for the quarter
6. If policy changes are warranted: use `propose-knowledge` to raise a policy update PR
7. Commit quarterly summary to `knowledge/compliance/YYYY-QN-summary.md`

---

## PROC-17: Updating the Policy

**Governs:** POL-010 to POL-025, POL-107 to POL-109
**Script:** `propose-knowledge`

### Steps
1. Policy Owner identifies need for policy update (from compliance review, domain owner input, etc.)
2. Run `propose-knowledge` to create a `knowledge-<slug>` branch
3. Edit `knowledge/policies/agentic-development-policy.md` and/or `knowledge/policies/roles.md`
4. Raise PR — CODEOWNERS routes to Policy Owner
5. Policy Owner reviews and merges
6. On merge: new policy version is the commit SHA; CI/CD regenerates PDFs, site, vectors
7. All active projects receive the update on next `sync` or `resume`
