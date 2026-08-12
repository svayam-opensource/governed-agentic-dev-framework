# Agentic Development Framework

A governance-first framework for organizing agentic software development inside an organization. It provides a directory structure, a policy template, and a CLI (`gov-work`) that enforces the policy through every step of a project's lifecycle — so AI agents and human developers can work in parallel on multiple projects without losing track of who owns what, what's been decided, and what changed.

This repository is a **template**. Run `gov setup <your-org>/<repo-name>` and you have a configured, registered workspace repo for your org's agentic development — the CLI creates it from this template, clones it and configures it in one command.

---

## Why this exists

Agentic development gets messy fast: agents make decisions, modify multiple repos in parallel, propose policy updates, and accumulate institutional knowledge. Most teams handle this with ad-hoc convention; that breaks down past a handful of projects or a few agents.

This framework gives you:

- **Identifiable units of work** — every project gets a sequential, immutable ID (e.g., `ACME-001-invoice-api`); branches and folders derive from it.
- **Layered knowledge** — org-wide policy, project-specific learnings, repo-local conventions, and developer preferences, with explicit precedence rules.
- **Test-merge gate** — schema, lifecycle, and cross-reference validators run locally before any merge to your default branch and again in CI on every PR. The default branch is hard to corrupt by accident.
- **Compliance levels** — three tiers (Non-Negotiable, Always Apply, Apply Intelligently) so policy can distinguish between hard rules and judgment calls.
- **One CLI** — `gov-work` wraps the whole lifecycle: seed, join, task, merge, pause, resume, sync, close, knowledge.
- **Knowledge close** — completed projects produce reviewed proposals to update org knowledge, so learnings flow back upstream.

---

## Quickstart

> This is a **template repository.** You don't fork it — you use it to scaffold *your own* private workspace repo, which you then own and commit to. The framework's `publish` upstream stays clean; your private overlay (real projects, accumulated knowledge, your `org-config.yaml` values) lives only in your repo.

**1. Install the CLI.**

```bash
# One install per machine — not vendored into repos. Requires Node 24, git,
# and an authenticated `gh` (`gh auth login`).
npm i -g @svayam-opensource/gov
```

**2. Create your workspace — one command.**

```bash
gov setup <your-github-org>/<repo-name>      # e.g. gov setup acme/acme-gov
```

That creates the repo from this template (private), clones it, asks the org
questions, writes `org-config.yaml`, and registers the workspace. You do not
create the repo in the GitHub UI, and you do not choose where to clone it — the
answers decide that.

Nothing is created on GitHub until every precondition passes: `gh` cannot delete
a repository back without the `delete_repo` scope, so `gov setup` checks
everything it can *first* rather than leaving a half-made repo in your org.

It also refuses if your org **already has** a governance repo, and tells you how
to join it instead. A second governance repo would fork your org's policy
silently, which is the one failure the framework cannot detect afterwards.

**3. Make the policy yours, then commit.**

```bash
$EDITOR knowledge/policies/agentic-development-policy.md
git add -A && git commit -m "configure the framework for <your-org>" && git push

gov          # you are ready — the interactive front door
```

### Where things live

Locations are derived from your org slug, not chosen per machine:

| what | where |
|---|---|
| governance repo | `~/.gov/<org-slug>/gov_repo` |
| project workspaces | `~/.gov/<org-slug>/projects` |
| org registry | `~/.gov/workspaces` · `~/.gov/active` |

`gov` resolves your workspace from the registry, so it works from any directory —
you never need to `cd` into the governance repo. Pass `--path <dir>` to
`gov setup` if your environment dictates where repos may live.

### Already have a repo? Configure it in place.

```bash
cd <your-existing-clone>
gov setup                 # no argument = configure THIS workspace
```

The argument is what decides: `gov setup <org>/<repo>` creates, bare `gov setup`
configures the workspace you are in. `gov setup --non-interactive` is the CI
path and never creates anything.

### Managing more than one org from the same machine

```bash
gov org use <github-org>          # switch the active org
gov org list                      # what is registered, and which is active
```

Each org gets its own `~/.gov/<slug>/`, so switching never edits a workspace.

> **Upgrading from an older install.** The registry used to live at
> `${XDG_CONFIG_HOME:-~/.config}/prj/` — named after the retired `prj` CLI. It
> moves to `~/.gov/` automatically the first time you run any `gov` command; the
> old files are copied, not moved, so nothing is lost. Earlier versions also
> wrote a `gov_workspace:` key into `org-config.yaml`; that key is retired and
> nothing writes it, though it is still read if present so existing workspaces
> keep working.

**Re-running `gov setup` later** is safe — it remembers your existing values as defaults. Use `gov setup --non-interactive` in CI or scripts to skip prompts entirely.

---

## Concepts at a glance

- **Workspace repo** — this repository. Holds policy, project workspaces, and accumulated knowledge. Not a code repo. Project state itself is derived live from GitHub (Project boards + anchor issues), not from files in this repo.
- **Project** — a unit of work with an ID, an assignee, a lifecycle (proposed → active → paused/completed/cancelled), and one or more code repos it touches.
- **Knowledge layers** (highest to lowest priority): org-wide → project → repo-local → developer preferences. Higher always wins.
- **Compliance levels** — C01 (Non-Negotiable, hard stop), C02 (Always Apply, exception PR required), C03 (Apply Intelligently, document deviation).
- **Test-merge gate** — local validators run before any push to the default branch; CI runs the same validators on every PR.

Full details in [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

---

## Documentation

| Doc | For |
|---|---|
| [README](README.md) | First-time visitor — what this is, do you want it |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Reference — concepts, roles, CLI surface |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Day-in-the-life — step-by-step working on a project, prompting the agent |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor — proposing changes to the framework itself |
| [SECURITY.md](SECURITY.md) | Security reporter |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [knowledge/policies/agentic-development-policy.md](knowledge/policies/agentic-development-policy.md) | The policy itself — read this once you've adopted |

---

## CLI

`gov-work` (npm package `@svayam-opensource/gov`, Node 24) wraps the whole lifecycle. Run `gov-work` with no arguments for an interactive menu, or a subcommand directly:

| Command | Purpose |
|---|---|
| `gov-work` | Interactive menu — wraps everything below |
| `gov seed` | Seed a new project (issues ID, scaffolds folder, creates branches) |
| `gov join` | Join an existing project you have GitHub Project access to |
| `gov task` / `gov merge` | Sub-branches for parallel agent work, and merging them back |
| `gov pause` / `gov resume` / `gov sync` | Lifecycle transitions |
| `gov close` | Close out and synthesize learnings (knowledge close runs as a step) |
| `gov cancel` | Cancel without merge |
| `gov add-repo` | Add another code repo to an active project |
| `gov knowledge` | Standalone org knowledge proposals |
| `gov onboard` | Bring an existing code repo under the framework |
| `gov manage` | Grant / change GitHub Project access |
| `gov list` / `gov status` | List projects / show one project's state |
| `gov validate` | Schema / lifecycle / cross-ref validators (also run in CI and pre-merge) |
| `gov upgrade` | Pull universal framework updates from the template upstream |
| `gov doctor` | Verify the toolchain (git, gh, Node 24) |

---

## Status

This framework is in active use at the upstream maintainer org and is offered as-is for other organizations to adopt. Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 Svayam Infoware Private Limited and contributors.
