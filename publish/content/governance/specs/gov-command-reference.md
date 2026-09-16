---
domain: governance
layer: spec
owner: policy-owner
compliance: C02
status: current
---
# gov command reference

Every verb, what it does, and who normally runs it. A reference — consulted, not read
through.

## The `gov-work` CLI

`gov-work` is the entry point for most operations. Run it without arguments for an interactive menu, or with a subcommand.

**The everyday flow.** A developer's normal path runs through these verbs:

```bash
gov seed           # seed a new project (prompts for GitHub Project)
gov join           # join an existing project
gov task           # start a sub-branch task on an active project
gov sync           # sync with latest base and continue (the "get current" verb)
gov merge          # submit a completed task back to the project branch
gov close          # close the project (runs the governance gate)
```

**The rest of the lifecycle and admin verbs:**

```bash
gov                # interactive menu
gov list           # list all projects
gov status PRJ-26-invoice-api
gov pause / resume / cancel
gov add-repo       # add another code repo to an active project
gov knowledge      # propose org knowledge changes
gov onboard        # onboard a new code repo into the framework
gov anchor         # manage a project's anchor issue
gov manage         # grant / change GitHub Project access (subcommands: list, assign, reassign, unassign)
gov org            # org-level configuration
gov validate       # run the structural validators
gov setup          # bootstrap the workspace (first-time or re-run)
gov doctor         # check the environment and dependencies
gov upgrade        # pull a framework upgrade
```

The full subcommand set is: `seed`, `join`, `task`, `merge`, `sync`, `add-repo`, `close`, `pause`, `resume`, `cancel`, `manage`, `anchor`, `knowledge`, `onboard`, `validate`, `list`, `status`, `org`, `setup`, `doctor`, `upgrade`.

---

### Seeding a project

Seed a new project with `gov seed`:

```bash
gov seed
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

After seeding, the command prints a `cd` line and a ready-to-paste first-session prompt. Day-to-day project work happens entirely inside the per-project workspace; the HOME repo is only for `gov manage` operations.

### Pausing / resuming

```bash
gov pause PRJ-26-invoice-api      # → status: paused
gov resume PRJ-26-invoice-api     # → status: active, pulls latest from default and base branches
```

Resume includes a mandatory sync of the workspace default branch and each code repo's base branch into the project branch. This pulls in any policy or knowledge updates that landed while the project was paused.

### Sync (without pausing)

```bash
gov sync PRJ-26-invoice-api
```

Same merge-in-from-default behavior as resume, but without changing status. Use mid-project to pick up a freshly-merged policy update. This is the "get current and continue" verb you run day-to-day.

## Common pitfalls

**Validators failing on local `gov close`.** Usually means required project knowledge is missing, the anchor issue is misconfigured, or there's a leftover placeholder somewhere. Read the specific error — the validators name files and lines.

**"Branch already exists" errors during seed.** Someone may have manually created a branch matching the pattern. Resolve manually and re-run.

**Test-merge gate fails after a sync.** Pull happens correctly but a downstream check sees something it doesn't like. Check the validator output: it tells you which check (schema/lifecycle/cross-refs) and which file/line. The fix is in your branch; re-run after fixing.

**Knowledge close PR has nothing to review.** That happens if no LLM/agent synthesis ran and there were no manual edits. The branch still gets created so the project state can transition; the PR may be closed without merge if nothing's worth proposing.

**Lost track of which branch you're on.** `gov status <id>` shows the project state and branch. `gov list` shows all projects.

**Want to undo a close.** Don't. Undoing a close requires reverting merges in multiple repos and re-creating archived branches. Better to seed a follow-up project.

---
