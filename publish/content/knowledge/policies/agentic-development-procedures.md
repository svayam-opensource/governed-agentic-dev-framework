---
domain: policies
layer: procedure
compliance: C01
status: current
owner: <POLICY_OWNER_EMAIL>
version: pending-first-commit
effective_date: 2026-05-05
policy_owner: <POLICY_OWNER_EMAIL>
parent_policy: knowledge/policies/agentic-development-policy.md
---

# <ORG_NAME> — Agentic Development Procedures

This document defines the operational procedures for all agentic development work at <ORG_NAME>
Every procedure references the governing policy clause(s) from `agentic-development-policy.md`.

Agents must read this document as part of the knowledge layer stack during every work session.
See `agent.md` for layer loading order.

---

## PROC-01: Onboarding a Code Repository

**Governs:** POL-001, POL-076, POL-079
**Command:** `gov-work onboard`

### When to Use
When an existing code repository needs to be brought under the <ORG_NAME> Agentic Development Policy for the first time.

### Steps
1. Verify the repo does not already have a `knowledge/` folder
2. Run: `gov-work onboard <repo_url> "<repo_description>" "<repo_owner>"`
3. The command creates `knowledge/agent.md` and `knowledge/repo/` placeholder files
4. The command raises PR to repo's default branch
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
Any authorized GitHub user with access to `<WORKSPACE_REPO>`.

### Steps
1. Go to `<WORKSPACE_REPO>` on GitHub
2. Create a new GitHub Project with a descriptive name (e.g., "Invoice API v2")
3. Add Issues and/or PRs that define the project scope:
   - At least one Issue or PR is required **(POL-058 — C01)**
   - Issues from other repos identify which repos are involved
4. Add a project description **(POL-059 — C02)**
5. Mark at least one Issue as defining the scope/goals **(POL-060 — C02)**
6. Project is now in `PROPOSED` state — no workspace exists yet

### Notes
- The project ID (`PRJ-<board#>`) is NOT assigned at this stage — it is assigned by `gov-work seed`
- `<WORKSPACE_REPO>` is always an implicit participant — do not create an Issue in it to include it

---

## PROC-03: Seeding a Project Workspace (PROPOSED → ACTIVE)

**Governs:** POL-041 to POL-075
**Command:** `gov-work seed`

### Who Performs This
The developer or agent assigned to the project.

### Pre-conditions
- GitHub Project exists in `<WORKSPACE_REPO>` and meets minimum requirements (PROC-02)
- Assignee has `AGENT_WORK_ROOT` configured (env var; defaults to `~/work` if unset)
- Assignee has push access to all repos that will be involved

### Steps
1. Clone `<WORKSPACE_REPO>` if not already cloned: `git clone <<WORKSPACE_REPO>-url>`
2. Ensure you are on `<DEFAULT_BRANCH>` with latest changes: `git checkout <DEFAULT_BRANCH> && git pull`
3. Run: `gov-work seed <github_project_url>`
4. The command prompts for `base_branch` override per repo (default: `dev`) — specify if working on emergency fixes
5. The command scaffolds workspace, clones repos, creates branches
6. Verify: `projects/PRJ-<board#>-<slug>/` exists on branch `BRNCH-<board#>-<slug>`
7. Verify: all repos cloned under `<agent_work_root>/PRJ-<board#>-<slug>/`
8. Begin work — project is now `ACTIVE`

### Success Criteria
- The project's GitHub Project board is open (active)
- Branch `BRNCH-<board#>-<slug>` exists in `<WORKSPACE_REPO>` and all identified repos
- The project is discoverable from GitHub (its board and anchor issue exist) — there is no `registry.yaml`

---

## PROC-04: Standard Work Session

**Governs:** POL-113 to POL-130
**Applies to:** Every agent/developer work session on an active project

### Session Start (C01 — complete before any work)

1. **Verify authorization** — derive project state from GitHub (there is no `project.yaml`):
   - Confirm you have write access to the project's linked GitHub Project (the authorization gate); when on a task sub-branch, confirm you are its assignee
   - Confirm the project's GitHub board is open (active)
   - Hard stop if either check fails **(POL-113, POL-114)**

2. **Load knowledge layers fresh** — never use cached layers from a prior session **(POL-115)**:
   - Layer 1: Read `<WORKSPACE_REPO>/knowledge/` (org-wide, from <DEFAULT_BRANCH>) **(POL-076)**
   - Layer 2: Read `projects/PRJ-<board#>-<slug>/knowledge/` (project knowledge) **(POL-077)**
   - Layer 3: Read `<cloned-repos>/knowledge/` (repo-local, from project branch) **(POL-078)**
   - Layer 4: Read `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` (your own developer preferences only — do not read other developers' files in this folder) **(POL-079)**

3. **Pull latest** — fetch and pull `BRNCH-<board#>-<slug>` branch in all repos **(POL-116)**

4. **Read project carry-forward to-do list** — `projects/PRJ-<board#>-<slug>/knowledge/todo.md`. Surface the `## Open` items to the developer before planning new work. This list is project-stateful: it survives sessions and is the agent's mechanism for picking up intermediate work from prior sessions on this same project branch.

### During Work

- All writes must go to `projects/PRJ-<board#>-<slug>/` or to code in cloned repos on `BRNCH-<board#>-<slug>` branch **(POL-087 — C01)**
- Do NOT write to `<WORKSPACE_REPO>/knowledge/` **(POL-087 — C01)**
- Capture intermediate to-dos in `projects/PRJ-<board#>-<slug>/knowledge/todo.md` (`## Open`) as they arise — not at session end.
- If a C01 violation is detected mid-session: hard stop, commit nothing, surface to human immediately **(POL-117)**

### Switching Projects Within a Session

Sessions are agent-lifecycle (one continuous LLM conversation). Projects are git-branch-scoped (each `BRNCH-<board#>-<slug>` is its own context). A single session can span multiple project branches — switching is permitted but is **not** free.

When the developer switches the workspace to a different project branch (e.g. `git checkout brnch-002-other`), the agent must:

1. Re-run **all** session-start steps for the new project (POL-113 through POL-116).
2. Read the new project's `todo.md` — the previous project's open items remain in *its* todo.md on *its* branch and must NOT carry into the new project's working context.
3. Drop any in-memory state derived from the previous project's knowledge layers.

### Session End (C02)

1. Commit all changes to `BRNCH-<board#>-<slug>` branch in all affected repos **(POL-118)**
2. Update `projects/PRJ-<board#>-<slug>/knowledge/` with new learnings **(POL-119)**
3. Update `projects/PRJ-<board#>-<slug>/knowledge/compliance.md` if any compliance events occurred **(POL-120)**
4. Push all branches to remote **(POL-121)**

---

## PROC-05: Creating a Task (Multi-Agent Parallel Work)

**Governs:** POL-073 to POL-075
**Command:** `gov-work task`

### When to Use
When a team needs to split project work among multiple agents/developers working in parallel.

### Steps
1. Identify the GitHub Issue that defines this unit of work
2. Run: `gov-work task <github_issue_url> <assignee_email>`
3. The command creates sub-branch `BRNCH-<board#>-<slug>.ISSUE-<n>` in all repos
4. Assigned developer/agent works exclusively on this sub-branch
5. Sub-branch session start: same as PROC-04 but on sub-branch
6. Sub-branch session end: commit to sub-branch; use `gov-work merge` when done

### Rules
- Sub-branches merge back to `BRNCH-<board#>-<slug>` ONLY — never to <DEFAULT_BRANCH> **(POL-073)**
- Single assignee per sub-branch **(POL-074)**
- Multiple sub-branches can be active simultaneously **(POL-075)**

---

## PROC-06: Merging a Task

**Governs:** POL-073 to POL-075
**Command:** `gov-work merge`

### Steps
1. Ensure all work on sub-branch is committed and pushed
2. Run: `gov-work merge <project_id> <task_id>`
3. The command merges sub-branch into `BRNCH-<board#>-<slug>`
4. Resolve any merge conflicts if prompted
5. Sub-branch is archived and deleted
6. GitHub Issue is marked resolved

---

## PROC-07: Adding a Repository Mid-Project

**Governs:** POL-062 to POL-066
**Command:** `gov-work add-repo`

### When to Use
When project scope expands to require a repo that was not identified at seeding.

### Steps
1. Run: `gov-work add-repo <project_id> <repo_url> <role> "<added_reason>"`
2. Optionally specify `--base-branch <branch>` to override the default (`dev`)
3. The command clones the repo and creates its project branch
4. Verify the new repo is cloned under `<agent_work_root>/PRJ-<board#>-<slug>/` and its branch exists

---

## PROC-08: Syncing Org Knowledge Mid-Project

**Governs:** POL-122
**Command:** `gov-work sync`

### When to Use
When you want to pull in the latest org knowledge updates without pausing/resuming.
Especially useful after a knowledge ingest PR is merged to <DEFAULT_BRANCH>.

### Steps
1. Commit all current work first
2. Run: `gov-work sync <project_id>`
3. Resolve any merge conflicts if prompted
4. Reload knowledge layers after sync completes

---

## PROC-09: Pausing a Project

**Governs:** POL-049, POL-051
**Command:** `gov-work pause`

### Steps
1. Commit all current work — no uncommitted changes allowed
2. Run: `gov-work pause <project_id>`
3. Verify the project's GitHub board reflects the paused state
4. Project can be resumed at any time via PROC-10

---

## PROC-10: Resuming a Project

**Governs:** POL-049, POL-051, POL-122
**Command:** `gov-work resume`

### Important
Resuming triggers a **mandatory <DEFAULT_BRANCH> sync** **(POL-122 — C01)**. Org knowledge may have changed while the project was paused. The agent must work with current org knowledge.

### Steps
1. Run: `gov-work resume <project_id>`
2. The command fetches and merges latest `<DEFAULT_BRANCH>`/`base_branch` into all project branches
3. Resolve merge conflicts if prompted — the command pauses until resolved
4. Knowledge layers are automatically reloaded
5. Verify the project's GitHub board is open (active)

---

## PROC-11: Cancelling a Project

**Governs:** POL-052, POL-070
**Command:** `gov-work cancel`

### Important
Cancellation does NOT trigger a knowledge close. Code changes are archived but not merged.

### Steps
1. Prepare a clear `cancellation_reason`
2. Run: `gov-work cancel <project_id> "<cancellation_reason>"`
3. The command archives and deletes all project branches
4. Verify the project's GitHub board is closed, reflecting the cancelled state

---

## PROC-12: Closing a Project

**Governs:** POL-087 to POL-106
**Command:** `gov-work close` (the knowledge-close step is auto-triggered)

### Pre-close Checklist (C01 — must be complete before running `gov-work close`)

- [ ] `projects/PRJ-<board#>-<slug>/knowledge/` contains meaningful content
- [ ] `projects/PRJ-<board#>-<slug>/knowledge/compliance.md` exists and is current
- [ ] All task sub-branches are merged (via PROC-06)
- [ ] The GitHub Project board and anchor issue are complete (scope issues resolved)
- [ ] The project's GitHub board is not yet closed

### Steps — Project Close
1. Complete all items in pre-close checklist
2. Run: `gov-work close <project_id>`
3. The command merges all project branches to their base branches
4. Resolve merge conflicts if prompted — the command pauses until resolved
5. Branches are archived and deleted
6. The project's GitHub board is closed (done)
7. The knowledge-close step is triggered automatically

### Steps — Knowledge Close (auto-triggered)
8. The command reads all content in `projects/PRJ-<board#>-<slug>/knowledge/`
9. LLM+RAG synthesizes proposals for org knowledge
10. Branch `BRNCH-<board#>-<slug>-knowledge` created from <DEFAULT_BRANCH>
11. PR raised with auto-assigned domain owner reviewers
12. Knowledge status is tracked on the knowledge PR: `pending_review`

### After Knowledge PR is Raised
- Org Knowledge Owner reviews PR
- **Approved/Merged:** CI/CD updates site, PDFs, vectors; knowledge status `merged`
- **Revision requested:** Address comments, submit new PR; knowledge status `under_revision`
- **Rejected:** Owner closes PR; knowledge status `rejected`
- **Abandoned:** Developer closes PR and deletes branch; knowledge status `abandoned`

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
3. Rename: `YYYY-MM-DD-PRJ-<board#>-<slug>-brief-description.md`
4. Fill in all required fields
5. Commit to your project branch `BRNCH-<board#>-<slug>`
6. Raise PR to <DEFAULT_BRANCH>
7. **Do NOT proceed with the excepted action until the PR is merged** **(POL-154 — C01)**
8. Appropriate domain owner reviews and merges

### Authorization
| Exception Type | Authorized Approver | Current Holder |
|---|---|---|
| Legal | Legal Owner | <POLICY_OWNER_EMAIL> |
| Infrastructure | Infrastructure Owner | <POLICY_OWNER_EMAIL> |
| Architecture | System/Data Architecture Owner | <POLICY_OWNER_EMAIL> |
| Policy | Policy Owner | <POLICY_OWNER_EMAIL> |

---

## PROC-14: Proposing Org Knowledge (Standalone)

**Governs:** POL-107 to POL-109
**Command:** `gov-work knowledge`

### When to Use
- Initial bootstrap of `knowledge/` before first project
- Policy Owner updating `knowledge/policies/` directly
- Ad-hoc knowledge that arises outside any project

### Steps
1. Run: `gov-work knowledge <branch_slug> "<description>"`
2. The command creates branch `knowledge-<slug>` from <DEFAULT_BRANCH>
3. Author knowledge changes manually on this branch
4. Commit and push
5. Run: `gov-work knowledge raise-pr <branch_slug>` (or raise PR manually)
6. CODEOWNERS routes PR to appropriate domain owners
7. Domain owner reviews and merges

---

## PROC-15: Developer Offboarding / Emergency Reassignment

**Governs:** POL-053 — C02 Exception Required
**Exception Path:** `knowledge/policies/exceptions/policy/`

### When to Use
When the developer with write access (the anchor-issue assignee) becomes unavailable (departure, illness, role change) and the project must continue.

### Steps (Policy Owner performs)
1. Create exception request file in `knowledge/policies/exceptions/policy/` using TEMPLATE.md
   - Include `reassignment_from`, `reassignment_to`, `reassignment_reason`
2. Raise PR to <DEFAULT_BRANCH>
3. Policy Owner reviews and merges (or delegates to Policy Representative)
4. After PR is merged:
   - Record the reassignment via GitHub: grant the new assignee write access to the project's linked GitHub Project and update the anchor issue's assignees. The reassignment rationale lives in the approved C02 exception PR — there is no `project.yaml` to edit.
5. New assignee runs `gov-work resume` before starting any work **(POL-122)**

---

## PROC-16: Quarterly Compliance Review

**Governs:** POL-146 to POL-151
**Frequency:** Quarterly
**Owner:** Policy Owner (`<POLICY_OWNER_EMAIL>`)

### Steps
1. Review `knowledge/compliance/` org-level summary
2. Collect per-project `compliance.md` files from completed projects in the quarter
3. Identify patterns: recurring C01 violations, frequent C02 exceptions, C03 deviation clusters
4. Assess whether recurring issues indicate a policy gap or enforcement gap
5. Draft compliance summary for the quarter
6. If policy changes are warranted: use `gov-work knowledge` to raise a policy update PR
7. Commit quarterly summary to `knowledge/compliance/YYYY-QN-summary.md`

---

## PROC-17: Updating the Policy

**Governs:** POL-010 to POL-025, POL-107 to POL-109
**Command:** `gov-work knowledge`

### Steps
1. Policy Owner identifies need for policy update (from compliance review, domain owner input, etc.)
2. Run `gov-work knowledge` to create a `knowledge-<slug>` branch
3. Edit `knowledge/policies/agentic-development-policy.md` and/or `knowledge/policies/roles.md`
4. Raise PR — CODEOWNERS routes to Policy Owner
5. Policy Owner reviews and merges
6. On merge: new policy version is the commit SHA; CI/CD regenerates PDFs, site, vectors
7. All active projects receive the update on next `gov-work sync` or `gov-work resume`
