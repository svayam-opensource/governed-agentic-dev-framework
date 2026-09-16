# Installing `gov`

```bash
curl -fsSL https://raw.githubusercontent.com/svayam-opensource/governed-agentic-dev-framework/main/install.sh -o install.sh \
  && bash install.sh
source ~/.bashrc          # or ~/.zshrc — the installer says which
gov
```

`install.sh` fetches its own Node under your home directory and installs
`@svayam-opensource/gov` from npm. It touches no system directory and needs no
`sudo`; `curl` and `tar` are the only prerequisites, and both are already present
everywhere this can run. Testers point it at a local build with
`GOV_PKG=/path/to.tgz`.

**Fetch, then run — do not `curl … | bash`.** Piped, a failed download is silent:
`curl -f` writes nothing and exits 22, `bash` reads an empty stdin and exits 0, and
the pipeline reports success. Nothing installs, and the first symptom is
`gov: command not found` somewhere later, with nothing connecting the two.

---

## What changed from `prj`, for anyone following an old link

This page used to document `@svayam-opensource/prj` — the bash CLI, vendored into each governance
repo. That whole model is gone. The obsolete instructions are **removed rather than left below a
banner**: a reader who scrolled past the warning would have followed them.

| The old page said | Today |
|---|---|
| `npm i -g @svayam-opensource/prj` | `@svayam-opensource/gov`, installed by `install.sh`, which supplies its own Node |
| The CLI is bash; needs `yq` and `python3` | Node 24 / TypeScript; no system Node required |
| Windows: run inside Git Bash | `install.ps1` — though the agent-install path does not work there yet (#223) |
| Walk up from `$PWD` for `org-config.yaml` | `~/.gov/<org-slug>/gov_repo` is the bootstrap anchor; `$ADF_WORKSPACE` is gone, replaced by a per-invocation flag so it cannot stale-misdirect |
| Data includes `registry.yaml` | There is no `registry.yaml` — GitHub is the source of truth, and the board number is the allocator |
| Nothing changes for vendored use | Vendoring is gone; there is no vendored mode to be compatible with |

Phase 4's argument — that framework code on every project branch makes the CLI's release cadence a
project concern — is the reasoning the current layout still rests on, and is recorded in
`docs/adr/ADR-0001-simplify-developer-experience.md` and `docs/un-vendor-migration.md`. A full
rewrite of the adopter-facing install story is framework#181.
