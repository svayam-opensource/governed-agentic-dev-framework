# Developer Guide — Working on a Project

This document is for the **developer or agent** doing actual work on an active project. It assumes:

- The org has already adopted the framework (`setup.sh` ran successfully).
- A GitHub Project has been created and at least one Issue is linked to it from a repo you can push to.
- You have `gh auth status` showing a usable identity.

For the framework's concepts, roles, and CLI reference, see [USER_GUIDE.md](USER_GUIDE.md). For the policy ledger that governs every step below, see [`knowledge/policies/agentic-development-policy.md`](../knowledge/policies/agentic-development-policy.md).

---

## The path at a glance

```
[ Pre-assignment ] → [ ./prj init ] → [ Each session: load + work + capture ]
                                       ↓
                                  [ ./prj task ] for parallel work units
                                       ↓
                                  [ ./prj merge ]
                                       ↓
                                  [ ./prj close ]
```

Roughly: assignment happens out-of-band, init happens once, sessions repeat, tasks slice work, close happens once.

---

## 1. Before the first session

### Verify your env

```bash
git config --global user.name    # must be set
git config --global user.email   # must be set
gh api user --jq .login          # should print your GitHub handle
```

If `PRJ_GOV_LOC` isn't set, the framework uses `~/prj_gov` as the governance root (the legacy `AGENT_WORK_ROOT` is still honored if it's set). Override only if you want the governance root somewhere else:

```bash
export PRJ_GOV_LOC=~/code/prj_gov
```

### Confirm the project is assigned to you

The Policy Owner (or any repo collaborator with manage rights) creates the GitHub Project and pre-assigns it via `./prj manage assign`. Until that happens, `./prj init` will refuse with *"This project is assigned to '\<someone>'."*

---

## 2. Initialize the project

From the workspace repo root:

```bash
./prj
# Choose: 1) init
```

Walk through the prompts:

1. **GitHub org / user owning the Project** — accept the default if it's right.
2. **Pick the GitHub Project from the list** — only projects you're assigned to (or that are unassigned) appear.
3. **Assignee email** — defaults to your `git config user.email`.
4. **Confirm initialize** — `y` to proceed.

What happens:

- A project ID is allocated (e.g. `ABC-001-feature-x`) and a workspace branch (`abc-001-feature-x`) is created and pushed.
- For each repo linked to the Project, the repo is cloned into `$PRJ_GOV_LOC/projects/ABC-001-feature-x/repos/<repo>/` and the project branch is created from its base branch.
- `projects/ABC-001-feature-x/` is scaffolded with: `project.yaml`, `agent.md`, `knowledge/`, `requirements/`, `environment/`, and `knowledge/todo.md` (empty).
- The registry is updated and everything is committed and pushed.

At the end you'll see a **"Next steps"** block telling you exactly where to point your agent. **Read it.** That output is the canonical "what to do next" guide for the project you just created.

---

## 3. Each working session

### Session-start protocol (C01 — non-negotiable)

Before any code change, the agent (or you, if working alone) must:

1. **Verify you're on the project's branch in the workspace repo**:
   ```bash
   git checkout abc-001-feature-x
   git pull origin abc-001-feature-x
   ```
2. **Verify `project.yaml`**: `assigned_to` matches you, `status: active`.
3. **Read all four knowledge layers, fresh** — never use cached context across sessions:
   - `knowledge/` (org-wide policy)
   - `projects/ABC-001-feature-x/knowledge/` (project knowledge accumulated so far)
   - `<repo>/knowledge/` for each code repo (repo conventions)
   - `$PRJ_GOV_LOC/preferences/<your-gh-login>.md` (your own developer preferences)
4. **Read `projects/ABC-001-feature-x/knowledge/todo.md`** — surface its `## Open` items before planning new work.
5. **Pull latest on the project branch in each code repo**:
   ```bash
   cd $PRJ_GOV_LOC/projects/ABC-001-feature-x/repos/<repo>
   git checkout abc-001-feature-x
   git pull origin abc-001-feature-x
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
Starting session on ABC-001-feature-x. Post context manifest per session-protocol §0, then wait.
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

**Not automatic for any tool:** full `knowledge/policies/`, `projects/<PID>/knowledge/*`, code repo `knowledge/`, or preferences — the agent must read these (or you run `./prj context assemble` when available).

Detailed step tables and timeline: [`docs/design/agent-context-assembly-spec.md`](design/agent-context-assembly-spec.md) Appendix D.

Harness registry (all tools): [`agent/harness-manifest.yaml`](../agent/harness-manifest.yaml).

### Doing the actual work

- **Code changes** go in the cloned code repos under `$PRJ_GOV_LOC/projects/ABC-001-feature-x/repos/<repo>/`, on the project branch.
- **Project knowledge** goes in `projects/ABC-001-feature-x/knowledge/` in the workspace repo:
  - `compliance.md` — required at close; records C01 violations, C02 exceptions, C03 deviations.
  - `notes.md` — decisions, design rationale, anything future-you would need.
  - any other domain-specific files as needed (`security.md`, `migrations.md`, etc.).
- **Intermediate to-dos** go in `projects/ABC-001-feature-x/knowledge/todo.md` under `## Open`. Capture them as they arise, not at session end.
- **NEVER** edit:
  - The workspace repo's `knowledge/` (read-only during the project).
  - Task state by hand — tasks are GitHub Issues on the board (open = active, closed = done); create with `./prj task`, land with `./prj merge`.
  - GitHub Issues unilaterally — those represent business intent humans add to the board.

### Prompting style during the session

- Drive the work by **direction**, not by **delegation**. The agent shouldn't autonomously decide what to implement.
- When asking the agent to make a change, point at the file path under `$PRJ_GOV_LOC/projects/...` so it doesn't get confused with the workspace repo's tree.
- For non-obvious decisions, ask the agent to write the rationale into `projects/.../knowledge/notes.md` before the corresponding code change. That keeps the audit trail honest.
- When a policy question comes up mid-session and an exception might be needed: stop, file an exception request in `knowledge/policies/exceptions/<domain>/`, and `./prj pause` until it's approved. Agents must hard-stop on unresolved C01 (POL-117).

### Session-end protocol

Before you walk away:

1. **Commit** any pending changes in the workspace repo (`projects/ABC-001-feature-x/` and `registry.yaml` if changed).
2. **Move resolved items** in `todo.md` from `## Open` to `## Done` with a short note.
3. **Push** everything:
   ```bash
   git push origin abc-001-feature-x
   # And in each code repo:
   cd $PRJ_GOV_LOC/projects/ABC-001-feature-x/repos/<repo>
   git push origin abc-001-feature-x
   ```
4. Optionally: write a one-line session summary to `notes.md` so the next session knows where you stopped.

---

## 4. Parallel work — when to use tasks

If you (or another developer) want to work on something independently while the main project work continues, use `./prj task`:

```bash
./prj task <linked-issue-url>
```

This creates a sub-branch `abc-001-feature-x/<issue-slug>` in the workspace and in every linked code repo, and assigns the GitHub Issue. The sub-branch is where you do the work; when done:

```bash
./prj merge
```

Merges the sub-branch back into `abc-001-feature-x` and archives it.

**Use `./prj task` when**: the work is a discrete unit on the Project board, multiple people might work in parallel, or you want a clean PR trail.
**Skip it when**: you're making a small ad-hoc change that's part of the main work stream — just commit directly on the project branch.

---

## 5. Pausing, resuming, syncing

- **`./prj pause`** — for "I need to stop and come back later, possibly weeks." Marks status `paused`. Must be cleanly committed first.
- **`./prj resume`** — re-runs session-start protocol effectively; pulls latest, merges base into project branch, surfaces conflicts.
- **`./prj sync`** — for "I want to pull upstream changes mid-project without pausing." Same merge mechanics as resume, but stays `active`.

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

When all goal-level work is done and project knowledge is curated:

```bash
./prj close
```

What this enforces:

- `projects/ABC-001-feature-x/knowledge/` must be non-empty.
- `compliance.md` should exist (the close script will tell you if it doesn't).
- `project.yaml`'s mandatory fields must be populated.

What this does:

- Merges the project branch into the default code branch in each code repo.
- Merges the project branch into the workspace's default branch.
- Creates archive tags `archive/abc-001-feature-x` everywhere and deletes the project branch.
- Auto-fires `close-knowledge.sh`, which:
  - Creates `abc-001-feature-x-knowledge` branch.
  - Synthesizes a knowledge-close proposal (or pauses for you/an agent to do so).
  - Opens a PR for domain owners (CODEOWNERS auto-assigns reviewers).

The project moves to `status: completed`. The knowledge PR is reviewed and merged separately — that lands new project-derived learnings into org-wide knowledge.

---

## 8. Common situations

**"The agent suggested doing X — should I let it?"** — Compare against the four knowledge layers in priority order. If org policy says no, the agent is wrong regardless of what it claims. If repo conventions say no, same. Developer preferences cannot override either.

**"I forgot to check `todo.md` last time and now there are stale open items."** — That's the system working. Surface them, resolve or de-scope them, move what's resolved to `## Done`, leave the rest.

**"My agent doesn't have `gh` access."** — Most operations don't need it, but `./prj init` and `./prj close` do (Project queries, PR creation). Give the agent a PAT scoped to `repo` + `project` for the run, or hand off those two specific commands to a human-driven shell.

**"I'm not sure if a change is C01, C02, or C03."** — Default to surfacing it as C02 (write to `compliance.md` and file an exception if needed). Only C01 hard-stops require pausing.

**"I want to know what's left."** — `./prj list` shows projects + statuses. For an individual project, `./prj status <PROJECT_ID>`. For carry-forward work, `projects/<PID>/knowledge/todo.md`.

---

## 9. Tool-specific notes

The session-start protocol is **one canonical source**, delivered through each tool's conventional install path. Full design: [`docs/design/agent-context-assembly-spec.md`](design/agent-context-assembly-spec.md) §3.3–§3.4.

### Canonical source (edit these)

| File | Purpose |
|---|---|
| `agent/session-protocol.md` | C01 session protocol — layer load order, gates, write rules, capture (POL-113–117) |
| `agent.md` | Org workspace entrypoint — policy pointers, repo identity |

**Do not** hand-edit generated harness install paths (see below). Run `./scripts/render-harness.sh` after changing the canonical source.

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

Harness delivery covers **protocol only**. These still require agent reads (or `./prj context assemble`) each session:

- Full `knowledge/policies/` text
- `projects/<PID>/knowledge/*`
- Code repo `knowledge/`
- `$PRJ_GOV_LOC/preferences/<gh-login>.md`

Reads persist in **chat transcript** for the rest of the session; they are not re-injected each turn like rules.

### General foot-guns regardless of tool

- **Text pointers are not file loads.** *"See `agent.md`"* in a rule instructs the model; it does not embed the file. Use Claude `@import` or Cursor generation.
- **Verify loading.** First prompt: ask for a context manifest (project, branch, open todos). Claude: `/memory`. Cursor: confirm Always rules in Settings → Rules.
- **Adopter C03 extensions** go below the `ADOPTER_C03_EXTENSIONS` marker in `agent/session-protocol.local.md` or the generated harness footer — never contradict layer priority or C01/C02 rules.
- **Migration note:** Until `agent/session-protocol.md` and `render-harness.sh` land, harness files still inline duplicate protocol — update them in lockstep if you edit protocol text.

---

## Where to go next

- [USER_GUIDE.md](USER_GUIDE.md) — concepts, roles, full CLI reference
- [`knowledge/policies/agentic-development-policy.md`](../knowledge/policies/agentic-development-policy.md) — the governing policy (POL-001 through POL-171)
- [`knowledge/policies/agentic-development-procedures.md`](../knowledge/policies/agentic-development-procedures.md) — procedural protocols
