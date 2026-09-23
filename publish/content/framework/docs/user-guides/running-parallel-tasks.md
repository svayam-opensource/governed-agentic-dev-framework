---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Running parallel tasks

When one project needs more than one stream of work, and what a task sub-branch costs you.
The decision comes first; the commands follow.

## 4. Parallel work — when to use tasks

If you (or another developer) want to work on something independently while the
main project work continues, start a task with `gov task`:

```bash
gov task <linked-issue-url>
```

This creates a sub-branch `brnch-001-feature-x/<issue-slug>` in the workspace and in every linked code repo, and assigns the GitHub Issue. The sub-branch is where you do the work; when done, submit it with `gov merge`:

```bash
gov merge
```

Merges the sub-branch back into `brnch-001-feature-x` and archives it.

**Use a task when**: the work is a discrete unit on the Project board, multiple people might work in parallel, or you want a clean PR trail.
**Skip it when**: you're making a small ad-hoc change that's part of the main work stream — just commit directly on the project branch.

---

### Creating a task (sub-branch)

For multi-agent or parallel work within a project, create sub-branches per task with `gov task`:

```bash
gov task
```

Each task corresponds to one GitHub Issue inside the project. The task gets its own sub-branch (`BRNCH-<board#>-<slug>.ISSUE-<n>`) in every repo, with a single assignee. Multiple tasks can run in parallel.

When done, submit it with `gov merge`:

```bash
gov merge
```

This merges the sub-branch into the project branch (NOT into the code repo's base branch — that happens at project close), archives the sub-branch, and closes the GitHub issue.
