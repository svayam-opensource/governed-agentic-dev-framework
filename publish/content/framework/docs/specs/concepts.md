---
domain: governance
layer: spec
owner: policy-owner
compliance: C02
status: current
---
# Concepts

The vocabulary the rest of this documentation assumes. Read once; consult when a term stops
being obvious.

## Concepts

### Workspace repo

The repository containing this guide is the **workspace repo**. It's not a code repo — it holds:

- `knowledge/` — org-wide policy, guidance, architecture, accumulated learnings
- `projects/` — one folder per project, holding project-specific knowledge
- `org-config.yaml` — your org's specific values (org name, slug, GitHub org, role holders)

There are no per-project state files. Project state — the project index, active/done status, ownership, authorization — is derived live from GitHub (project boards plus their anchor issues); GitHub is the sole source of truth.

Code lives in separate repos that projects reference; the workspace repo coordinates them.

### Project

A unit of work with a unique ID — e.g., `PRJ-26-invoice-api`. The ID is composed of:

- The fixed `PRJ-` prefix
- The GitHub project **board number** (`26`) — the integer in the linked GitHub Project's URL, no leading zero — issued by `gov seed`
- A slug derived from the project's GitHub Project name

Each project has:

- A folder: `projects/PRJ-26-invoice-api/`
- A workspace branch: `BRNCH-26-invoice-api` (same board number + slug, `BRNCH-` prefix) in this repo and in every code repo it touches; task sub-branches append `.ISSUE-<n>`
- A lifecycle: `proposed` → `active` → (`paused` ↔ `active`) → `completed` or `cancelled`, tracked by the state of the GitHub board (open = active) rather than a state file
- Ownership — the anchor issue's assignees. Authorization to operate on the project is **write access to its linked GitHub Project** (`projectV2.viewerCanUpdate`), granted by an owner via `gov manage assign`. (Org owners/admins have access to everything.)

### Knowledge layers

When an agent or developer reads context, four layers apply, with explicit precedence:

| Layer | Path | Owns what |
|---|---|---|
| 1. Org-wide (highest) | `knowledge/` in this repo | Policy, role definitions, organizational standards |
| 2. Project | `projects/<id>/knowledge/` | Project-specific decisions, learnings, compliance notes |
| 3. Repo-local | `knowledge/` in each code repo | Repo conventions, structure, build environment |
| 4. Developer (lowest) | `$AGENT_WORK_ROOT/preferences/<your-gh-login>.md` | Personal preferences |

Higher layer always wins. If org-wide policy says X and a developer preference says Y, X applies.

The developer preferences file is **per-user**, keyed on your GitHub login. `gov setup` creates one from `knowledge/guidance/preferences-template.md` the first time you run it (or `gov-work` creates one lazily on your first write op if `gov setup` ran without gh authenticated). To keep multiple profiles, save backups alongside (`<login>.md_work`, `<login>.md_oss`) and rotate by `mv`. The framework loads only the file at `<login>.md`.

### Compliance levels

Every rule in the policy is tagged with a level:

- **C01 — Non-Negotiable**: Hard stop. `gov-work` refuses to proceed. Exceptions require Policy Owner approval via PR.
- **C02 — Always Apply**: Block work pending an approved exception PR (in `policies/exceptions/`).
- **C03 — Apply Intelligently**: Proceed if you have good reason; document the deviation in the project's `compliance.md`.

The validators (`gov validate`) enforce structural invariants. The compliance levels apply to *interpretation* of policy by humans and agents.

---

## Roles

Two role types: **Owners** (accountable, approve PRs) and **Managers** (delegated PR authors).

| Role | Approves what |
|---|---|
| Policy Owner | Any change to `framework/policies/`, roles, agent.md |
| Legal Owner | `knowledge/legal/` |
| Infrastructure Owner | `knowledge/infrastructure/`, CI/CD |
| System Architecture Owner | `knowledge/architecture/system/` |
| Data Architecture Owner | `knowledge/architecture/data/` |

CODEOWNERS in this repo enforces the routing automatically — domain owners are auto-assigned as PR reviewers based on which folders the PR touches.

Current role holders are listed in `framework/policies/framework-policy.md` §3.2. By default at adoption, the Policy Owner holds all roles until they're delegated.

---
