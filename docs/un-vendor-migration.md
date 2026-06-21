# Un-vendoring migration — stripping the framework from data repos (ADR-0001 Phase 4, final step)

Phase 4 made the CLI *installable* (`./install.sh`, the `$ADF_WORKSPACE` wrapper).
This doc is the **final, optional** step: removing the vendored framework code from
governance repos so they carry **only data** (`org-config.yaml`, `registry.yaml`,
`projects/`, `knowledge/`, `docs/`). It is intentionally **not executed yet** —
it is destructive and has a hard prerequisite.

## Why not "just `rm` it now"
- `./prj` is run *from the repo* today. Deleting `prj`/`scripts/` breaks the CLI for
  **anyone who hasn't installed it** — including in-flight work and validation.
- So this runs **only after every developer has installed the CLI** (`./install.sh`)
  and confirmed `prj` works against a workspace.

## Decision: B — separate framework distribution (chosen 2026-06-12)

Data repos become **pure data**. The CLI is installed once per machine from the
**upstream framework repo** (the `publish`/template lineage, which is *designed* to be
the framework distribution; org data repos are the private overlay). Data repos carry
**no framework tooling**. (Option A — keeping `framework/` in the data repo as the
install source — was rejected.)

### What the strip removes vs keeps
- **Remove (tooling):** top-level `prj`, `scripts/`, and the framework *source* under
  `framework/` (`framework/scripts/`, `framework/bin/`, `framework/docs/`, framework
  knowledge templates), plus `setup.sh`/`install.sh` if they live in the data repo.
- **KEEP (runtime, agent-facing):** the delivered session-start harness files agents
  load every session — `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.github/copilot-instructions.md`,
  etc. — and all data (`org-config.yaml`, `registry.yaml`, `projects/`, `knowledge/`, `docs/`).
  These are *runtime config*, not tooling. (Determine the exact keep/remove file-set in a
  dry run before executing — `git rm` the wrong file breaks agent session-start.)

### Two gates remain before the strip is safe
1. **Upstream is the install source.** The current framework (the new `prj`, `scripts/`,
   `install.sh`) must live on the upstream framework repo so developers can install from it.
   In this project that means **lifting the `publish` mirror hold** and publishing the
   ADR-0001 framework upstream — the strip can't precede this.
2. **Everyone installed.** Every machine that runs `prj` has run `./install.sh` from the
   upstream and confirmed `cd <data repo> && prj list` works (no `./`).

Until both hold, the vendored `./prj` stays as the fallback.

## Safe migration sequence (Option B)
1. **Adopt the CLI everywhere.** Each developer clones the upstream framework repo and
   runs `./install.sh` (puts `prj` on `PATH` via the discovering wrapper). Confirm:
   `cd <a data repo> && prj list` works (resolves the workspace, no `./`).
2. **Gate check.** Do not proceed until step 1 is true for everyone who runs `prj`.
3. **Strip** (one commit on the data repo's default branch): `git rm -r prj scripts framework`
   (and any other vendored CLI bits), commit, push.
4. **Verify** a fresh `git clone` of the data repo + `prj` (installed) still drives the
   full lifecycle (`start`/`work`/`finish`, `manage`, etc.) against it.
5. **Docs/setup** that referenced `./prj` / `./setup.sh` from the repo are updated to the
   installed `prj` (the guides already lead with the installed-CLI model).

## Prerequisites still open before running this
- **Decision A vs B** (above) — owner's call.
- For B: confirm the upstream framework repo is the agreed install source, and that
  `install.sh` lives there (it does, in this lineage).
- **Everyone installed** (step 1). Until then, the vendored `./prj` stays as the fallback.

When those are settled, the strip itself is a single `git rm` commit — small and
reversible (it's in git history) — but it must be **coordinated**, because it changes
how every developer invokes the tool.
