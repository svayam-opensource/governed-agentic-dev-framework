# Agentic Development Framework

A governance-first framework for organizing agentic software development inside an organization. It provides a directory structure, a policy template, a CLI, and a set of scripts that enforce the policy through every step of a project's lifecycle — so AI agents and human developers can work in parallel on multiple projects without losing track of who owns what, what's been decided, and what changed.

This repository is a **template**. Clone it, configure `org-config.yaml` with your organization's values, run `setup.sh`, and you have a workspace repo for your org's agentic development.

---

## Why this exists

Agentic development gets messy fast: agents make decisions, modify multiple repos in parallel, propose policy updates, and accumulate institutional knowledge. Most teams handle this with ad-hoc convention; that breaks down past a handful of projects or a few agents.

This framework gives you:

- **Identifiable units of work** — every project gets a sequential, immutable ID (e.g., `ACME-001-invoice-api`); branches and folders derive from it.
- **Layered knowledge** — org-wide policy, project-specific learnings, repo-local conventions, and developer preferences, with explicit precedence rules.
- **Test-merge gate** — schema, registry, lifecycle, and cross-reference validators run locally before any merge to your default branch and again in CI on every PR. The default branch is hard to corrupt by accident.
- **Compliance levels** — three tiers (Non-Negotiable, Always Apply, Apply Intelligently) so policy can distinguish between hard rules and judgment calls.
- **One CLI** — `prj` wraps the whole lifecycle: seed, task, merge, pause, resume, sync, close, propose-knowledge.
- **Knowledge close** — completed projects produce reviewed proposals to update org knowledge, so learnings flow back upstream.

---

## Quickstart

```bash
# 1. Use this template (GitHub: "Use this template" button) or clone it
git clone https://github.com/your-github-org/your-workspace-repo.git
cd your-workspace-repo

# 2. Install dependencies (git, gh, yq, python3, pyyaml)
bash scripts/install-deps.sh

# 3. Edit org-config.yaml with your organization's values
$EDITOR org-config.yaml

# 4. Substitute placeholders throughout the framework
bash setup.sh

# 5. Read the policy and customize it for your org
$EDITOR knowledge/policies/agentic-development-policy.md

# 6. Commit your configured framework
git add -A && git commit -m "configure framework for <your-org>"

# 7. Start using it
./prj
```

The `prj` CLI is interactive: it lists current projects, walks you through seeding new ones, creating tasks, and closing them.

---

## Concepts at a glance

- **Workspace repo** — this repository. Holds policy, project manifests, and accumulated knowledge. Not a code repo.
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
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Daily user — how to operate within the framework |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor — proposing changes to the framework itself |
| [SECURITY.md](SECURITY.md) | Security reporter |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [knowledge/policies/agentic-development-policy.md](knowledge/policies/agentic-development-policy.md) | The policy itself — read this once you've adopted |

---

## Scripts and CLI

| Tool | Purpose |
|---|---|
| `./prj` | Interactive CLI — wraps everything below |
| `scripts/seed.sh` | Seed a new project (sets ID, scaffolds folder, creates branches) |
| `scripts/create-task.sh` / `merge-task.sh` | Sub-branches for parallel agent work |
| `scripts/pause.sh` / `resume.sh` / `sync.sh` | Lifecycle transitions |
| `scripts/close-project.sh` / `close-knowledge.sh` | Close out and synthesize learnings |
| `scripts/cancel.sh` | Cancel without merge |
| `scripts/propose-knowledge.sh` | Standalone org knowledge proposals |
| `scripts/onboard-repo.sh` | Bring an existing code repo under the framework |
| `scripts/test-merge.sh` | Local pre-merge validator (used by lifecycle scripts) |
| `scripts/validate/run.py` | Schema/registry/lifecycle/cross-ref validators |
| `scripts/sync-from-publish.sh` | Pull universal updates from the framework's upstream branch |

---

## Status

This framework is in active use at the upstream maintainer org and is offered as-is for other organizations to adopt. Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 Svayam Infoware Private Limited and contributors.
