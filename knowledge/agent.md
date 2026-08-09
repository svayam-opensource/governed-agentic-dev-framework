**Repository:** https://github.com/svayam-opensource/governed-agentic-dev-framework
**Purpose:** The governed agentic development framework: the gov CLI (@svayam-opensource/gov-work) and the framework content — knowledge scaffolds, agent entry points, lifecycle scripts and CI — that svm-prj-work renders into each org workspace.
**Owner:** svayam-rkant

---
This file represents the **repo-local knowledge layer** — third priority.

```
1. Org-wide knowledge      → svm-prj-work/knowledge/        [HIGHEST]
2. Project knowledge       → svm-prj-work/projects/<project-id>/knowledge/
3. This repo's knowledge   → this file and knowledge/repo/      [THIS FILE]
4. Your developer prefs    → /Users/rkant/.svm/projects/preferences/<your-gh-login>.md
```

**This file cannot override org-wide knowledge or policy.**

---
Read before working in this repository:
- `knowledge/repo/structure.md`   — directory layout, modules, packages
- `knowledge/repo/environment.md` — build tools, dependencies, setup
- `knowledge/repo/patterns.md`    — coding conventions, architectural patterns

---
During an active project:
- Do NOT modify `knowledge/repo/` directly.
- All knowledge writes go to `svm-prj-work/projects/<project-id>/knowledge/`.
- Repo knowledge is updated only via the project's knowledge close PR.

Never commit credentials, secrets, API keys, or PII (C01).
