---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Proposing knowledge and exceptions

Changing org knowledge when you are not in a project, raising a C02 exception, and where
repo-local knowledge belongs.

## Knowledge proposals (outside any project)

For policy updates, ad-hoc learnings, or initial bootstrap knowledge — anything that isn't tied to a specific project:

```bash
gov knowledge
```

Walks you through:
1. Choosing a slug (e.g., `auth-pattern-update`)
2. Creating branch `knowledge-<slug>`
3. Letting you edit `knowledge/` files manually
4. Optionally raising the PR with `--submit`

This is the right path for:
- Policy text updates (Policy Owner)
- Adding new guidance documents
- Capturing learnings that arose outside a project

---

## Exception process

When you need to deviate from policy, raise an exception PR:

1. Copy the appropriate template from `policies/exceptions/<domain>/TEMPLATE.md`:
   - `legal/` — legal/regulatory deviations (Legal Owner approves)
   - `infrastructure/` — CI/CD, hosting (Infrastructure Owner)
   - `architecture/` — system or data architecture (the relevant Architecture Owner)
   - `policy/` — anything else, including project reassignment (Policy Owner)
2. Fill in: rule being excepted, justification, risk assessment, alternatives considered, exception start/end dates
3. Commit on your project branch
4. Raise a PR
5. Wait for the appropriate Owner to review and merge
6. **Do not proceed with the excepted action until the PR is merged**

C02 rules require an approved exception PR. C03 rules just require documentation in `projects/<id>/knowledge/compliance.md`.

---

## Repo-local knowledge

Code repos under the framework have their own `knowledge/` folder:

- `knowledge/agent.md` — entry point pointing to layer priority and writes restrictions
- `knowledge/repo/structure.md` — directory layout, modules, packages
- `knowledge/repo/environment.md` — build tools, dependencies, setup
- `knowledge/repo/patterns.md` — coding conventions specific to this repo
- `knowledge/projects/<id>/` — per-project impact notes (changelog, decisions, impact-summary)

To onboard an existing code repo:

```bash
gov onboard
```

This scaffolds the `knowledge/` structure and raises a PR in that repo. Repo owners populate the placeholder files post-merge.

---
