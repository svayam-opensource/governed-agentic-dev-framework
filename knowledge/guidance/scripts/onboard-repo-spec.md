# Script Specification: onboard-repo

**Purpose:** Initializes the `knowledge/` folder structure in an existing code repo, bringing it under the {{ORG_NAME}} Agentic Development Policy.
**Compliance:** C02 — repo owner must approve the PR
**Policy Reference:** POL-108

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `repo_url` | Yes | Full GitHub URL of the repo to onboard |
| `repo_description` | Yes | One-line description of what the repo does |
| `repo_owner` | Yes | Team or individual responsible for this repo |

---

## Pre-conditions

- Requester must have push access to the target repo
- Repo must not already have a `knowledge/` folder

---

## Steps

1. Clone or navigate to the target repo
2. Check for existing `knowledge/` folder — hard stop if it already exists
3. Create `knowledge/` folder structure:
   ```
   knowledge/
   ├── agent.md          ← populated from repo-agent-template.md
   └── repo/             ← placeholder for repo owner to populate
       ├── structure.md  ← placeholder
       ├── environment.md ← placeholder
       └── patterns.md   ← placeholder
   ```
4. Generate `knowledge/agent.md` from `repo-agent-template.md` template, filling in:
   - Repo name and URL
   - Repo description and owner
5. Add placeholder content to `knowledge/repo/` files with instructions for repo owner
6. Commit changes to a new branch: `onboard-knowledge`
7. Push branch to remote
8. Raise PR: `onboard-knowledge` → repo's default branch
   - PR title: `[Onboard] Initialize knowledge/ folder for agentic development`
   - PR description: explain purpose and what repo owner needs to populate
9. Repo owner reviews and merges

---

## What Repo Owner Must Do After Merge

After the PR is merged, the repo owner should populate:
- `knowledge/repo/structure.md` — describe the repo's directory layout, modules, packages
- `knowledge/repo/environment.md` — build tools, dependencies, local setup instructions
- `knowledge/repo/patterns.md` — coding conventions, architectural patterns specific to this repo

These can be submitted via a follow-up `propose-knowledge`-style PR directly in the repo.

---

## What This Script Does NOT Do

- Does NOT modify existing CI/CD pipelines
- Does NOT add any application code
- Does NOT enforce any structural changes beyond adding `knowledge/`

---

## Error Conditions

| Error | Behavior |
|---|---|
| `knowledge/` already exists | Hard stop — investigate existing structure |
| No push access to repo | Hard stop — request access first |
| PR creation failure | Retry once; surface to human if failed |
