# [Repo Name] — Agent Entry Point

**Repository:** [repo-url]
**Purpose:** [one-line description of what this repo does]
**Owner:** [team or individual responsible for this repo]

---

## Important: Knowledge Layer Priority

This file represents the **repo-local knowledge layer** — third priority in the knowledge hierarchy.

```
1. Org-wide knowledge      → <WORKSPACE_REPO>/knowledge/        [HIGHEST]
2. Project knowledge       → <WORKSPACE_REPO>/projects/PRJ-NNN-<slug>/knowledge/
3. This repo's knowledge   → this file and knowledge/repo/  [THIS FILE]
4. Your developer prefs    → $AGENT_WORK_ROOT/preferences/<your-gh-login>.md
```

**This file cannot override org-wide knowledge or policy.**
In case of conflict, org-wide knowledge always wins.
See `<WORKSPACE_REPO>/knowledge/policies/agentic-development-policy.md` for the governing policy.

---

## Repo Knowledge

Read the following before working in this repository:

- `knowledge/repo/structure.md` — directory layout, modules, packages
- `knowledge/repo/environment.md` — build tools, dependencies, setup instructions
- `knowledge/repo/patterns.md` — coding conventions, architectural patterns used here

---

## Project History

Before starting work on a new project in this repo, check prior project impact:

```
knowledge/projects/
└── PRJ-NNN-<slug>/           ← one folder per project that touched this repo
    ├── changelog.md        ← what changed and why
    ├── decisions.md        ← architectural decisions made
    └── impact-summary.md   ← how the project affected this repo
```

Understanding prior project history prevents re-litigating settled decisions.

---

## Write Restrictions

During an active project:
- Do NOT modify `knowledge/repo/` directly
- All knowledge writes go to `<WORKSPACE_REPO>/projects/PRJ-NNN-<slug>/knowledge/`
- Repo knowledge is updated only via the project's knowledge close PR

---

## Data Classification Reminder

- Never commit credentials, secrets, API keys, or PII to this repository (C01)
- See `<WORKSPACE_REPO>/knowledge/policies/data-classification.md` for full classification rules
