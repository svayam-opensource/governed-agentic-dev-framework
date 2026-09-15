# Installing the CLI — superseded, kept as a record of ADR-0001 Phase 4

> **Do not follow the instructions that used to be on this page.** Every command in them
> installed `@svayam-opensource/prj`, the bash CLI, which has been frozen at `0.10.0` since
> svm-prj-work#290 and now publishes only a redirect shim. This file is reference-only: it records
> what Phase 4 set out to do and why, because the reasoning still holds even though the mechanism
> was replaced.
>
> **To install today**, see the root `README.md` and the npm package README at
> `publish/actions/ts/README.md`:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/svayam-opensource/governed-agentic-dev-framework/main/install.sh | bash
> ```
>
> (A sayable host for that one-liner is #231.)

## What Phase 4 was for

By default the CLI used to run **vendored** — a copy lived inside each governance repo, on every
branch. Phase 4 made it installable **once per machine** so that a governance repo could carry
pure data instead of a frozen copy of the framework.

That goal was achieved, and it is the arrangement in force today: `install.sh` puts a private Node
and the `gov` client under `~/.local/share/gov`, and the governance repo holds only
`org-config.yaml`, `governance/`, `agent/` and `projects/`. What changed is everything about *how*.

## What is no longer true

| The old page said | Today |
|---|---|
| `npm i -g @svayam-opensource/prj` | `@svayam-opensource/gov`, installed by `install.sh`, which also provides Node |
| The CLI is bash; needs `yq` and `python3` | Node 24 / TypeScript; `install.sh` supplies its own Node |
| Windows: run inside Git Bash | `install.ps1` — though the agent-install path does not work there yet (#223) |
| Resolve the workspace by walking up from `$PWD` for `org-config.yaml` | `~/.gov/<org-slug>/gov_repo` is the bootstrap anchor; `$ADF_WORKSPACE` is gone, replaced by a per-invocation flag so it cannot stale-misdirect |
| Data includes `registry.yaml` | There is no `registry.yaml` in a governance repo — GitHub is the source of truth for project state; the board number is the allocator |
| `./install.sh` with `PREFIX=` and `--uninstall` | Different script entirely; see `install.sh` itself for its flags |
| Nothing changes for vendored use | Vendoring is gone; there is no vendored mode to be compatible with |

## Why it is kept

Phase 4's argument — that framework code on every project branch makes the CLI's release cadence a
project concern, and that decoupling code from data removes a class of merge and staleness problem
— is the reasoning the current layout still rests on. Nothing links here (checked
2026-09-15: this file has no inbound references in the tree), so it is demoted rather than deleted
only because it is the companion record to `docs/adr/ADR-0001-simplify-developer-experience.md` and
`docs/un-vendor-migration.md`, which argue the same case and remain current. If those are ever
folded together, delete this file with them.
