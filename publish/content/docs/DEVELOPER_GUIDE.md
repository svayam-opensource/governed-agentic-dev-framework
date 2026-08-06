# Developer Guide — Working on a Project

This document is for the **developer or agent** doing actual work on an active project. It assumes:

- The org has already adopted the framework (`gov-work setup` ran successfully).
- A GitHub Project has been created and at least one Issue is linked to it from a repo you can push to.
- You have `gh auth status` showing a usable identity.

For the framework's concepts, roles, and CLI reference, see [USER_GUIDE.md](USER_GUIDE.md). For the policy ledger that governs every step below, see [`knowledge/policies/agentic-development-policy.md`](../knowledge/policies/agentic-development-policy.md).

> **Current model at a glance (ADR-0001).** The framework is converging on a small surface:
> - **Developer verbs:** `gov-work seed` · `gov-work join` · `gov-work task` · `gov-work sync` · `gov-work merge` ·
>   `gov-work close`. These are the lifecycle surface you work with directly.
> - **Authorization = GitHub Project access.** You may seed/join/work on a project if you
>   have **write access to its linked GitHub Project** (`projectV2.viewerCanUpdate`); an
>   owner grants it with `gov-work manage assign`. There is no per-project state file — GitHub
>   Project write access is the sole gate.
> - **Per-project workspaces are git worktrees** of one shared base clone per repo (under
>   `$AGENT_WORK_ROOT/.bases/`), not full per-project clones.
> - **The gov-work CLI is installed from npm** — `npm i -g @svayam-opensource/gov-work` (requires
>   Node 24) — so repos carry only data, never a vendored copy of the framework. See
>   [ADR-0001](../../docs/adr/ADR-0001-simplify-developer-experience.md).

---

## The path at a glance

As a developer, your normal path runs through a handful of `gov-work` verbs:

```
[ COPY TEMPLATE ]                        ← one-time per org (gh repo create --template)
       ↓
[ npm i -g @svayam-opensource/gov-work  →  gov-work setup ]
       ↓
[ owner: gov-work manage assign ]             ← grants you write access to the GitHub Project
       ↓
[ gov-work seed / gov-work join ]                  ← start a new project / join an existing one
       ↓ creates a per-project workspace under $AGENT_WORK_ROOT/<PRJ-<board#>-slug>/
       ↓   ├── <workspace_repo>/   ← git worktree on the project branch
       ↓   └── <each-code-repo>/   ← git worktree on the project branch
       ↓
[ cd $AGENT_WORK_ROOT/<PRJ-<board#>-slug>/<workspace_repo> ]
       ↓
[ gov-work sync ]     ← sync with latest base and continue; repeat each session
       ↓
[ gov-work merge / gov-work close ] ← submit a task (merge) or close the project (governance gate)
```

`gov-work seed`/`gov-work join`, `gov-work task`, `gov-work sync`, `gov-work merge`, and `gov-work close` are
the developer surface; the sections below describe each in detail.

**Key invariant (Direction A):** the HOME workspace stays on the default branch
the entire project lifetime. All project-branch work — code, scaffolding,
knowledge — happens inside the per-project workspace under `$AGENT_WORK_ROOT`.
Each per-project workspace is a set of **git worktrees** of one shared base
clone per repo (under `$AGENT_WORK_ROOT/.bases/`), not a full clone per project.
N parallel projects ⇒ N per-project worktrees, but only one home checkout that
never switches branches.

---

## 1. Before the first session

### Verify your env

```bash
git config --global user.name    # must be set
git config --global user.email   # must be set
gh api user --jq .login          # should print your GitHub handle
```

The framework reads `agent_work_root` from `org-config.yaml` (set when the
Policy Owner ran `gov-work setup`). The default is `~/.<org_slug_lower>/projects`
(e.g. `~/.acme/projects/`). To inspect:

```bash
yq '.agent_work_root' org-config.yaml
```

To override for a single command (e.g. in a CI sandbox), export `AGENT_WORK_ROOT`
in the shell — env wins over the org-config value.

### Confirm you have access to the GitHub Project

Authorization is **write access to the project's linked GitHub Project**
(`projectV2.viewerCanUpdate`). The Policy Owner (or any repo collaborator with
manage rights) creates the GitHub Project and grants you that access via
`gov-work manage assign`; org owners/admins already have access to everything.
If you lack write access, `gov-work seed`/`gov-work join` won't let you seed or join the
project — ask an owner to run `gov-work manage assign`. There is no per-project state
file; GitHub Project write access is the sole gate.

---

## 2. Start the project

To start a **new** project, run `gov-work seed`. To join an **existing** one, run
`gov-work join`. This section walks through the `gov-work seed` flow.

Run from the **HOME workspace** repo root, **on the default branch**:

```bash
git checkout main         # must be on default branch
gov-work seed                  # (or gov-work join for an existing project)
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

**Important:** project-branch work (code, knowledge) all happens inside the per-project workspace. The HOME repo's `projects/PRJ-<board#>-slug/` is just a stub on the default branch until `gov-work close` merges the project branch back.

---

## 3. Each working session

### Session-start protocol (C01 — non-negotiable)

Sessions happen **inside the per-project workspace**, not in the HOME repo:

```bash
cd $AGENT_WORK_ROOT/PRJ-001-feature-x/<workspace_repo>
```

`gov-work sync` is the "sync with latest and continue" verb — it syncs the project
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

**Not automatic for any tool:** full `knowledge/policies/`, `projects/<PID>/knowledge/*`, code repo `knowledge/`, or preferences — the agent must read these each session.

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
  - The workspace repo's `knowledge/` (read-only during the project).
  - Task state by hand — tasks are GitHub Issues on the board (open = active, closed = done); create with `gov-work task`, land with `gov-work merge`.
  - GitHub Issues unilaterally — those represent business intent humans add to the board.

### Prompting style during the session

- Drive the work by **direction**, not by **delegation**. The agent shouldn't autonomously decide what to implement.
- When asking the agent to make a change, point at the file path under `$AGENT_WORK_ROOT/projects/...` so it doesn't get confused with the workspace repo's tree.
- For non-obvious decisions, ask the agent to write the rationale into `projects/.../knowledge/notes.md` before the corresponding code change. That keeps the audit trail honest.
- When a policy question comes up mid-session and an exception might be needed: stop, file an exception request in `knowledge/policies/exceptions/<domain>/`, and `gov-work pause` until it's approved. Agents must hard-stop on unresolved C01 (POL-117).

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

## 4. Parallel work — when to use tasks

If you (or another developer) want to work on something independently while the
main project work continues, start a task with `gov-work task`:

```bash
gov-work task <linked-issue-url>
```

This creates a sub-branch `brnch-001-feature-x/<issue-slug>` in the workspace and in every linked code repo, and assigns the GitHub Issue. The sub-branch is where you do the work; when done, submit it with `gov-work merge`:

```bash
gov-work merge
```

Merges the sub-branch back into `brnch-001-feature-x` and archives it.

**Use a task when**: the work is a discrete unit on the Project board, multiple people might work in parallel, or you want a clean PR trail.
**Skip it when**: you're making a small ad-hoc change that's part of the main work stream — just commit directly on the project branch.

---

## 5. Pausing, resuming, syncing

- **`gov-work pause`** — for "I need to stop and come back later, possibly weeks." Marks the project paused. Must be cleanly committed first.
- **`gov-work resume`** — re-runs session-start protocol effectively; pulls latest, merges base into project branch, surfaces conflicts.
- **`gov-work sync`** — for "I want to pull upstream changes mid-project without pausing." Same merge mechanics as resume, but keeps the project active and drops you back into the worktree to continue.

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

## 7. Closing the project

When all goal-level work is done and project knowledge is curated, run `gov-work close`
from the **per-project workspace** (not the HOME repo):

```bash
cd $AGENT_WORK_ROOT/PRJ-001-feature-x/<workspace_repo>
gov-work close
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
- `compliance.md` should exist (`gov-work close` will tell you if it doesn't).

What this does:

- Merges the project branch into the default code branch in each code repo.
- Merges the project branch into the workspace's default branch.
- Creates archive tags `archive/brnch-001-feature-x` everywhere and deletes the project branch.
- Runs the knowledge-close step of `gov-work close`, which:
  - Creates `brnch-001-feature-x-knowledge` branch.
  - Synthesizes a knowledge-close proposal (or pauses for you/an agent to do so).
  - Opens a PR for domain owners (CODEOWNERS auto-assigns reviewers).

The project's GitHub board is closed (done). The knowledge PR is reviewed and merged separately — that lands new project-derived learnings into org-wide knowledge.

---

## 8. Common situations

**"The agent suggested doing X — should I let it?"** — Compare against the four knowledge layers in priority order. If org policy says no, the agent is wrong regardless of what it claims. If repo conventions say no, same. Developer preferences cannot override either.

**"I forgot to check `todo.md` last time and now there are stale open items."** — That's the system working. Surface them, resolve or de-scope them, move what's resolved to `## Done`, leave the rest.

**"My agent doesn't have `gh` access."** — Most operations don't need it, but seeding a new project and closing one do (`gov-work seed`/`gov-work join` and `gov-work close` — Project queries, authorization check, PR creation). Give the agent a PAT scoped to `repo` + `project` for the run, or hand off those specific commands to a human-driven shell.

**"I'm not sure if a change is C01, C02, or C03."** — Default to surfacing it as C02 (write to `compliance.md` and file an exception if needed). Only C01 hard-stops require pausing.

**"I want to know what's left."** — `gov-work list` shows projects + statuses. For an individual project, `gov-work status <PROJECT_ID>`. For carry-forward work, `projects/<PID>/knowledge/todo.md`.

---

## 9. Tool-specific notes

The session-start protocol is **one canonical source**, delivered through each tool's conventional install path. Full design: [`docs/design/agent-context-assembly-spec.md`](design/agent-context-assembly-spec.md) §3.3–§3.4.

### Canonical source (edit these)

| File | Purpose |
|---|---|
| `agent/session-protocol.md` | C01 session protocol — layer load order, gates, write rules, capture (POL-113–117) |
| `agent.md` | Org workspace entrypoint — policy pointers, repo identity |

**Do not** hand-edit generated harness install paths (see below). Run `node agent/render-harness.mjs` after changing the canonical source.

### How each tool gets protocol into system context

Full matrix and Claude/Cursor/Gemini step-by-step: [`docs/design/agent-context-assembly-spec.md`](design/agent-context-assembly-spec.md) Appendix D. Registry: [`agent/harness-manifest.yaml`](../agent/harness-manifest.yaml).

| Tool | Install path | Tier | Auto? | Verify |
|---|---|---|---|---|
| **Claude Code** | `CLAUDE.md` | import (`@`) | Yes | `/memory` |
| **Cursor** | `.cursor/rules/agent.mdc` | generate_auto | Yes | Settings → Rules → Always |
| **OpenAI Codex** | `AGENTS.md` | generate_auto | Yes | First-message summary |
| **Gemini Code Assist** | `.gemini/styleguide.md` | generate_auto | Yes | Ask re write restrictions |
| **GitHub Copilot** | `.github/copilot-instructions.md` | generate_auto | On assist | Weaker session gate |
| **Windsurf** | `.windsurf/rules/agent.md` | generate_auto | Yes | First message |
| **Cline / Roo Code** | `.clinerules/agent.md` | generate_auto | Yes | Startup / first message |
| **Continue.dev** | `.continue/rules.md` | generate_auto | Yes | First message |
| **Aider** | `CONVENTIONS.md` | generate_manual | **`--read` only** | Confirm in context |

Per-project copies under `projects/<PID>/` are composed at seed time (protocol + `projects/<PID>/agent.md`) so opening the project folder as workspace still works.

### What harness does *not* load

Harness delivery covers **protocol only**. The agent must read these each session:

- Full `knowledge/policies/` text
- `projects/<PID>/knowledge/*`
- Code repo `knowledge/`
- `$AGENT_WORK_ROOT/preferences/<gh-login>.md`

Reads persist in **chat transcript** for the rest of the session; they are not re-injected each turn like rules.

### General foot-guns regardless of tool

- **Text pointers are not file loads.** *"See `agent.md`"* in a rule instructs the model; it does not embed the file. Use Claude `@import` or Cursor generation.
- **Verify loading.** First prompt: ask for a context manifest (project, branch, open todos). Claude: `/memory`. Cursor: confirm Always rules in Settings → Rules.
- **Adopter C03 extensions** go below the `ADOPTER_C03_EXTENSIONS` marker in `agent/session-protocol.local.md` or the generated harness footer — never contradict layer priority or C01/C02 rules.
- **Migration note:** Until `agent/session-protocol.md` and `agent/render-harness.mjs` land, harness files still inline duplicate protocol — update them in lockstep if you edit protocol text.

---

## 10. Framework upgrades from TEMPLATE

The framework template lives at
[`svayam-opensource/governed-agentic-dev-framework`](https://github.com/svayam-opensource/governed-agentic-dev-framework).
Your org's repo was created from it (`gh repo create --template ...` or "Use
this template" on GitHub). `gov-work setup` configured a `template` remote
pointing at the upstream so you can pull future framework updates without
touching org-specific values.

> **The gov-work CLI is installed from npm** — `npm i -g @svayam-opensource/gov-work`
> (requires Node 24), never vendored into a repo. Repos carry only data
> (`org-config.yaml`, `projects/`, `knowledge/`), and you upgrade the CLI itself
> with `npm i -g @svayam-opensource/gov-work@latest`, independently of any project's
> data. Framework *content* (policies, scaffolded files) upgrades separately via
> `gov-work upgrade`, described below.

### How upgrades work (Direction A)

Framework files (`knowledge/policies/`, `CLAUDE.md`, `AGENTS.md`,
the per-tool rule files, etc.) contain **no org-specific values**. They use
angle-bracketed tokens like `<ORG_NAME>` and `<DEFAULT_BRANCH>` that the agent
resolves at runtime from `org-config.yaml`. After `gov-work setup`, the ONLY file
that diverges from upstream TEMPLATE is `org-config.yaml` (plus `projects/` as
you do project work). That makes upgrades conflict-free.

### Pulling an upgrade (v0.3.0+)

v0.3.0 introduces a framework-as-package upgrade model. Framework files live
in a `framework/` directory inside TEMPLATE; on ORG side that directory is
ephemeral — it gets fetched, applied, and deleted on every upgrade. ORG's
working tree at rest contains only org-owned content + scaffolded canonical
paths populated by the framework.

From your HOME repo on the default branch:

```bash
gov-work upgrade [version]      # e.g. gov-work upgrade v0.3.1
```

That fetches the `template` remote at the requested version (or `template/main`
if no version is given) and applies the framework update:
1. Checks out `framework/` at the requested version.
2. Applies the framework's `MANIFEST.yaml`, which governs how each shipped file
   lands:
   - For `scaffold-auto` files (scripts, CI): overwrites the canonical copy
     without asking.
   - For `scaffold-prompt` files (agent rule files, policy text): 3-way
     merges against the previous framework version. Prompts only when your
     org has customized AND the framework also changed the same file.
   - For `overlay-schema` files (`org-config.yaml`): adds new keys with
     empty values; never modifies existing values.
   - Leaves `projects/` and your custom knowledge files completely untouched.
3. Writes `.framework-version` to record what's now installed.
4. Deletes `framework/` from the working tree.
5. Stages everything for your review.

After upgrading, run `gov-work validate` to confirm everything still validates.

### What the test-merge gate catches

CI runs the same validators against `template/main` merges. A regression on
the upstream side (e.g. a framework file accidentally introducing a
double-curly placeholder token) fails the gate before it lands.

---

## Where to go next

- [USER_GUIDE.md](USER_GUIDE.md) — concepts, roles, full CLI reference
- [`knowledge/policies/agentic-development-policy.md`](../knowledge/policies/agentic-development-policy.md) — the governing policy (POL-001 through POL-171)
- [`knowledge/policies/agentic-development-procedures.md`](../knowledge/policies/agentic-development-procedures.md) — procedural protocols
