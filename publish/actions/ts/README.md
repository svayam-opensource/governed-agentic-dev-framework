# @svayam-opensource/gov

A CLI for running software projects under **explicit, versioned governance** — where the rules a
team works by live in the repository, are reviewed like code, and are enforced by the tools rather
than remembered by people.

It manages the project lifecycle end to end: create a project from a GitHub Project board, bring
its repositories onto matching branches, open and land task branches, keep an org-wide knowledge
base under review, and close the project by promoting what it learned back to `main`.

```bash
npm i -g @svayam-opensource/gov
gov                 # interactive menu
gov --version
```

**Requires** Node 24+, `git`, and the GitHub CLI (`gh`) authenticated. Run `gov deps` for
per-OS install hints, or `gov doctor` to check a workspace.

## Getting started

```bash
gov setup           # bootstrap a workspace: org identity → org-config.yaml → origin
gov seed            # create a project from a GitHub Project board
gov task            # open a task sub-branch for an issue, and assign it
gov merge           # land it back on the project branch and close the issue
gov close           # knowledge gate → promote to main → close the board
```

`gov status` and `gov list` show where things stand; `gov validate` runs the governance
validators (protocol · knowledge · secrets · privacy · version-sync).

## What "governed" means here

Governance is **sourced from `main`**. Your working branch may propose changes to the rules, but a
proposal does not govern anything until it is merged — so the standard a project is held to is always
a reviewed one, never whatever happens to be checked out. `gov` reads its knowledge layers fresh
(org → project → repo → your preferences), highest wins.

That is the whole idea: the rules are text, in git, reviewed by humans, applied by a tool.

## Enterprise deploy (optional)

Catalog and deployment verbs — `catalog`, `deploy`, `promote`, `rollback`, `drift`, `data` — come
from a separate plugin, `@svayam/gov-cicd`. Install it and they appear in `gov` automatically;
without it they are simply absent. Nothing in this package requires it.

## Relationship to `@svayam-opensource/prj`

`prj` was the original bash implementation. It is **frozen at `0.10.0`** and still works. This package
is the TypeScript successor and installs alongside it, so adopters migrate on their own schedule.

## Contributing

Build, test and layout notes are in [CONTRIBUTING.md](https://github.com/svayam-opensource/governed-agentic-dev-framework/blob/main/publish/actions/ts/CONTRIBUTING.md). Tests are additive by
design: every bug that reaches a user should leave a cheap guard behind so it cannot regress.

## Command reference

Run `gov` with no arguments for an interactive menu. Every command is reachable both
directly (`gov <command>`) and through a menu path (`gov` ▸ Category ▸ command).

| command | menu path | purpose |
|---|---|---|
| `setup` | Admin ▸ setup | Bootstrap a workspace: prompt org identity, write `org-config.yaml`, point `origin` at the org repo |
| `seed` | Work ▸ seed | Create a project from a GitHub Project board — workspace + branches + anchor issue |
| `join` | Work ▸ join | Join an existing project (co-dev): clone/worktree its repos on the project branch |
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
| `upgrade` | Maintain ▸ upgrade | Sync workspace content to the published framework (`--from`/template `--pr`/`--apply`); else CLI self-update guidance |
| `bump-version` | Maintain ▸ bump-version | Bump the CLI package + content `VERSION` in lockstep |
| `publish` | Maintain ▸ publish | Pre-publish gate (version-sync); real publish stays governed |

**Not `gov` commands.** `catalog` `deploy` `data` `promote` `rollback` `drift` `auth` `creds` belong to
**`gov-cicd`**, and the infrastructure verbs to **`gov-infra`** — separate CLIs, invoked directly
(`gov-cicd deploy <unit> --env dev`). They are not plugins of `gov`: nothing is discovered, merged or
delegated. Typing one of them into `gov` tells you which client owns it.

Global flags: `--gov-home <path>` / `$PRJ_GOV_HOME` target an explicit workspace
(bypassing resolution).

Blueprint: `units/gov-work/SDD.md`.
