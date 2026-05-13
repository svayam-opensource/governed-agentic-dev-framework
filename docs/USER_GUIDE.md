# User Guide

This guide is for daily users of the framework — people in an org that has already set it up and are now seeding projects, working on tasks, closing them out, or proposing knowledge changes.

If you're setting the framework up for the first time, see [README.md](../README.md) for the quickstart.
If you're contributing back to the framework itself, see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Concepts

### Workspace repo

The repository containing this guide is the **workspace repo**. It's not a code repo — it holds:

- `knowledge/` — org-wide policy, guidance, architecture, accumulated learnings
- `projects/` — one folder per project, with a manifest (`project.yaml`) and project-specific knowledge
- `registry.yaml` — the authoritative project counter and index
- `scripts/` — automation
- `org-config.yaml` — your org's specific values (org name, slug, GitHub org, role holders)

Code lives in separate repos that projects reference; the workspace repo coordinates them.

### Project

A unit of work with a unique, sequential ID — e.g., `ACME-007-invoice-api`. The ID is composed of:

- Your org's slug prefix (`ACME` here, set in `org-config.yaml`)
- A zero-padded sequence number (`007`) issued by the seed script from `registry.yaml`
- A slug derived from the project's GitHub Project name

Each project has:

- A folder: `projects/ACME-007-invoice-api/`
- A workspace branch: `acme-007-invoice-api` (lowercase) in this repo and in every code repo it touches
- A manifest: `projects/ACME-007-invoice-api/project.yaml`
- A lifecycle: `proposed` → `active` → (`paused` ↔ `active`) → `completed` or `cancelled`
- An assignee — single person or team. Only the assignee may operate on the project.

### Knowledge layers

When an agent or developer reads context, four layers apply, with explicit precedence:

| Layer | Path | Owns what |
|---|---|---|
| 1. Org-wide (highest) | `knowledge/` in this repo | Policy, role definitions, organizational standards |
| 2. Project | `projects/<id>/knowledge/` | Project-specific decisions, learnings, compliance notes |
| 3. Repo-local | `knowledge/` in each code repo | Repo conventions, structure, build environment |
| 4. Developer (lowest) | `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` | Personal preferences |

Higher layer always wins. If org-wide policy says X and a developer preference says Y, X applies.

The developer preferences file is **per-user**, keyed on your GitHub login. `setup.sh` creates one from `knowledge/guidance/preferences-template.md` the first time you run it (or `lib.sh` creates one lazily on your first `prj` write op if `setup.sh` ran without gh authenticated). To keep multiple profiles, save backups alongside (`<login>.md_work`, `<login>.md_oss`) and rotate by `mv`. The framework loads only the file at `<login>.md`.

### Compliance levels

Every rule in the policy is tagged with a level:

- **C01 — Non-Negotiable**: Hard stop. Scripts refuse to proceed. Exceptions require Policy Owner approval via PR.
- **C02 — Always Apply**: Block work pending an approved exception PR (in `knowledge/policies/exceptions/`).
- **C03 — Apply Intelligently**: Proceed if you have good reason; document the deviation in the project's `compliance.md`.

The validators (`scripts/validate/run.py`) enforce structural invariants. The compliance levels apply to *interpretation* of policy by humans and agents.

---

## Roles

Two role types: **Owners** (accountable, approve PRs) and **Managers** (delegated PR authors).

| Role | Approves what |
|---|---|
| Policy Owner | Any change to `knowledge/policies/`, registry, agent.md |
| Legal Owner | `knowledge/legal/` |
| Infrastructure Owner | `knowledge/infrastructure/`, CI/CD |
| System Architecture Owner | `knowledge/architecture/system/` |
| Data Architecture Owner | `knowledge/architecture/data/` |

CODEOWNERS in this repo enforces the routing automatically — domain owners are auto-assigned as PR reviewers based on which folders the PR touches.

Current role holders are listed in `knowledge/policies/roles.md`. By default at adoption, the Policy Owner holds all roles until they're delegated.

---

## The `prj` CLI

`./prj` is the entry point for most operations. Run it without arguments for an interactive menu, or with a subcommand:

```bash
./prj              # interactive menu
./prj list         # list all projects
./prj status {{ORG_SLUG}}-007-invoice-api
./prj init         # seed a new project (prompts for GitHub Project, assignee)
./prj task         # create a sub-branch task on an active project
./prj merge        # merge a completed task back to the project branch
./prj pause / resume / sync / cancel / close
./prj knowledge    # propose org knowledge changes
./prj onboard      # onboard a new code repo into the framework
./prj manage       # pre-assign / reassign projects (any repo collaborator)
./prj deps         # check or install dependencies
```

Each subcommand wraps a script in `scripts/`. You can also call the scripts directly — `./prj` is just an interactive shell over them.

---

## Lifecycle walkthrough

### Seeding a project

```bash
./prj init
```

Prompts:
1. Which GitHub org to look in for Projects (defaults to your org)
2. Which GitHub Project to seed from
3. Who to assign the project to (defaults to current user)
4. For each repo the GitHub Project's issues touch: confirm and pick a base branch (defaults to `dev`)

What it does:
1. Validates the GitHub Project exists, has issues, has a name
2. Reads `registry.yaml`, computes the next NNN, composes `<ORG_SLUG>-NNN-slug`
3. Creates `projects/<id>/` with subfolders (`requirements/`, `environment/`, `knowledge/`)
4. Writes `project.yaml` from the template, populated with everything known
5. Creates branch `<org_slug>-NNN-slug` in this repo and in each code repo
6. Updates `registry.yaml` with the new project entry
7. Sets status to `active` and pushes everything

After seeding, your project workspace is ready. Read `agent.md` in the project folder for the priority-ordered list of context to load.

### Creating a task (sub-branch)

For multi-agent or parallel work within a project, create sub-branches per task:

```bash
./prj task
```

Each task corresponds to one GitHub Issue inside the project. The task gets its own sub-branch (`<org_slug>-NNN-slug/<task-slug>`) in every repo, with a single assignee. Multiple tasks can run in parallel.

When done, merge back:

```bash
./prj merge
```

This merges the sub-branch into the project branch (NOT into the code repo's base branch — that happens at project close), archives the sub-branch, and closes the GitHub issue.

### Pausing / resuming

```bash
./prj pause {{ORG_SLUG}}-007-invoice-api      # → status: paused
./prj resume {{ORG_SLUG}}-007-invoice-api     # → status: active, pulls latest from default and base branches
```

Resume includes a mandatory sync of the workspace default branch and each code repo's base branch into the project branch. This pulls in any policy or knowledge updates that landed while the project was paused.

### Sync (without pausing)

```bash
./prj sync {{ORG_SLUG}}-007-invoice-api
```

Same merge-in-from-default behavior as resume, but without changing status. Use mid-project to pick up a freshly-merged policy update.

### Closing

```bash
./prj close {{ORG_SLUG}}-007-invoice-api
```

Pre-close gate (C01, hard fail if not met):
- `projects/<id>/knowledge/` contains at least one file
- `projects/<id>/knowledge/compliance.md` exists
- `project.yaml` mandatory fields are populated

Then:
1. Project branch is merged into each code repo's `base_branch`
2. Project state (status, completed_at, registry entry) is updated on the project branch and pushed
3. The **test-merge gate** runs locally: validators check the proposed post-merge state of the workspace default branch
4. If validators pass, the project branch is fast-forwarded into the local default and pushed
5. Project branches are archived (tag) and deleted in all repos
6. `close-knowledge.sh` runs automatically — see below

If the test-merge gate fails, your local default branch is unchanged and you get specific error messages. Fix the cause, re-run `close`.

### Knowledge close

After `close`, the framework offers to synthesize project knowledge into proposals for the org-wide knowledge base:

1. A new branch is created: `<org_slug>-NNN-slug-knowledge`
2. (LLM/agent step — currently manual) Project knowledge is reviewed and proposed updates to `knowledge/` are committed to that branch
3. A PR is opened against the default branch
4. CODEOWNERS auto-assigns reviewers
5. `project.yaml`'s `knowledge_status` is set to `pending_review`

Knowledge close PRs are reviewed normally. Outcome (merged / rejected / abandoned / under_revision) is reflected in `knowledge_status` later.

### Cancelling

```bash
./prj cancel {{ORG_SLUG}}-007-invoice-api "reason text"
```

Branches are tagged-then-deleted. **No merge to base branches**. No knowledge close. `cancellation_reason` is required (C01).

Code changes are preserved in archive tags (`archive/<branch>`) — recoverable but not merged.

---

## Knowledge proposals (outside any project)

For policy updates, ad-hoc learnings, or initial bootstrap knowledge — anything that isn't tied to a specific project:

```bash
./prj knowledge
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
./prj onboard
```

This scaffolds the `knowledge/` structure and raises a PR in that repo. Repo owners populate the placeholder files post-merge.

---

## Common pitfalls

**Validators failing on local close-project.** Usually means a project field isn't populated, the registry has drifted, or there's a leftover placeholder somewhere. Read the specific error — the validators name files and lines.

**"Branch already exists" errors during seed.** Someone may have manually created a branch matching the pattern. Resolve manually and re-run.

**Test-merge gate fails after a sync.** Pull happens correctly but a downstream check sees something it doesn't like. Check the validator output: it tells you which check (schema/registry/lifecycle/cross-refs) and which file/line. The fix is in your branch; re-run after fixing.

**Knowledge close PR has nothing to review.** That happens if no LLM/agent synthesis ran and there were no manual edits. The branch still gets created so the project state can transition; the PR may be closed without merge if nothing's worth proposing.

**Lost track of which branch you're on.** `./prj status <id>` shows the project state and branch. `./prj list` shows all projects.

**Want to undo a close.** Don't. Undoing a close requires reverting merges in multiple repos and re-creating archived branches. Better to seed a follow-up project.

---

## Where to dig deeper

- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) — step-by-step day-in-the-life of working on a project, including how to prompt the agent
- `knowledge/policies/agentic-development-policy.md` — the full policy text with all clause IDs
- `knowledge/policies/roles.md` — current role holders
- `knowledge/guidance/scripts/*-spec.md` — formal specifications for each script
- `scripts/validate/run.py` — exactly which invariants are checked
- `scripts/test-merge.sh` — the local pre-merge gate orchestrator
- `scripts/sync-from-publish.sh` — pulling upstream framework updates

The framework is intentionally small — every script under 300 lines, the policy under 1000 lines, the validators under 400 lines. Read the source when in doubt.
