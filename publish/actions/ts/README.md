# @svayam-opensource/gov

Policy-governed, AI-assisted software development on top of GitHub — where the rules a team works
by live in the repository, are reviewed like code, and are enforced by the tools rather than
remembered by people.

The framework has **two components** — the rules, and the client that acts under them.

![The framework has two components — Governance Content (the rules and scaffolding) and Governance Actions (gov, the client that acts) — both operating on your governance workspace; adopt Content first, then act with gov.](https://cdn.jsdelivr.net/npm/@svayam-opensource/gov@latest/assets/readme/two-components.svg)

1. **Governance Content** — the policies, knowledge structure, agent harness, and install
   manifest that define *how* your org governs agentic work. Your org adopts it and keeps it
   current.
2. **Governance Actions** — **`gov`** (this package): the client you run to *take* governed
   actions — start work, assign owners, create tasks, finish — entirely on GitHub, under the
   Content's policy. Run `gov` and follow the menus; **you don't memorize commands.**

```bash
npm i -g @svayam-opensource/gov
gov                 # interactive menu
gov --version
```

**Requires** Node 24+, `git`, and the GitHub CLI (`gh`) authenticated. Run `gov deps` for per-OS
install hints, or `gov doctor` to check a workspace.

---

## Governance Content

### What it is

Everything that defines your governance, with **no org-specific values baked in** — those live in
your `org-config.yaml`, read at runtime:

- **Policies** — the agentic-development policy and procedures, roles, data classification, the
  knowledge-organization standard.
- **Knowledge structure + starters** — the `knowledge/` taxonomy and seed docs your org builds on,
  organized by accountability domain.
- **Agent harness** — the canonical session-start protocol (`agent/session-protocol.md`), rendered
  to each tool's rules file (`CLAUDE.md`, `.cursor/…`, `AGENTS.md`, `.clinerules/…`, …) by the
  framework's harness renderer, plus the enforcement gate.
- **Install manifest** — `MANIFEST.yaml`: what scaffolds where, and what an upgrade may touch
  versus what your org owns and is never overwritten.

### Adopt & keep it current

- **Adopt (new org):** `gov setup` — bootstrap a workspace: org identity → `org-config.yaml` →
  `origin`.
- **Upgrade:** `gov upgrade` — pulls the latest published content and overlays it, **preserving
  your `org-config.yaml` and your customizations**. Dry-run by default; `--apply` to write. Files
  your org has changed are reported as conflicts and left alone rather than overwritten.
- **Propose a change:** `gov knowledge` for org-local knowledge; a PR against this repo's
  `publish/content/` for changes that should reach **all** adopters.

---

## Governance Actions (`gov`)

### Purpose

One client for the whole governed project lifecycle on GitHub. Instead of hand-managing boards,
branches, and issues, you run `gov`, pick what you want to do, and it performs the action under
policy — keeping ownership, status, and history consistent. The goal is *not* for you to learn
every command — just to **run `gov` and follow the journeys** below.

### Sequencing — Content first, then Actions

![Sequencing — adopt Governance Content, then configure your workspace via org-config.yaml, then run gov to take Actions.](https://cdn.jsdelivr.net/npm/@svayam-opensource/gov@latest/assets/readme/sequencing.svg)

`gov` acts *on* a configured governance workspace. **Set up Governance Content first, then use
`gov`:**

- **First-time adopter (governance owner/admin):** adopt the Content into your org's governance
  repo and configure it with `gov setup`, **then** use the lifecycle verbs.
- **Developer in an org that already runs the framework:** **don't** re-adopt or re-run setup.
  `npm i -g @svayam-opensource/gov`, get the **workspace location from your governance admin**,
  and run `gov` inside it. Content questions — policies, knowledge, who owns what — go to your
  governance admin.

Run `gov` from anywhere inside the workspace; it resolves the workspace from the nearest
`org-config.yaml`, then the registered gov home. `--gov-home <path>` (or `$PRJ_GOV_HOME`) targets
an explicit workspace and bypasses resolution.

### Dependencies — GitHub is the substrate

`gov` keeps no separate database. Every fact lives in GitHub:

![Dependencies — gov keeps no database; every fact lives in GitHub: Projects (a board IS a project, ownership and status), Issues (units of work, the anchor issue carries ownership), Repos (where code lives, derived from the board's issues), and GitHub Actions (CI gates that enforce the policy).](https://cdn.jsdelivr.net/npm/@svayam-opensource/gov@latest/assets/readme/dependencies.svg)

A board *is* a project; its number is the project's number. Ownership is the anchor issue's
assignees. Status is derived — an open board is active, a `paused`/`cancelled` label on the anchor
issue says otherwise. There is no `registry.yaml` and no `project.yaml`: a cache of GitHub facts
can disagree with GitHub, and the gates built on it then fire against valid projects.

### Journeys — *how do I…?*

You don't need the command list. Run **`gov`** and follow the menu (every step is back-navigable —
pick `0) ← back` anytime). Common paths:

| I want to… | Do this |
|---|---|
| **See the projects** | `gov list` (ongoing) — or `gov list-all` for the full board universe |
| **Assign a project / set its owner** | `gov manage assign <github-login>` — grants board access **and** adds the anchor issue's owner, in lockstep |
| **Start working on a project** | `gov work` → **pick the project** → it seeds or joins as needed and **opens it in your agent**, with the session-start protocol already running |
| **Start a task** (parallel work on an issue) | `gov task <issue-url>` — opens the sub-branch and assigns the issue |
| **Continue existing work** | `gov work` → pick project → pick the existing branch |
| **Finish a task** | `gov merge` — lands it on the project branch and closes the issue |
| **Close a project** | `gov close` — knowledge gate → promote to `main` → close the board |
| **Propose a policy or knowledge change** | `gov knowledge propose <slug>` → edit → `gov knowledge submit <slug>` |

> Fuller, step-by-step journeys live in your org's `knowledge/` under **paths** and **development
> procedures**.

---

## What "governed" means here

Governance is **sourced from `main`**. Your working branch may propose changes to the rules, but a
proposal does not govern anything until it is merged — so the standard a project is held to is
always a reviewed one, never whatever happens to be checked out. `gov` reads its knowledge layers
fresh (org → project → repo → your preferences), highest wins.

That is the whole idea: the rules are text, in git, reviewed by humans, applied by a tool.

`gov validate` runs the governance validators — protocol · knowledge · secrets · privacy ·
version-sync — on demand, as a pre-push hook, and in CI.

---

## Operating model — who does what

- **Maintainers / contributors** evolve the framework here — Content under `publish/content/` and
  the `gov` CLI under `publish/actions/ts/` — and publish it (content by merge; CLI to npm).
- **Governance-repo admins** adopt the Content into their org's repo, `gov upgrade` to stay
  current, and propose changes back.
- **Developers** `npm i -g @svayam-opensource/gov` and use it to do governed work.

Full who-does-what, step by step: **[docs/operating-model.md](https://github.com/svayam-opensource/governed-agentic-dev-framework/blob/main/docs/operating-model.md)**.

---

## Relationship to `@svayam-opensource/prj`

`prj` was the original bash implementation. It is **deprecated and frozen at `0.10.0`** — every
published version carries an npm deprecation notice pointing here. It still runs, but it enforces
a retired authority model (`registry.yaml` / `project.yaml`) and will hard-stop on projects created
under the current one. `gov` installs alongside it, so adopters migrate on their own schedule.

If you are still on `prj`, the mapping is: lifecycle verbs keep their names on `gov`; `start` →
`gov work`; `finish` → `gov merge` or `gov close`; `init` → `gov work` or `gov seed`; and the
build/deploy/data verbs moved to `gov-cicd`.

## Enterprise deploy (optional)

Catalog and deployment verbs — `catalog` `deploy` `data` `promote` `rollback` `drift` `auth`
`creds` — belong to **`gov-cicd`**, and the infrastructure verbs to **`gov-infra`**. These are
**separate CLIs, invoked directly** (`gov-cicd deploy <unit> --env dev`) — not plugins of `gov`:
nothing is discovered, merged or delegated. Typing one of them into `gov` tells you which client
owns it. Nothing in this package requires them.

## Contributing

Build, test and layout notes are in [CONTRIBUTING.md](https://github.com/svayam-opensource/governed-agentic-dev-framework/blob/main/publish/actions/ts/CONTRIBUTING.md). Tests are additive by
design: every bug that reaches a user should leave a cheap guard behind so it cannot regress.

## Command reference

Run `gov` with no arguments for an interactive menu. Every command is reachable both directly
(`gov <command>`) and through a menu path (`gov` ▸ Category ▸ command).

| command | menu path | purpose |
|---|---|---|
| `setup` | Admin ▸ setup | Bootstrap a workspace: prompt org identity, write `org-config.yaml`, point `origin` at the org repo |
| `seed` | Work ▸ seed | Create a project from a GitHub Project board — workspace + branches + anchor issue |
| `join` | Work ▸ join | Join an existing project (co-dev): clone/worktree its repos on the project branch |
| `work` | Work ▸ work | The front door: pick a project, seed/join as needed, run session-start, open your agent |
| `task` | Work ▸ task | Open a task sub-branch for an issue + assign it |
| `merge` | Work ▸ merge | Merge a finished task → project branch; archive; close the issue |
| `sync` | Work ▸ sync | Re-sync project branches with the latest base branches |
| `add-repo` | Work ▸ add-repo | Pull another repo into the active project |
| `close` | Work ▸ close | Close a project: knowledge gate → PR-promote to main → close board → archive |
| `pause` | Work ▸ pause | Pause an active project |
| `resume` | Work ▸ resume | Resume a paused project |
| `cancel` | Work ▸ cancel | Cancel a project: archive branches (no merge) + close board |
| `manage` | Admin ▸ manage | List projects + owners; add/remove owners (anchor-issue assignees) |
| `anchor` | Admin ▸ anchor | Show the current project's anchor issue (url · labels · owners) |
| `knowledge` | Admin ▸ knowledge | Org-knowledge lifecycle: `propose` / `submit` / `archive` |
| `onboard` | Admin ▸ onboard | Scaffold a `knowledge/` folder into an existing repo + raise a PR |
| `org` | Admin ▸ org | Multi-home registry: `add` / `use` / `list` / `remove` workspaces |
| `list` / `list-all` | Status ▸ list | List ongoing (or all) projects with owners + derived status |
| `status` | Status ▸ status | The current project's live status (board state × anchor labels) |
| `validate` | Maintain ▸ validate | Governance validator suite (protocol · knowledge · secrets · privacy · version-sync) |
| `doctor` | Maintain ▸ doctor | Health check: git/gh · workspace resolves · active org · CLI↔content version · stale layout |
| `deps` | Maintain ▸ deps | Report runtime prereqs (git · gh) + per-OS install hints |
| `upgrade` | Maintain ▸ upgrade | Sync workspace content to the published framework (`--from`/template · `--pr` · `--apply`); else CLI self-update guidance |
| `bump-version` | Maintain ▸ bump-version | Bump the CLI package + content `VERSION` in lockstep |
| `publish` | Maintain ▸ publish | Pre-publish gate (version-sync); real publish stays governed |

Blueprint: `units/gov-work/SDD.md`.

## License

MIT — see [LICENSE](https://github.com/svayam-opensource/governed-agentic-dev-framework/blob/main/LICENSE). Copyright (c) 2026 Svayam Infoware Private Limited and contributors.
