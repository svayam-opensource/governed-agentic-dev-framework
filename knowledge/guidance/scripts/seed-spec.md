# Script Specification: seed

**Purpose:** Transitions a project from PROPOSED to ACTIVE. Scaffolds the project workspace, clones repos, and creates branches.
**Compliance:** C01 for all validation gates
**Policy Reference:** POL-056 to POL-075

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `github_project_url` | Yes | URL to the GitHub Project in `{{WORKSPACE_REPO}}` |
| `assignee` | Yes | Individual email or team-id |

---

## Pre-conditions / Validation Gates

**C01 Hard Block — script refuses to proceed if any fail:**
- GitHub Project exists and is accessible
- GitHub Project has a name
- At least one Issue or PR is linked to the project

**C02 Warnings — script proceeds but logs warnings:**
- Each linked Issue/PR belongs to an identifiable repo
- Project has a description
- At least one Issue marks scope/goals

---

## Steps

1. Validate GitHub Project against gates above
2. Slugify the GitHub Project name → `short-slug` (lowercase, hyphen-separated)
3. Read `registry.yaml` → get `last_issued`, compute `NNN = last_issued + 1`
4. Compose project ID: `{{ORG_SLUG}}-NNN-slug`
5. Create branch `{{org_slug}}-NNN-slug` from `{{DEFAULT_BRANCH}}` in `{{WORKSPACE_REPO}}`
6. Switch to new branch
7. Create directory `projects/{{ORG_SLUG}}-NNN-slug/` with structure:
   ```
   projects/{{ORG_SLUG}}-NNN-slug/
   ├── project.yaml
   ├── requirements/
   ├── environment/
   ├── knowledge/
   └── agent.md
   ```
8. Generate `project.yaml` from template with all known fields populated
9. Generate `agent.md` for the project (layer references in priority order)
10. Read GitHub Issues/PRs to identify involved repos
11. For each repo identified:
    - Prompt: "Base branch for `<repo>`? [dev]:" (allow override)
    - Record `base_branch` in `project.yaml`
    - Clone repo into `<agent_work_root>/{{ORG_SLUG}}-NNN-slug/<repo-name>/`
    - Create branch `{{org_slug}}-NNN-slug` from `base_branch`
    - Push branch to remote
12. Update `registry.yaml`: increment `last_issued`, append project to `projects[]`
13. Set `project.yaml` status to `active`, populate `started_at`
14. Commit all changes to `{{org_slug}}-NNN-slug` branch in `{{WORKSPACE_REPO}}`
15. Push branch to remote

---

## Outputs

- `projects/{{ORG_SLUG}}-NNN-slug/` workspace scaffolded in `{{WORKSPACE_REPO}}`
- Branch `{{org_slug}}-NNN-slug` created in `{{WORKSPACE_REPO}}` and all identified repos
- `registry.yaml` updated with new project
- `project.yaml` status: `active`

---

## Error Conditions

| Error | Behavior |
|---|---|
| Registry conflict (NNN already exists) | Hard stop — manual registry inspection required |
| Repo clone failure | Hard stop — log error, do not partially scaffold |
| Branch already exists in a repo | Hard stop — investigate before proceeding |
| GitHub Project not found | Hard stop — verify URL and access permissions |
| C01 validation gate fails | Hard stop — surface specific failure to human |
