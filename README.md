# `prj` — Governance Actions for the Agentic Development Framework

`@svayam-opensource/prj` is the **client you run to take governed actions** on
your projects — start work, assign owners, create tasks, finish — entirely on top
of GitHub, under your organization's policy. You run `prj` and follow the menus;
**you don't need to memorize commands.**

---

## The framework has two components

![The framework has two components — Governance Content (the rules and scaffolding) and Governance Actions (prj, the client that acts) — both operating on your governance workspace; adopt Content first, then act with prj.](https://cdn.jsdelivr.net/npm/@svayam-opensource/prj@latest/assets/readme/two-components.svg)

1. **Governance Content** — the policies, knowledge structure, agent harness, and
   scaffolding that define *how* your org governs agentic work. **This lives in the
   template repo** — adopt and refresh it there:
   👉 **https://github.com/svayam-opensource/governed-agentic-dev-framework**
2. **Governance Actions** — **this package (`prj`)**: the client you run to *take*
   governed actions on your projects. **This README covers the Actions.**

---

## Governance Actions (`prj`)

### Purpose
One client for the whole governed project lifecycle on GitHub. Instead of
hand-managing boards, branches, and issues, you run `prj`, pick what you want to
do, and it performs the action under policy — keeping ownership, status, and
history consistent. The goal is *not* for you to learn every command — just to
**run `prj` and follow the journeys** below.

### Install
```bash
npm i -g @svayam-opensource/prj
```
Runtime prerequisites (not npm dependencies — `prj` is bash): `bash`, `git`,
`gh` (authenticated), `yq`, `python3`. On Windows, run inside **Git Bash**.

### Sequencing — Content first, then Actions
![Sequencing — adopt Governance Content from the template repo and run setup, then configure your workspace via org-config.yaml, then run prj to take Actions.](https://cdn.jsdelivr.net/npm/@svayam-opensource/prj@latest/assets/readme/sequencing.svg)
`prj` acts *on* a configured governance workspace. **Which path applies to you
depends on whether your org has already adopted the framework:**

- **First-time adopter — you're the governance owner/admin for your org.**
  Set up **Governance Content first** from the
  [template repo](https://github.com/svayam-opensource/governed-agentic-dev-framework)
  (clone it, run its `setup.sh`, fill in `org-config.yaml`), **then** install and
  run `prj`. You are the one who copies and tailors the content.
- **Your org already runs the framework — you're a developer/contributor.**
  **Do not copy the template or re-run setup.** Your governance admin has already
  adopted and customized the content. Just `npm i -g @svayam-opensource/prj`, get
  the **workspace location from your governance admin**, and run `prj` from inside
  it (or point `$ADF_WORKSPACE` at it). For anything about the governance content
  itself — policies, knowledge, the agent harness, who owns what — **contact your
  org's governance admin**, not this README.

Run `prj` from anywhere inside the workspace (it finds it via `$ADF_WORKSPACE` or
the nearest `org-config.yaml`).

### Dependencies — GitHub is the substrate
`prj` keeps no separate database. Every fact lives in GitHub:
![Dependencies — prj keeps no database; every fact lives in GitHub: Projects (a board IS a project, ownership and status), Issues (units of work, the anchor issue carries ownership), Repos (where code lives, derived from the board's issues), and GitHub Actions (CI gates that enforce the policy).](https://cdn.jsdelivr.net/npm/@svayam-opensource/prj@latest/assets/readme/dependencies.svg)

### Journeys — *how do I…?*
You don't need the command list. Run **`prj`** and follow the menu (every step is
back-navigable — pick `0) ← back` anytime). Common paths:

| I want to… | Do this |
|---|---|
| **See the projects** | `prj` → **list** (ongoing) — or `prj manage list-all` for the full board universe |
| **Assign a project / set its owner** | `prj manage` → **Project** → owners → **add** (grants board access + marks the anchor issue's owner) |
| **Start working on a project** | `prj work` → **pick the project** → it ensures the project is set up and **opens it in your agent**, with the session-start protocol already running |
| **Start a task** (parallel work on an issue) | `prj work` → pick project → **New branch** → pick the issue(s) |
| **Continue existing work** | `prj work` → pick project → **Existing branch** → pick it |
| **Finish a task / close a project** | `prj work` → pick project → pick the branch → **Finish** (merges the task, or closes the project through the governance gate) |
| **Propose a policy or knowledge change** | `prj knowledge` |

> Fuller, step-by-step journeys live in the framework's knowledge base under
> **paths / development procedures** (see the template repo).

---

## License
MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Svayam Infoware Private Limited and contributors.
