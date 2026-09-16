---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Closing a project

Closing is the only step that writes a project's knowledge back to the organization, so it
is the one worth slowing down for. Cancelling is here too — it is a different act, and the
difference matters.

## 7. Closing the project

When all goal-level work is done and project knowledge is curated, run `gov close`
from the **per-project workspace** (not the HOME repo):

```bash
cd $AGENT_WORK_ROOT/PRJ-001-feature-x/<workspace_repo>
gov close
```

The close runs a governance gate: it merges the project branch back into the default branch in
the workspace repo and in every code repo. After it succeeds, you can pull
the merged state into the HOME repo:

```bash
cd <your home checkout>
git pull origin main
```

What this enforces:

- `projects/PRJ-001-feature-x/knowledge/` must be non-empty.
- `compliance.md` should exist (`gov close` will tell you if it doesn't).

What this does:

- Merges the project branch into the default code branch in each code repo.
- Merges the project branch into the workspace's default branch.
- Creates archive tags `archive/brnch-001-feature-x` everywhere and deletes the project branch.
- Runs the knowledge-close step of `gov close`, which:
  - Creates `brnch-001-feature-x-knowledge` branch.
  - Synthesizes a knowledge-close proposal (or pauses for you/an agent to do so).
  - Opens a PR for domain owners (CODEOWNERS auto-assigns reviewers).

The project's GitHub board is closed (done). The knowledge PR is reviewed and merged separately — that lands new project-derived learnings into org-wide knowledge.

---

### Closing

Close the project with `gov close`, which runs the governance gate:

```bash
gov close PRJ-26-invoice-api
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
6. The knowledge-close step of `gov close` runs automatically — see below

If the test-merge gate fails, your local default branch is unchanged and you get specific error messages. Fix the cause, re-run `gov close`.

### Knowledge close

After `gov close`, the framework offers to synthesize project knowledge into proposals for the org-wide knowledge base:

1. A new branch is created: `BRNCH-<board#>-<slug>-knowledge`
2. (LLM/agent step — currently manual) Project knowledge is reviewed and proposed updates to `knowledge/` are committed to that branch
3. A PR is opened against the default branch
4. CODEOWNERS auto-assigns reviewers
5. The knowledge-close status is reflected by the state of that PR (open = pending review)

Knowledge close PRs are reviewed normally. Outcome (merged / rejected / abandoned) is reflected by the PR's state.

### Cancelling

```bash
gov cancel PRJ-26-invoice-api "reason text"
```

Branches are tagged-then-deleted. **No merge to base branches**. No knowledge close. `cancellation_reason` is required (C01).

Code changes are preserved in archive tags (`archive/<branch>`) — recoverable but not merged.

---
