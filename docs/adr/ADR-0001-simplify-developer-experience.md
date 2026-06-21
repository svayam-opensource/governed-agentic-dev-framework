# ADR-0001 — Simplify the developer & manager experience

- **Status:** Accepted — 2026-06-12, Policy Owner (admin@svayam.ai)
- **Related:** `knowledge/policies/specs/draft-issue-prj-use-github-login-as-identifier.md`,
  `knowledge/policies/specs/draft-issue-prj-manage-assign-github-sync.md`
- **Scope:** Framework-level (targets `publish`). Hides git/topology from daily use; does **not** change any governance guarantee.

## Context

The governance model is sound and stays: audit trail, the C01/C02/C03 compliance gates,
layered + immutable knowledge, and domain-owner approvals via CODEOWNERS.

The problem is that the framework leaks its **implementation** into everyday use:

- A developer must hold **6–8 distinct contexts** (home clone on default, per-project
  governance clone on the project branch, per-project code-repo clones, prefs file, org
  knowledge, project knowledge, task sub-branches, upstream remotes).
- "Who/what/status" lives in **three places that diverge** — `registry.yaml`,
  `project.yaml`, and GitHub Projects. This is the root of the reassign-vs-authorize bug.
- `prj` + `scripts/` are **vendored into every repo and frozen on each project branch**,
  so a framework fix must be `prj sync`'d into N branches, and the `publish/main/template`
  split exists to manage it.

Evidence (this session): an absolute-path portability bug (broke Windows `join`); a team
pre-assignment silently overwritten at `init`; registry-vs-project.yaml divergence; a
broken `publish → main` sync (`origin` has no `publish` ref).

**Confirmed constraint:** GitHub-only. We do not need to support non-GitHub orgs.

## Decisions

- **D1 — GitHub is the single source of truth.** Project existence, assignment, status, and
  authorization derive from GitHub (Projects v2 + Teams + repo permissions + CODEOWNERS).
  `registry.yaml` / `project.yaml` become a **derived cache**, never the authority.
- **D2 — Un-vendor the tooling.** Ship `prj` as an **installed, versioned CLI** (pipx/brew/npm).
  Repos carry data + convention files only — no scripts, no framework code on project
  branches. Removes per-branch staleness, framework `prj sync`, and the publish/main/template
  split as a developer concern.
- **D3 — One clone per repo, git worktrees per project.** Replace per-project full clones
  under `agent_work_root` with **`git worktree`s** of a single clone per repo. "Direction A"
  (home stays on the default branch) is preserved automatically; developers never clone again.
- **D4 — Collapse the developer surface to work-verbs.** Daily developer surface =
  **`start` / `work` / `finish`** (+ `status`). All git topology hidden. Manager surface =
  create + assign in GitHub, observe status. Governance verbs (`knowledge`, the `finish`/close
  gate) keep full rigor.
  - `start` = front door (join / new task / new project).
  - `work` = get current and continue (sync latest base, drop into the worktree).
  - `finish` = a task (submit/merge) **or** the project (close, governance gate) — context-aware.

### Verb mapping

| Old verb | Becomes | Notes |
|---|---|---|
| `init` | Manager: `prj project new` (or GitHub UI) | Registers project; repo/branch creation deferred to first `start`. |
| `join` | **gone → folds into `start`** | Join and seeder's first-work are the same action; authz = live GitHub team membership. |
| `task` | Dev: `prj start <issue>` | Task = worktree on a `--`-separated sub-branch (fixes ref-conflict draft). |
| `merge` | Dev: `prj finish` (task) | Finishing a task hands it back to the project branch (PR). |
| `sync` | **Auto / `prj work`** | `work` syncs base→branch and continues; also automatic on session start. |
| `pause`/`resume` | Status (GitHub) | Status field; resume's re-sync becomes Auto. |
| `add-repo` | Auto / light | Repo set derives from the GitHub Project's linked items. |
| `cancel` | Manager: status = cancelled | Branch/worktree cleanup is Auto. |
| `close` | Dev/Mgr: `prj finish` — **gate kept** | C01 + knowledge-close + approvals unchanged; git mechanics hidden. |
| `knowledge` | `prj knowledge` — **gate kept** | Propose → PR → CODEOWNERS approval. Unchanged. |
| `onboard` | Admin, lighter | ≈ add convention files + register. |
| `deps` | install-time / `prj doctor` | CLI handles its own deps. |
| `list`/`status` | Views over GitHub | Read-only convenience. |

## Preserved (non-negotiable)

Audit trail (git commit ledger), C01/C02/C03 enforcement, knowledge layering + immutability
during projects, owner approvals via CODEOWNERS, and the close-time knowledge-synthesis gate.
**We hide git, not governance.**

## Consequences

- **+** Developer model shrinks from 6–8 contexts to ~3 verbs.
- **+** One source of truth removes a whole bug class (divergence).
- **+** Framework upgrades become "update the CLI," not merge-to-N-branches.
- **−** Hard dependency on GitHub (accepted per constraint).
- **−** Authorization needs a live GitHub API call — must degrade gracefully offline / on
  limited token scopes.
- **−** Migration effort + a compatibility window where existing per-clone workspaces still work.

## Phased rollout (each phase shippable & reversible; governance untouched throughout)

- **Phase 0 — This ADR** + adopt GitHub-login as the identity substrate (existing draft).
- **Phase 1 — Verb facade.** Add `start`/`work`/`finish` as a thin layer over today's flows.
  Immediate UX win, no topology change, fully reversible.
- **Phase 2 — Worktrees.** Convert `lib.sh` path helpers (`org_gov_clone`, `repo_clone_dir`)
  and `join`/`seed`/`sync` to `git worktree add`. One clone per repo.
- **Phase 3 — GitHub as source of truth.** `is_authorized` reads GitHub Teams; assignment
  reads/writes the GitHub Project; `registry`/`project.yaml` demoted to cache; reassign syncs
  GitHub (adopt the manage-assign-github-sync draft).
- **Phase 4 — Un-vendor.** Package `prj` as an installable CLI; strip `scripts/` from repos;
  the CLI loads policy/knowledge from the governance repo. Retire publish/main/template as a
  developer concern.
- **Phase 5 — Collapse/rename** remaining verbs, hide the admin set, rewrite the docs.

## Open items

- Identity = GitHub login (adopt the existing draft) — prerequisite for D1/D3.
- Offline / token-scope handling for live authorization.
- How knowledge layers load once repos are pure data (CLI fetches policy from the governance repo / local cache).
- **Seed end-to-end validation is deferred to after Phase 3** — the current `init`/`seed`
  path depends on YAML-based `manage assign/unassign`, which Phase 3 replaces with GitHub.
  Validate the full new flow once assignment no longer lives in YAML.
- **Known bug in the (to-be-replaced) manage picker** (`select_from_owner_projects`,
  `prj`): it joins fields with `\t` and reads with `IFS=$'\t'`, but tab is IFS-whitespace,
  so consecutive empty fields collapse. For an *unseeded-but-assigned* project the assignee
  shifts into `MANAGE_SELECTED_PID`, so `manage unassign` no-ops. Either dies with Phase 3,
  or fix by switching the delimiter to `\x1f` (other loops already use `|`).
