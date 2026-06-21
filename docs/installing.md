# Installing the `prj` CLI (un-vendored) — ADR-0001 Phase 4

By default `prj` runs **vendored** — the CLI lives inside each governance repo
(`./prj`). Phase 4 makes it possible to install the CLI **once per machine** so
repos can carry pure data instead of a frozen copy of the framework on every
branch.

## Install from npm (recommended)
The CLI is open source, published publicly as **`@svayam-opensource/prj`** on
**npmjs.com** — no registry config or auth needed. This is the easiest path for
developers: no repo checkout of the framework, just the governance workspace you
already clone.

**Prerequisites** (not npm dependencies — `prj` is bash): `bash`, `git`,
`gh` (authenticated), `yq`, `python3`. On Windows, run inside **Git Bash**.

1. Install globally:
   ```bash
   npm i -g @svayam-opensource/prj
   ```
2. Run `prj` from **anywhere inside a governance repo** (the repo containing
   `org-config.yaml`). The npm `bin` wrapper discovers the workspace the same way
   the installed wrapper does (see *How it finds the workspace* below).

Upgrade with `npm i -g @svayam-opensource/prj@latest`; uninstall with
`npm rm -g @svayam-opensource/prj`.

## Install from source (`install.sh`)
Use this when you want to install the CLI from a local framework checkout
(e.g. an unreleased build) instead of npm.
```bash
./install.sh                  # installs to ~/.local (bin + share/adf)
PREFIX=/usr/local ./install.sh # system-wide
./install.sh --uninstall
```
Ensure the prefix's `bin/` is on your `PATH`. Then run `prj` from **anywhere
inside a governance repo** — the installed wrapper finds the workspace.

## How it finds the workspace
The installed `prj` is a thin wrapper that resolves the workspace in this order:
1. `$ADF_WORKSPACE`, if set (and it contains `org-config.yaml`); else
2. the nearest ancestor directory of `$PWD` containing `org-config.yaml`
   (like `git` finding `.git`); else
3. it errors, asking you to `cd` into a governance repo or set `$ADF_WORKSPACE`.

The CLI code (`prj` + `scripts/`) is read from the install location; the
**data** (`org-config.yaml`, `registry.yaml`, `projects/`, `knowledge/`) is read
from the resolved workspace. The two are fully decoupled.

## Backward compatible
Nothing changes for vendored use: when `$ADF_WORKSPACE` is unset, `prj` and the
lifecycle scripts resolve config/registry from their own location exactly as
before. Un-vendoring is opt-in via the installed wrapper (which sets
`$ADF_WORKSPACE`).

## What this removes
Once teams use the installed CLI, framework code no longer needs to live on (and
be `prj sync`'d into) every project branch, and the `publish`/`main`/`template`
split stops being a developer concern — the CLI is updated by re-running
`install.sh` from an updated framework checkout, independently of project data.
