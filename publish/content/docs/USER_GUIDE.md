# User Guide

This guide is for daily users of the framework — people in an org that has already set it up and are now seeding projects, working on tasks, closing them out, or proposing knowledge changes.

If you're setting the framework up for the first time, see [README.md](../README.md) for the quickstart.
If you're contributing back to the framework itself, see [CONTRIBUTING.md](../CONTRIBUTING.md).

The `gov-work` CLI is installed from npm — `npm i -g @svayam-opensource/gov` (requires Node 24). It is **not** vendored into repos, so repos carry only data instead of a copy of the framework.

---

## Concepts

### Workspace repo

The repository containing this guide is the **workspace repo**. It's not a code repo — it holds:

- `knowledge/` — org-wide policy, guidance, architecture, accumulated learnings
- `projects/` — one folder per project, holding project-specific knowledge
- `org-config.yaml` — your org's specific values (org name, slug, GitHub org, role holders)

There are no per-project state files. Project state — the project index, active/done status, ownership, authorization — is derived live from GitHub (project boards plus their anchor issues); GitHub is the sole source of truth.

Code lives in separate repos that projects reference; the workspace repo coordinates them.

### Project

A unit of work with a unique ID — e.g., `PRJ-26-invoice-api`. The ID is composed of:

- The fixed `PRJ-` prefix
- The GitHub project **board number** (`26`) — the integer in the linked GitHub Project's URL, no leading zero — issued by `gov-work seed`
- A slug derived from the project's GitHub Project name

Each project has:

- A folder: `projects/PRJ-26-invoice-api/`
- A workspace branch: `BRNCH-26-invoice-api` (same board number + slug, `BRNCH-` prefix) in this repo and in every code repo it touches; task sub-branches append `.ISSUE-<n>`
- A lifecycle: `proposed` → `active` → (`paused` ↔ `active`) → `completed` or `cancelled`, tracked by the state of the GitHub board (open = active) rather than a state file
- Ownership — the anchor issue's assignees. Authorization to operate on the project is **write access to its linked GitHub Project** (`projectV2.viewerCanUpdate`), granted by an owner via `gov-work manage assign`. (Org owners/admins have access to everything.)

### Knowledge layers

When an agent or developer reads context, four layers apply, with explicit precedence:

| Layer | Path | Owns what |
|---|---|---|
| 1. Org-wide (highest) | `knowledge/` in this repo | Policy, role definitions, organizational standards |
| 2. Project | `projects/<id>/knowledge/` | Project-specific decisions, learnings, compliance notes |
| 3. Repo-local | `knowledge/` in each code repo | Repo conventions, structure, build environment |
| 4. Developer (lowest) | `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` | Personal preferences |

Higher layer always wins. If org-wide policy says X and a developer preference says Y, X applies.

The developer preferences file is **per-user**, keyed on your GitHub login. `gov-work setup` creates one from `knowledge/guidance/preferences-template.md` the first time you run it (or `gov-work` creates one lazily on your first write op if `gov-work setup` ran without gh authenticated). To keep multiple profiles, save backups alongside (`<login>.md_work`, `<login>.md_oss`) and rotate by `mv`. The framework loads only the file at `<login>.md`.

### Compliance levels

Every rule in the policy is tagged with a level:

- **C01 — Non-Negotiable**: Hard stop. `gov-work` refuses to proceed. Exceptions require Policy Owner approval via PR.
- **C02 — Always Apply**: Block work pending an approved exception PR (in `knowledge/policies/exceptions/`).
- **C03 — Apply Intelligently**: Proceed if you have good reason; document the deviation in the project's `compliance.md`.

The validators (`gov-work validate`) enforce structural invariants. The compliance levels apply to *interpretation* of policy by humans and agents.

---

## Roles

Two role types: **Owners** (accountable, approve PRs) and **Managers** (delegated PR authors).

| Role | Approves what |
|---|---|
| Policy Owner | Any change to `knowledge/policies/`, roles, agent.md |
| Legal Owner | `knowledge/legal/` |
| Infrastructure Owner | `knowledge/infrastructure/`, CI/CD |
| System Architecture Owner | `knowledge/architecture/system/` |
| Data Architecture Owner | `knowledge/architecture/data/` |

CODEOWNERS in this repo enforces the routing automatically — domain owners are auto-assigned as PR reviewers based on which folders the PR touches.

Current role holders are listed in `knowledge/policies/roles.md`. By default at adoption, the Policy Owner holds all roles until they're delegated.

---

## The `gov-work` CLI

`gov-work` is the entry point for most operations. Run it without arguments for an interactive menu, or with a subcommand.

**The everyday flow.** A developer's normal path runs through these verbs:

```bash
gov-work seed           # seed a new project (prompts for GitHub Project)
gov-work join           # join an existing project
gov-work task           # start a sub-branch task on an active project
gov-work sync           # sync with latest base and continue (the "get current" verb)
gov-work merge          # submit a completed task back to the project branch
gov-work close          # close the project (runs the governance gate)
```

**The rest of the lifecycle and admin verbs:**

```bash
gov                # interactive menu
gov-work list           # list all projects
gov-work status PRJ-26-invoice-api
gov-work pause / resume / cancel
gov-work add-repo       # add another code repo to an active project
gov-work knowledge      # propose org knowledge changes
gov-work onboard        # onboard a new code repo into the framework
gov-work anchor         # manage a project's anchor issue
gov-work manage         # grant / change GitHub Project access (subcommands: list, assign, reassign, unassign)
gov-work org            # org-level configuration
gov-work validate       # run the structural validators
gov-work setup          # bootstrap the workspace (first-time or re-run)
gov doctor         # check the environment and dependencies
gov-work upgrade        # pull a framework upgrade
```

The full subcommand set is: `seed`, `join`, `task`, `merge`, `sync`, `add-repo`, `close`, `pause`, `resume`, `cancel`, `manage`, `anchor`, `knowledge`, `onboard`, `validate`, `list`, `status`, `org`, `setup`, `doctor`, `upgrade`.

---

## Lifecycle walkthrough

### Seeding a project

Seed a new project with `gov-work seed`:

```bash
gov-work seed
```

Prompts:
1. Which GitHub org to look in for Projects (defaults to your org)
2. Which GitHub Project to seed from (only Projects you have write access to)
3. Who to assign as project owner (defaults to current user; recorded as the anchor issue's assignee)
4. For each repo the GitHub Project's issues touch: confirm and pick a base branch (defaults to `dev`)

What it does (Direction A — HOME stays on default branch throughout):
1. Validates the GitHub Project exists, has issues, has a name, and that you have write access to it (`projectV2.viewerCanUpdate`).
2. Reads the GitHub project board number and composes `PRJ-<board#>-<slug>` and `BRNCH-<board#>-<slug>`.
3. **In the HOME workspace, on the default branch:** creates `projects/PRJ-<board#>-<slug>/.gitkeep` as a stub. Commits + pushes. Home checkout never leaves the default branch.
4. **Creates the per-project workspace** at `$AGENT_WORK_ROOT/PRJ-<board#>-<slug>/` as **git worktrees** of the shared base clones under `$AGENT_WORK_ROOT/.bases/` (not full per-project clones):
   - Adds a worktree of this repo at `<workspace_repo>/` on `BRNCH-<board#>-<slug>` (created from default). Full `projects/PRJ-<board#>-<slug>/*` scaffolding (agent.md, knowledge/, etc.) lives here, on the project branch. Pushed.
   - For each repo linked to the GitHub Project: adds a worktree at `<repo>/` on `BRNCH-<board#>-<slug>` (created from base). Pushed.

After seeding, the command prints a `cd` line and a ready-to-paste first-session prompt. Day-to-day project work happens entirely inside the per-project workspace; the HOME repo is only for `gov-work manage` operations.

### Creating a task (sub-branch)

For multi-agent or parallel work within a project, create sub-branches per task with `gov-work task`:

```bash
gov-work task
```

Each task corresponds to one GitHub Issue inside the project. The task gets its own sub-branch (`BRNCH-<board#>-<slug>.ISSUE-<n>`) in every repo, with a single assignee. Multiple tasks can run in parallel.

When done, submit it with `gov-work merge`:

```bash
gov-work merge
```

This merges the sub-branch into the project branch (NOT into the code repo's base branch — that happens at project close), archives the sub-branch, and closes the GitHub issue.

### Pausing / resuming

```bash
gov-work pause PRJ-26-invoice-api      # → status: paused
gov-work resume PRJ-26-invoice-api     # → status: active, pulls latest from default and base branches
```

Resume includes a mandatory sync of the workspace default branch and each code repo's base branch into the project branch. This pulls in any policy or knowledge updates that landed while the project was paused.

### Sync (without pausing)

```bash
gov-work sync PRJ-26-invoice-api
```

Same merge-in-from-default behavior as resume, but without changing status. Use mid-project to pick up a freshly-merged policy update. This is the "get current and continue" verb you run day-to-day.

### Closing

Close the project with `gov-work close`, which runs the governance gate:

```bash
gov-work close PRJ-26-invoice-api
```

Pre-close gate (C01, hard fail if not met):
- `projects/<id>/knowledge/` contains at least one file
- `projects/<id>/knowledge/compliance.md` exists
- The project's anchor issue is present and its assignees are set

Then:
1. Project branch is merged into each code repo's `base_branch`
2. Project completion is recorded on GitHub — the board is closed (status → done)
3. The **test-merge gate** runs locally: validators check the proposed post-merge state of the workspace default branch
4. If validators pass, the project branch is fast-forwarded into the local default and pushed
5. Project branches are archived (tag) and deleted in all repos
6. The knowledge-close step of `gov-work close` runs automatically — see below

If the test-merge gate fails, your local default branch is unchanged and you get specific error messages. Fix the cause, re-run `gov-work close`.

### Knowledge close

After `gov-work close`, the framework offers to synthesize project knowledge into proposals for the org-wide knowledge base:

1. A new branch is created: `BRNCH-<board#>-<slug>-knowledge`
2. (LLM/agent step — currently manual) Project knowledge is reviewed and proposed updates to `knowledge/` are committed to that branch
3. A PR is opened against the default branch
4. CODEOWNERS auto-assigns reviewers
5. The knowledge-close status is reflected by the state of that PR (open = pending review)

Knowledge close PRs are reviewed normally. Outcome (merged / rejected / abandoned) is reflected by the PR's state.

### Cancelling

```bash
gov-work cancel PRJ-26-invoice-api "reason text"
```

Branches are tagged-then-deleted. **No merge to base branches**. No knowledge close. `cancellation_reason` is required (C01).

Code changes are preserved in archive tags (`archive/<branch>`) — recoverable but not merged.

---

## Knowledge proposals (outside any project)

For policy updates, ad-hoc learnings, or initial bootstrap knowledge — anything that isn't tied to a specific project:

```bash
gov-work knowledge
```

Walks you through:
1. Choosing a slug (e.g., `auth-pattern-update`)
2. Creating branch `knowledge-<slug>`
3. Letting you edit `knowledge/` files manually
4. Optionally raising the PR with `--submit`

This is the right path for:
- Policy text updates (Policy Owner)
- Adding new guidance documents
- Capturing learnings that arose outside a project

---

## Exception process

When you need to deviate from policy, raise an exception PR:

1. Copy the appropriate template from `knowledge/policies/exceptions/<domain>/TEMPLATE.md`:
   - `legal/` — legal/regulatory deviations (Legal Owner approves)
   - `infrastructure/` — CI/CD, hosting (Infrastructure Owner)
   - `architecture/` — system or data architecture (the relevant Architecture Owner)
   - `policy/` — anything else, including project reassignment (Policy Owner)
2. Fill in: rule being excepted, justification, risk assessment, alternatives considered, exception start/end dates
3. Commit on your project branch
4. Raise a PR
5. Wait for the appropriate Owner to review and merge
6. **Do not proceed with the excepted action until the PR is merged**

C02 rules require an approved exception PR. C03 rules just require documentation in `projects/<id>/knowledge/compliance.md`.

---

## Repo-local knowledge

Code repos under the framework have their own `knowledge/` folder:

- `knowledge/agent.md` — entry point pointing to layer priority and writes restrictions
- `knowledge/repo/structure.md` — directory layout, modules, packages
- `knowledge/repo/environment.md` — build tools, dependencies, setup
- `knowledge/repo/patterns.md` — coding conventions specific to this repo
- `knowledge/projects/<id>/` — per-project impact notes (changelog, decisions, impact-summary)

To onboard an existing code repo:

```bash
gov-work onboard
```

This scaffolds the `knowledge/` structure and raises a PR in that repo. Repo owners populate the placeholder files post-merge.

---

## Common pitfalls

**Validators failing on local `gov-work close`.** Usually means required project knowledge is missing, the anchor issue is misconfigured, or there's a leftover placeholder somewhere. Read the specific error — the validators name files and lines.

**"Branch already exists" errors during seed.** Someone may have manually created a branch matching the pattern. Resolve manually and re-run.

**Test-merge gate fails after a sync.** Pull happens correctly but a downstream check sees something it doesn't like. Check the validator output: it tells you which check (schema/lifecycle/cross-refs) and which file/line. The fix is in your branch; re-run after fixing.

**Knowledge close PR has nothing to review.** That happens if no LLM/agent synthesis ran and there were no manual edits. The branch still gets created so the project state can transition; the PR may be closed without merge if nothing's worth proposing.

**Lost track of which branch you're on.** `gov-work status <id>` shows the project state and branch. `gov-work list` shows all projects.

**Want to undo a close.** Don't. Undoing a close requires reverting merges in multiple repos and re-creating archived branches. Better to seed a follow-up project.

---

## Where to dig deeper

- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) — step-by-step day-in-the-life of working on a project, including how to prompt the agent
- `knowledge/policies/agentic-development-policy.md` — the full policy text with all clause IDs
- `knowledge/policies/roles.md` — current role holders
- `gov-work validate` — exactly which invariants are checked
- The local pre-merge gate — the validators `gov-work` runs before a merge or close
- `gov-work upgrade` — pulling upstream framework updates

The framework is intentionally small — the policy under 1000 lines and the validators compact. Read the source when in doubt.
