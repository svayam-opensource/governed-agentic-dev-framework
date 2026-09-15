---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Working on a project

The session loop: start a project, run the session-start protocol, do the work, end the
session. This is the one you will reread — the rest are read once.

## The path at a glance

As a developer, your normal path runs through a handful of `gov-work` verbs:

```
[ COPY TEMPLATE ]                        ← one-time per org (gh repo create --template)
       ↓
[ npm i -g @svayam-opensource/gov  →  gov setup ]
       ↓
[ owner: gov manage assign ]             ← grants you write access to the GitHub Project
       ↓
[ gov seed / gov join ]                  ← start a new project / join an existing one
       ↓ creates a per-project workspace under $AGENT_WORK_ROOT/<PRJ-<board#>-slug>/
       ↓   ├── <workspace_repo>/   ← git worktree on the project branch
       ↓   └── <each-code-repo>/   ← git worktree on the project branch
       ↓
[ cd $AGENT_WORK_ROOT/<PRJ-<board#>-slug>/<workspace_repo> ]
       ↓
[ gov sync ]     ← sync with latest base and continue; repeat each session
       ↓
[ gov merge / gov close ] ← submit a task (merge) or close the project (governance gate)
```

`gov seed`/`gov join`, `gov task`, `gov sync`, `gov merge`, and `gov close` are
the developer surface; the sections below describe each in detail.

**Key invariant (Direction A):** the HOME workspace stays on the default branch
the entire project lifetime. All project-branch work — code, scaffolding,
knowledge — happens inside the per-project workspace under `$AGENT_WORK_ROOT`.
Each per-project workspace is a set of **git worktrees** of one shared base
clone per repo (under `$AGENT_WORK_ROOT/.bases/`), not a full clone per project.
N parallel projects ⇒ N per-project worktrees, but only one home checkout that
never switches branches.

---

## 2. Start the project

To start a **new** project, run `gov seed`. To join an **existing** one, run
`gov join`. This section walks through the `gov seed` flow.

Run from the **HOME workspace** repo root, **on the default branch**:

```bash
git checkout main         # must be on default branch
gov seed                  # (or gov join for an existing project)
```

Walk through the prompts:

1. **GitHub org / user owning the Project** — accept the default if it's right.
2. **Pick the GitHub Project from the list** — only projects you have write access to appear.
3. **Assignee email** — defaults to your `git config user.email`.
4. **Confirm initialize** — `y` to proceed.

What happens:

- A project ID is allocated, e.g. `PRJ-001-feature-x`, with a project branch `brnch-001-feature-x`.
- **In the HOME workspace, on the default branch**: a `projects/PRJ-001-feature-x/.gitkeep` stub is written, committed, and pushed. Project state lives in GitHub (the board and its anchor issue), not in any per-project state file. The home checkout stays on the default branch.
- **A per-project workspace is created** at `$AGENT_WORK_ROOT/PRJ-001-feature-x/`. Inside:
  - The workspace repo is checked out as a **git worktree** (`<workspace_repo>/`) on `brnch-001-feature-x` from the shared base clone under `$AGENT_WORK_ROOT/.bases/`. The full `projects/PRJ-001-feature-x/` scaffolding (agent.md, knowledge/, etc.) lives here, on the project branch.
  - Each impacted code repo gets a **git worktree** at `$AGENT_WORK_ROOT/PRJ-001-feature-x/<repo>/`, on the project branch, from that repo's shared base clone.

At the end you'll see a **"Next steps"** block printing the exact `cd` target plus a ready-to-paste first-session prompt with the project name baked in. **Read it.** That output is the canonical "what to do next" guide for the project you just created.

**Important:** project-branch work (code, knowledge) all happens inside the per-project workspace. The HOME repo's `projects/PRJ-<board#>-slug/` is just a stub on the default branch until `gov close` merges the project branch back.

---

## 3. Each working session

### Session-start protocol (C01 — non-negotiable)

Sessions happen **inside the per-project workspace**, not in the HOME repo:

```bash
cd $AGENT_WORK_ROOT/PRJ-001-feature-x/<workspace_repo>
```

`gov sync` is the "sync with latest and continue" verb — it syncs the project
branch with the latest base and drops you into the worktree, so you can run it
instead of the manual pull steps below. The full protocol the agent (or you, if
working alone) must satisfy before any code change is:

0. **Read `org-config.yaml` first** — every framework file references its values (`<ORG_NAME>`, `<DEFAULT_BRANCH>`, owners, etc.).
1. **Confirm the project branch is current**:
   ```bash
   git status                   # should already be on brnch-001-feature-x
   git pull origin brnch-001-feature-x
   ```
2. **Verify the project's GitHub board is open (active)** — your authorization comes from write access to the linked GitHub Project, and status is derived from whether the board is open.
3. **Read all four knowledge layers, fresh** — never use cached context across sessions:
   - `knowledge/` (org-wide policy)
   - `projects/PRJ-001-feature-x/knowledge/` (project knowledge accumulated so far)
   - `<repo>/knowledge/` for each code repo (repo conventions)
   - `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` (your own developer preferences)
4. **Read `projects/PRJ-001-feature-x/knowledge/todo.md`** — surface its `## Open` items before planning new work.
5. **Pull latest on the project branch in each code repo**:
   ```bash
   cd $AGENT_WORK_ROOT/PRJ-001-feature-x/<repo>
   git pull origin brnch-001-feature-x
   ```

### Prompting the agent (Pattern 1 — agent speaks first)

**Pattern 1 is active** in `agent/session-protocol.md` §0. The agent should run the C01 checklist and post a **context manifest** as its **first reply** — you do not need to paste the long kickoff template every session.

**How to try it (Cursor or Claude):**

1. Open this repo (or `projects/<PID>/`) on the project branch; pull latest.
2. **Cursor:** open a **new** Agent or Chat tab. **Claude:** run `claude` in the folder (new session).
3. Send a minimal opener — e.g. `start` or `go` — or jump straight to a task; the agent should still lead with the manifest.
4. Confirm the first reply includes `## Context manifest` with project, branch, todos, and layers loaded.
5. **Cursor:** Settings → Rules → `agent.mdc` = **Always**. **Claude:** `/memory` should list `@agent/session-protocol.md`.

If the agent skips the manifest, say: *"Follow session-protocol §0 — context manifest first."*

**Optional human kickoff** (when you want to be explicit):

```
Starting session on PRJ-001-feature-x. Post context manifest per session-protocol §0, then wait.
```

The agent should respond with a short status summary, not a plan. You direct what comes next.

### Session start by tool — Claude vs Cursor vs Gemini

**Same policy (POL-113–118) for everyone.** Tools differ only in *how protocol text gets into the model* before the first read of `knowledge/`.

Open the workspace at **`projects/<PID>/`** (recommended) or gov repo root on the project branch.

| Phase | What happens | Claude Code | Cursor | Gemini Code Assist |
|---|---|---|---|---|
| **You** | Open workspace + pull branches | `cd projects/<PID>/` | Open folder in Cursor | Open folder in VS Code / IntelliJ |
| **You** | Start the AI | Run `claude` | Open Agent or Chat | Open Gemini chat panel |
| **Tool** | Load protocol automatically | `@import` expands `CLAUDE.md` → protocol + `agent.md` | Injects `.cursor/rules/agent.mdc` every turn | Loads `.gemini/styleguide.md` |
| **You** | Send kickoff prompt | Minimal `start` / `go` (Pattern 1) or a specific task | Same | Same |
| **Agent** | First reply (Pattern 1) | **Context manifest** per session-protocol §0, then wait | Same | Same |
| **Agent** | Read knowledge layers (required) | Read tool → `knowledge/`, project, repos, prefs | Same | Same |
| **You** | Verify | `/memory` lists imports | Settings → Rules → `agent.mdc` = **Always** | Ask agent to summarize write restrictions |

**Not automatic for any tool:** full `governance/policies/`, `projects/<PID>/knowledge/*`, code repo `knowledge/`, or preferences — the agent must read these each session.

Detailed step tables and timeline: [`docs/design/agent-context-assembly-spec.md`](design/agent-context-assembly-spec.md) Appendix D.

Harness registry (all tools): [`agent/harness-manifest.yaml`](../agent/harness-manifest.yaml).

### Doing the actual work

- **Code changes** go in the code-repo worktrees under `$AGENT_WORK_ROOT/PRJ-001-feature-x/<repo>/`, on the project branch.
- **Project knowledge** goes in `projects/PRJ-001-feature-x/knowledge/` in the workspace repo:
  - `compliance.md` — required at close; records C01 violations, C02 exceptions, C03 deviations.
  - `notes.md` — decisions, design rationale, anything future-you would need.
  - any other domain-specific files as needed (`security.md`, `migrations.md`, etc.).
- **Intermediate to-dos** go in `projects/PRJ-001-feature-x/knowledge/todo.md` under `## Open`. Capture them as they arise, not at session end.
- **NEVER** edit:
  - The workspace repo's `knowledge/` (editable on the project branch, but only as a proposal — POL-086b).
  - Task state by hand — tasks are GitHub Issues on the board (open = active, closed = done); create with `gov task`, land with `gov merge`.
  - GitHub Issues unilaterally — those represent business intent humans add to the board.

### Prompting style during the session

- Drive the work by **direction**, not by **delegation**. The agent shouldn't autonomously decide what to implement.
- When asking the agent to make a change, point at the file path under `$AGENT_WORK_ROOT/projects/...` so it doesn't get confused with the workspace repo's tree.
- For non-obvious decisions, ask the agent to write the rationale into `projects/.../knowledge/notes.md` before the corresponding code change. That keeps the audit trail honest.
- When a policy question comes up mid-session and an exception might be needed: stop, file an exception request in `governance/policies/exceptions/<domain>/`, and `gov pause` until it's approved. Agents must hard-stop on unresolved C01 (POL-117).

### Session-end protocol

Before you walk away (you're still inside the per-project workspace):

1. **Commit** any pending changes in the workspace-repo worktree (`projects/PRJ-001-feature-x/` content). All commits go on `brnch-001-feature-x`.
2. **Move resolved items** in `todo.md` from `## Open` to `## Done` with a short note.
3. **Push** everything:
   ```bash
   # In the workspace-repo worktree:
   cd $AGENT_WORK_ROOT/PRJ-001-feature-x/<workspace_repo>
   git push origin brnch-001-feature-x
   # And in each code repo:
   cd $AGENT_WORK_ROOT/PRJ-001-feature-x/<repo>
   git push origin brnch-001-feature-x
   ```
4. Optionally: write a one-line session summary to `notes.md` so the next session knows where you stopped.

The HOME repo stays on the default branch throughout — there's no `git push` needed there during the project.

---

## 5. Pausing, resuming, syncing

- **`gov pause`** — for "I need to stop and come back later, possibly weeks." Marks the project paused. Must be cleanly committed first.
- **`gov resume`** — re-runs session-start protocol effectively; pulls latest, merges base into project branch, surfaces conflicts.
- **`gov sync`** — for "I want to pull upstream changes mid-project without pausing." Same merge mechanics as resume, but keeps the project active and drops you back into the worktree to continue.

After any of these, **re-load all four knowledge layers** before doing anything else.

---

## 6. Switching between projects in a single session

Sessions are agent-lifecycle (one continuous conversation). Projects are git-branch-scoped. You can switch — but it's not free.

When you `git checkout xyz-002-other` to a different project's branch:

1. Re-run the **full** session-start protocol for the new project.
2. Read the new project's `todo.md`. Do not carry over `## Open` items from the previous project — those stay on their own branch.
3. The agent must drop in-memory state derived from the previous project's knowledge layers.

This is POL-171 in the policy ledger.

---

## 8. Common situations

**"The agent suggested doing X — should I let it?"** — Compare against the four knowledge layers in priority order. If org policy says no, the agent is wrong regardless of what it claims. If repo conventions say no, same. Developer preferences cannot override either.

**"I forgot to check `todo.md` last time and now there are stale open items."** — That's the system working. Surface them, resolve or de-scope them, move what's resolved to `## Done`, leave the rest.

**"My agent doesn't have `gh` access."** — Most operations don't need it, but seeding a new project and closing one do (`gov seed`/`gov join` and `gov close` — Project queries, authorization check, PR creation). Give the agent a PAT scoped to `repo` + `project` for the run, or hand off those specific commands to a human-driven shell.

**"I'm not sure if a change is C01, C02, or C03."** — Default to surfacing it as C02 (write to `compliance.md` and file an exception if needed). Only C01 hard-stops require pausing.

**"I want to know what's left."** — `gov list` shows projects + statuses. For an individual project, `gov status <PROJECT_ID>`. For carry-forward work, `projects/<PID>/knowledge/todo.md`.

---
