# Agentic Development Framework

A governance-first framework for organizing agentic software development inside an organization. It provides a directory structure, a policy template, and a CLI (`gov-work`) that enforces the policy through every step of a project's lifecycle — so AI agents and human developers can work in parallel on multiple projects without losing track of who owns what, what's been decided, and what changed.

This repository is a **template**. Clone it, configure `org-config.yaml` with your organization's values, run `gov setup`, and you have a workspace repo for your org's agentic development.

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

**1. Create your repo from the template.** Open the framework's repo on GitHub:

> https://github.com/svayam-opensource/governed-agentic-dev-framework

Click the green **"Use this template"** button → **"Create a new repository"**. Pick a name (e.g. `acme-gov-work`) and visibility (typically Private). GitHub creates the repo under your account or org.

**2. Install the CLI, clone your repo, run setup.**

```bash
# One install per machine — not vendored into repos. Requires Node 24, git,
# and an authenticated `gh`.
npm i -g @svayam-opensource/gov

# Clone YOUR new repository (not this template). Anywhere you like — the
# directory you clone into IS your governance workspace.
git clone https://github.com/<your-github-org>/<your-new-repo>.git
cd <your-new-repo>

# Configure the framework for your org and verify GitHub access. Interactive:
# org name, slug, role identities, service endpoints — defaults detected from
# gh and git config. `gov doctor` checks the toolchain (git, gh, Node 24) first.
gov setup

# Optional: make the policy yours before anyone works under it.
$EDITOR knowledge/policies/agentic-development-policy.md

git add -A && git commit -m "configure the framework for <your-org>" && git push

# You are ready.
gov
```

That is the whole runbook for **one org**. There is no registration step: `gov`
finds your workspace by walking up from the current directory, so any command
run inside the clone resolves it.

**3. Only if you manage a SECOND org from the same machine.**

One clone per org, then register each so `gov` can be run from anywhere:

```bash
# Register the workspace — the path is the CLONE you ran `gov setup` in.
gov org add <github-org> --home /path/to/that/clone
gov org use <github-org>          # make it the active org
gov org list                      # what is registered, and which is active
```

`--home` is required, and it must point at a directory containing
`org-config.yaml` — that is, the clone itself. The registry lives at
`${XDG_CONFIG_HOME:-~/.config}/prj/`, outside every repo, so switching orgs
never edits a workspace.

> **Note for anyone upgrading from an older workspace.** Earlier versions wrote a
> `gov_workspace:` key into `org-config.yaml` and told you to register
> `~/.<org-slug>/gov_repo`. That convention is retired — nothing creates that
> path, and `gov org add` will refuse it. The key is still *read* if present, so
> existing workspaces keep working; new ones do not get it. Register the clone.

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
