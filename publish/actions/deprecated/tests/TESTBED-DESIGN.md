# Governance Test Bed — Design

> Status: design (PRJ-43-governance-common-project). Tracks the rigorous,
> cross-platform pre-publish test bed for the `prj` CLI and the governance
> process. Supersedes/expands issue #44.

## 1. Goals

Prove the governance process and every `prj` command work end-to-end, on every
supported OS, before publish — so a defect like the PRJ-43 `ADF_WORKSPACE`
resolution bug (which shipped untested) cannot recur.

## 2. Decisions (locked 2026-06-26)

| Area | Decision |
|---|---|
| **Harness** | **BATS** (bats-core) + helpers; the two **E2E flows** are the backbone, with a **per-command full option matrix** layered on. |
| **OS matrix** | macOS, Windows (Git Bash), Ubuntu — GitHub-hosted; **Fedora** and **Slackware** as **containers** (Slackware via a custom-built image). |
| **Identities** | **Single bot** GitHub account; manager/developer/owner **roles simulated** via anchor-issue assignees + labels + project write-access (no distinct logins). |
| **Externals** | Broad matrix is **hermetic** (Jenkins/Docker stubbed). A **separate, manually-gated suite** runs **real** deploys (local + dev) against a **fixture app stack**. |
| **GitHub fixtures** | Ephemeral Projects/issues created via API in a **sandbox org/repo**, torn down per run. |

## 3. CI topology — two tiers

**Tier A — broad matrix (every PR).** Hermetic. Runs on all 5 OSes.
- OS jobs: `macos-latest`, `windows-latest` (bash), `ubuntu-latest`; plus
  `container: fedora:latest` and `container: <org>/slackware-prj-ci:<tag>` on
  ubuntu runners.
- Stubs: a `bin/stubs/` on `PATH` shadowing `docker`, `gh` (record/replay or
  canned JSON), and the Jenkins trigger — so command logic, arg parsing, branch
  ops, scaffolding, resolution, and the menu run with no real side effects.
- Covers: fresh-clone+setup E2E (§5a), governance day-to-day E2E (§5b) minus
  real deploy, and the per-command matrix (§6) for everything except real
  deploy/data.

**Tier B — real gated suite (manual / nightly).** Linux + Docker only.
- Real `gh` against the sandbox org (bot PAT secret), real local `docker
  compose` deploys of the fixture app, and real **dev** deploys via Jenkins
  (creds as secrets). Side-effectful and slow → never on the per-PR path.
- Covers: real `prj deploy <unit> --local|--dev`, `prj data <unit> <env>`
  against a live DB, provision/seed flows.

## 4. Fixture app stack (Tier B)

A minimal but real catalog the deploy/data tests stand up:

- **spa** (`kind: spa`) — static frontend that calls the api.
- **api** (`kind: api`) — backend that (a) reads/writes the **db** and (b) calls
  an **external public service** (the GitHub REST API) to prove outbound calls.
- **db** (platform service) — Postgres with **seed data** + a `db-data` hook so
  `prj data db <env>` works (`--tables`, `--list`, `--describe`, SQL).
- Declared in a fixture `services.yaml` → `prj catalog build` derives
  `graph.lock`; `prj deploy spa --local` brings the stack up; tests assert the
  SPA serves, the API answers, the DB has rows, and the external call succeeds.

## 5. End-to-end flows

**(a) Fresh clone + setup.** Clone the template repo → run `setup.sh`
(non-interactive + a driven-interactive case) → assert: org-config populated,
gov_workspace recorded, pointer file written, framework files byte-identical,
`prj` resolves the home deterministically (incl. from `/tmp`, from inside
`.bases`, with env unset). This is the "org gov repo established" gate.

**(b) Day-to-day (managers + developers).** Against the established gov repo:
- **manage** (manager): create a sandbox GitHub Project + anchor issue → assign
  owner/developer (simulated via assignees + project access).
- **work** (developer): `prj work` → init-or-continue → session-start; `task` →
  `merge`; `finish`.
- **status/catalog/data/deploy/admin/help**: exercise each category. Deploy/data
  hit the fixture app in Tier B; hermetic elsewhere.
- Teardown: close issues, delete the Project, prune branches/worktrees.

## 6. Per-command full matrix (BATS)

One BATS suite per command, parameterised over option combinations for **local**
and **dev** (uat/prod excluded from automated runs). Commands to cover:

`init · join · start · work · finish · task · merge · sync · pause · resume ·
cancel · close · list · list-all · status · manage · add-repo · onboard ·
migrate-home · upgrade · deps · creds · knowledge · catalog (view/dag/build/
check/add/update/rm) · config (scaffold/check) · data (--list/query) · deploy
(--local/--dev × --provision/--no-provision/--seed/--dry-run) · schedules ·
version · help (--detail/<command>)`.

Each case asserts the **observable contract** (exit code, files written, branch/
worktree state, GitHub state, stdout shape), not internals. Resolution
regression cases (the PRJ-43 bug) live here: env set/unset × cwd home/`.bases`/
per-project/`/tmp` × pointer present/absent.

## 7. GitHub fixture lifecycle

- A dedicated **sandbox org/repo**; a **bot PAT** in CI secrets.
- `fixture_new_project` → create Project + anchor issue, return identifiers.
- Role simulation: add/remove anchor assignees, apply `paused`/`cancelled`
  labels, grant/revoke project write — all as the single bot.
- `fixture_teardown` (always, even on failure) → close issues, delete Project,
  delete remote test branches, remove local worktrees. Idempotent; tagged with a
  run id to avoid collisions across parallel CI jobs.

## 8. Phasing (epic)

- **P0 — Foundation**: sandbox org/repo + bot PAT secret; bats-core vendored;
  `tests/bats/` layout + helpers (stubs, fixture lifecycle); migrate the 17
  existing `tests/*.sh` to BATS; Tier-A CI on `ubuntu-latest` only.
- **P1 — OS matrix**: add macOS, Windows, Fedora container; **build the
  Slackware CI image** + add it.
- **P2 — Fresh setup E2E** (§5a) across the matrix.
- **P3 — Per-command matrix** (§6), hermetic, across the matrix.
- **P4 — Fixture app stack** (§4): services.yaml + spa/api/db + seed + data hook.
- **P5 — Tier-B real suite**: real local + dev deploys, data queries; gated
  workflow + secrets.
- **P6 — Day-to-day governance E2E** (§5b) with simulated roles.

## 9. Risks / open items

- **Slackware image** upkeep (no upstream CI image; pin + rebuild cadence).
- **Bot rate limits** under parallel CI → serialize fixture creation / backoff.
- **Dev real-deploy** cost, secrets, and state isolation (dedicated dev namespace).
- **Windows Git Bash** path/quoting quirks (the matrix is the point — expect fixes).
- Single-bot role simulation can't catch true cross-user permission denials;
  documented limitation (revisit if multi-account bots are later approved).
