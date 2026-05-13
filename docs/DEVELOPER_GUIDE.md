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

If `AGENT_WORK_ROOT` isn't set, the framework uses `~/work`. Override only if you want clones somewhere else:

```bash
export AGENT_WORK_ROOT=~/code/agent-work
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
- For each repo linked to the Project, the repo is cloned into `$AGENT_WORK_ROOT/ABC-001-feature-x/<repo>/` and the project branch is created from its base branch.
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
2. **Verify `project.yaml`**: `locked_by` matches you, `status: active`.
3. **Read all four knowledge layers, fresh** — never use cached context across sessions:
   - `knowledge/` (org-wide policy)
   - `projects/ABC-001-feature-x/knowledge/` (project knowledge accumulated so far)
   - `<repo>/knowledge/` for each code repo (repo conventions)
   - `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` (your own developer preferences)
4. **Read `projects/ABC-001-feature-x/knowledge/todo.md`** — surface its `## Open` items before planning new work.
5. **Pull latest on the project branch in each code repo**:
   ```bash
   cd $AGENT_WORK_ROOT/ABC-001-feature-x/<repo>
   git checkout abc-001-feature-x
   git pull origin abc-001-feature-x
   ```

### Prompting the agent (first prompt of a session)

A good opening prompt makes the agent's compliance posture explicit. Adapt this template:

```
I'm starting a session on project ABC-001-feature-x.

Before any work:
1. Read projects/ABC-001-feature-x/agent.md and confirm you've loaded
   the four knowledge layers it points at.
2. Verify project.yaml: locked_by must match rkant@svayamtech.com, status active.
3. Read projects/ABC-001-feature-x/knowledge/todo.md and surface any open items.
4. Briefly summarize: project status, locked_by, primary repo(s), and what
   carry-forward items exist from prior sessions.
5. Wait for me to direct the work — do not propose tasks unilaterally,
   issues come from the GitHub Project board.
```

The agent should respond with a short status summary, not a plan. You direct what comes next.

### Doing the actual work

- **Code changes** go in the cloned code repos under `$AGENT_WORK_ROOT/ABC-001-feature-x/<repo>/`, on the project branch.
- **Project knowledge** goes in `projects/ABC-001-feature-x/knowledge/` in the workspace repo:
  - `compliance.md` — required at close; records C01 violations, C02 exceptions, C03 deviations.
  - `notes.md` — decisions, design rationale, anything future-you would need.
  - any other domain-specific files as needed (`security.md`, `migrations.md`, etc.).
- **Intermediate to-dos** go in `projects/ABC-001-feature-x/knowledge/todo.md` under `## Open`. Capture them as they arise, not at session end.
- **NEVER** edit:
  - The workspace repo's `knowledge/` (read-only during the project).
  - `project.yaml`'s `tasks` list directly — use `./prj task` / `./prj merge`.
  - GitHub Issues unilaterally — those represent business intent humans add to the board.

### Prompting style during the session

- Drive the work by **direction**, not by **delegation**. The agent shouldn't autonomously decide what to implement.
- When asking the agent to make a change, point at the file path under `$AGENT_WORK_ROOT/...` so it doesn't get confused with the workspace repo's tree.
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
   cd $AGENT_WORK_ROOT/ABC-001-feature-x/<repo>
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

The framework's session-start protocol is identical regardless of which LLM coding tool you use; only the **invocation surface** differs. We ship a bootstrap file at each major tool's conventional path — the file restates the four-knowledge-layers protocol so any tool that auto-loads its convention file gets the framework's instructions without further setup.

Per-project copies are scaffolded by `seed.sh` under `projects/<PID>/` so a developer opening their tool with the project directory as workspace still gets project-aware context.

| Tool | File the tool reads | Auto-load behavior | Quirks worth knowing |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md` (root) | Loads `CLAUDE.md` automatically at session start | Existing pointer; predates this framework. Currently bootstraps to `agent.md`. |
| **OpenAI Codex** | `AGENTS.md` (root) | Loads `AGENTS.md` at session start across Codex CLI, Codex Web, ChatGPT coding mode | Plain markdown; no frontmatter. Most adoptable convention right now. |
| **Cursor** | `.cursor/rules/agent.mdc` | Loaded when `alwaysApply: true` is in frontmatter (we ship that) | `.mdc` requires YAML frontmatter — our file includes it. Legacy `.cursorrules` is deprecated; don't use it. |
| **Aider** | `CONVENTIONS.md` (root) | Aider reads it when run with `--read CONVENTIONS.md` or via `/read` slash-command in session | Aider does not auto-load — you must explicitly invoke. Add `--read CONVENTIONS.md` to your shell alias. |
| **Windsurf** | `.windsurf/rules/agent.md` | Loaded when present in the rules directory | Generally auto-loads; may require a one-time confirmation in the IDE settings. |
| **Cline / Roo Code** | `.clinerules/agent.md` | Auto-loaded on VS Code startup when the extension is active | Supports nested `.clinerules/` per subdirectory — useful if you scope your editor to `projects/<PID>/`. |
| **GitHub Copilot Workspace** | `.github/copilot-instructions.md` | Auto-loaded by Copilot on any repo file it edits | Effectively a "global system prompt" for Copilot in this repo. Don't add per-file rules here — keep it framework-level. |
| **Gemini Code Assist** | `.gemini/styleguide.md` | Auto-loaded by Code Assist when the file is present | Convention is less standardized than the others; placement may evolve. Re-check Google's docs if behavior changes. |
| **Continue.dev** | `.continue/rules.md` | Auto-loaded as a system message at session start | If you use Continue's config-as-yaml for context providers, this file complements (doesn't replace) that. |

### General foot-guns regardless of tool

- **Don't rely on transitive file loading.** Some tools follow file references (e.g. *"see `agent.md`"*), some don't. The bootstrap files restate the protocol verbatim so transitive loading isn't required.
- **Verify your tool actually loaded the file.** First prompt of every session should ask the agent to summarize what it read. If it didn't load the framework protocol, the rest of the session is unguarded.
- **Adopter customization vs framework intent.** These bootstrap files are designed to be edited by adopters — add org-specific extensions below the standard sections. Just don't remove or contradict the four-knowledge-layers protocol; doing so breaks the policy contract.

---

## Where to go next

- [USER_GUIDE.md](USER_GUIDE.md) — concepts, roles, full CLI reference
- [`knowledge/policies/agentic-development-policy.md`](../knowledge/policies/agentic-development-policy.md) — the governing policy (POL-001 through POL-171)
- [`knowledge/policies/agentic-development-procedures.md`](../knowledge/policies/agentic-development-procedures.md) — procedural protocols
