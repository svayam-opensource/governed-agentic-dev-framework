**Repository:** https://github.com/svayam-opensource/governed-agentic-dev-framework
**Purpose:** The governed agentic development framework: the gov CLI (@svayam-opensource/gov-work) and the framework content — knowledge scaffolds, agent entry points, lifecycle scripts and CI — that svm-prj-work renders into each org workspace.
**Owner:** svayam-rkant

---
This file represents the **repo-local knowledge layer** — third priority.

```
1. Org-wide knowledge      → svm-prj-work/knowledge/        [HIGHEST]
2. Project knowledge       → svm-prj-work/projects/<project-id>/knowledge/
3. This repo's knowledge   → this file and knowledge/repo/      [THIS FILE]
4. Your developer prefs    → <work_root>/preferences/<your-gh-login>.md
```

**This file cannot override org-wide knowledge or policy.**

---
Read before working in this repository:
- `knowledge/repo/structure.md`   — directory layout, modules, packages
- `knowledge/repo/environment.md` — build tools, dependencies, setup
- `knowledge/repo/patterns.md`    — coding conventions, architectural patterns

---
Keep this folder current with the code that makes it true: a change that moves a module, changes the
toolchain, or overturns a convention updates `knowledge/repo/` in the **same pull request** as the code.
Stale repo knowledge is the failure mode this layer exists to prevent. (POL-086b — edits ride the branch
and take effect when it merges; the review gate is this repository's own `CODEOWNERS`.)

What does **not** belong here: a second copy of a governed rule. On conflict the org layer wins, so a
local copy is silently wrong the moment it drifts — link up to the governing document, do not restate it.

Never commit credentials, secrets, API keys, or PII (C01).
