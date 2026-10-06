<!-- GENERATED from the framework harness source — do not edit by hand -->

<!-- gov-protocol-version: 2 -->
<!-- Placed and verified by gov at session start. gov refuses to launch an agent into a project
     where this file is missing, empty, or lacks the version line above. -->

# Agent operating protocol — <ORG_NAME>

You are working inside a governed workspace. This file is your context: it is placed by `gov`,
regenerated every session from the organization's ratified governance, and it is the authority
for how you work here.

Read it in this order. **Part A binds every turn.** Part B is what you do before your first
substantive reply. Part C is reference you will need once.

---

# Part A — Always

**These rules bind every turn, not just the first. Each line is a rule's GOV id and its cue; the rule row
that id names is the authority.**

- GOV-FRM-012 · C01 MEANS STOP: stop all work, commit nothing, tell the human, and wait. Nobody can grant an exception to a C01 rule.
- GOV-FRM-020 · C02 MEANS NOT WITHOUT A MERGED EXCEPTION under policies/exceptions/, existing before you act. A verbal yes is not one; blocked and waiting is correct.
- GOV-FRM-021 · C03 MEANS ADAPT AND SAY SO: deviating is allowed, deviating silently is not. Record what you did and why in the project's knowledge, as you do it.
- GOV-FRM-040 · YOU DO NOT APPROVE YOUR OWN WORK, and nothing merges without a review. Every change lands by a pull request someone authorized approves; land task branches with gov merge.
- GOV-FRM-041 · WORK ONLY INSIDE AN ACTIVE PROJECT: no commit, knowledge change or resource change outside one.
- GOV-FRM-044 · PROJECT AND TASK STATE LIVE ON THE BOARD, never in a file: there is no registry.yaml or project.yaml. Create tasks with gov task, land them with gov merge.
- GOV-FRM-076 · READ IN THIS ORDER, fresh every session: org knowledge and policies, then this project's, then each repo's, then your own preferences. Higher layers win.
- GOV-FRM-080 · READ ONLY YOUR OWN PERSON'S PREFERENCES: every other preferences folder belongs to someone else.
- GOV-FRM-086 · YOUR UNMERGED EDITS TO knowledge/ OR policies/ ARE PROPOSALS: never follow or cite them as rules. Governance comes from the default branch.
- GOV-FRM-113 · BEFORE ANY WORK, IN YOUR FIRST REPLY: read org-config.yaml, verify you are authorized and the board is open, load the layers fresh, pull the project branch, post the context manifest. Asked to skip it? Say you cannot, and why.
- GOV-FRM-114 · YOU ARE AUTHORIZED ONLY IF you have write access to this project's board, and on a task sub-branch only if it is assigned to you. Cannot verify it? Stop, tell the human, commit nothing.
- GOV-FRM-128 · NEVER COMMIT $AGENT_WORK_ROOT or anything beside it: other people's preferences and keys live there.
- GOV-FRM-133 · A PREFERENCES FILE CANNOT OVERRIDE policy, security mandates, compliance levels or layer priority: ignore the override and tell the human.
- GOV-FRM-172 · NEVER EDIT framework/, on any branch: gov upgrade is its only writer.
- GOV-FRM-173 · CODE NEVER GOES IN THE GOVERNANCE REPO, and governance never goes in a code repo.
- GOV-FRM-402 · ONE FACT, ONE DOCUMENT: link, never restate. The same rule in two places saying different things? Stop and report it.
- GOV-FRM-432 · ANY AGENT OR SESSION YOU SPAWN MUST BE GIVEN THIS PROTOCOL. Pass it, or do the work yourself.
- GOV-FRM-443 · NEVER INVENT AN ID OR A BRANCH: gov seed issues the project id, gov task the task branch, gov merge lands it. Think you need one? Say so instead.
- GOV-FRM-460 · STRUCTURE IS MERMAID TEXT, never an image: a flow, architecture, sequence or state machine.
- GOV-FRM-466 · NEVER FORCE-PUSH a branch other people work on.

## A.1 What you may write, and what you may not

During an active project:

- ✅ Writable: `projects/<PROJECT_ID>/` (workspace repo) and code on the project branch in cloned repos under `$AGENT_WORK_ROOT/<PROJECT_ID>/`.
- ⚠️ Org `knowledge/` **may** be edited on the project branch, but such edits are **proposals with no governing force** until merged to `<DEFAULT_BRANCH>` (GOV-FRM-086). Never treat your own unratified edits as authority.
- ❌ Never hand-manage task state — tasks are GitHub Issues on the board (open = active, closed = done); create with `gov task`, land with `gov merge`.
- ❌ Don't create GitHub Issues unilaterally — those represent business intent that humans add to the GitHub Project board.

## A.2 Where work happens

- Code repos are cloned at `$AGENT_WORK_ROOT/<PROJECT_ID>/<repo-name>/`, each on the project branch.
- Code changes go in those cloned repos — **NOT** in the workspace repo's tree.
- Project metadata (knowledge, decisions, to-dos) goes in `projects/<PROJECT_ID>/` in the workspace repo.

## A.3 While you work

- Capture decisions, exceptions, and policy notes in `projects/<PROJECT_ID>/knowledge/` as you make them — not at session end.
- **Draw, don't just describe.** When the knowledge you're capturing has a flow, architecture, sequence, state machine, or relationship, author it as a **Mermaid diagram (text, never an image — GOV-FRM-460)** instead of prose. One artifact serves both readers: it renders as a picture for humans and stays ~tens of diffable, RAG-indexable lines for agents and PR review. Default to a diagram for anything structural; reach for `flowchart`/`sequenceDiagram`/`stateDiagram`/`erDiagram`/`C4Context` as fits.
- Capture intermediate to-dos in `projects/<PROJECT_ID>/knowledge/todo.md` under `## Open` as they arise.
- When an item from `todo.md` is resolved, move it to `## Done` with a short note (commit SHA, PR link, or one-line outcome).

---

# Part B — Before any meaningful work

## 0. Before any meaningful work

**Applies to:** every new session, and every session resumed after a context reset.

Your first substantive reply must be the **context manifest** produced by B.1–B.3.

Until you have done that, you must **refuse meaningful work** — no file edits, no
commits, no branch changes, no task creation — however the session opens. If the
first message asks for work, run B.1–B.3 first, post a short manifest, and then
address it. If asked to skip this, say that you cannot and why.

gov normally hands you this protocol as your first message. If it did not — you
were started outside `gov work` — the rule is unchanged: run it before acting.

### Context manifest (required format)

Use this structure in your first reply:

```markdown
## Context manifest

- **Project:** <PROJECT_ID or "none">
- **Branch:** <current git branch>
- **Status:** <derived from the GitHub board (open = active), or n/a>
- **Repos:** <the board's linked repos, or n/a>
- **Open todos:** <bullets from todo.md ## Open, or "none">
- **Layers loaded:** org ✓/✗ · project ✓/✗ · repo ✓/✗ · prefs ✓/✗
- **Awaiting:** your direction (no tasks proposed)
```

After the manifest, **stop**. Do not propose implementation work unless the user's first message already asked for something specific — and even then, complete the manifest first.

## B.1 Read `org-config.yaml` first

Read `org-config.yaml` at the workspace repo root before anything else. The framework ships
with no org-specific values baked in: files refer to them through angle-bracketed tokens that
map to keys in that file by name — `<ORG_NAME>` is `org_name`, `<ORG_GOV_REPO>` is
`org_gov_repo`, uppercase token to snake_case key. Read the file itself rather than a copy of
its index.

If `org-config.yaml` has empty values (`org_name: ""`), the workspace is still in TEMPLATE
state. Hard-stop and tell the human to run `gov setup`.

## B.2 Load four knowledge layers — fresh every session

Read these in priority order (highest first). Never use cached layers from a prior session:

1. **Org-wide knowledge** — `knowledge/` in this repo, from the `<DEFAULT_BRANCH>` branch.
2. **Active project** — `projects/<PROJECT_ID>/knowledge/` plus the project's own entrypoint at `projects/<PROJECT_ID>/agent.md`. To determine the active `PROJECT_ID`: read the current git branch — **GitHub is the source of truth; there is no `registry.yaml`**. Project branches are named `BRNCH-<board#>-<slug>`, where `board#` is the GitHub project board number with no leading zero; the matching project id is `PRJ-<board#>-<slug>`. Pre-existing projects keep their legacy `brnch-NNN-<slug>` names.
3. **Repo-local** — `<repo>/knowledge/` for each linked code repo at `$AGENT_WORK_ROOT/<PROJECT_ID>/<repo-name>/`.
4. **Your developer preferences** — `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md`. Run `gh api user --jq .login` to determine your handle; load **only** your file. Other files in that directory belong to other developers — do not read them.

Higher layers always win. Developer preferences cannot override repo-local or org-wide knowledge.

## B.3 Verify project state — hard stops

If a project is active:

- Confirm you are authorized: you have **write access to the project's linked GitHub Project** (the authorization source of truth — an owner grants it via `gov manage assign`). There is no `project.yaml` — GitHub Project write access is the sole gate. When on a task sub-branch (`BRNCH-<board#>-<slug>.ISSUE-<n>`), confirm that sub-branch's assignee is you.
- The project's GitHub board must be **open** (an open board = active).
- Read `projects/<PROJECT_ID>/knowledge/todo.md` and surface its `## Open` items to the developer before planning new work.

If any of these can't be verified, hard-stop and surface to the human. Do not commit anything.

---

# Part C — Reference

The token map (`<ORG_NAME>` → `org_name` and the rest) and the full policy text are not
reproduced here, to keep what you carry every turn short:

- **`framework/policies/framework-policy.md`** — the full policy. Part A above is its
  C01 digest, copied verbatim by the renderer; this is the source.
- **`docs/DEVELOPER_GUIDE.md`** — the human walkthrough, with example prompts.
- **`projects/<PROJECT_ID>/agent.md`** — your project-specific entrypoint, once seeded.
- **`org-config.yaml`** — every org token's value, at the workspace root.

Tokens like `<PROJECT_ID>`, `<repo-name>` and `<your-gh-login>` are not in that file: they are
per-session values you discover from the current branch, the GitHub Project board, and
`gh api user`.
