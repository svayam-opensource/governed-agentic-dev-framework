# Installing `gov`

```bash
curl -fsSL https://raw.githubusercontent.com/svayam-opensource/governed-agentic-dev-framework/main/install.sh -o install.sh \
  && bash install.sh
source ~/.profile         # only if the installer says it appended a line there — it names the file
gov
```

`install.sh` fetches its own Node under your home directory and installs
`@svayam-opensource/gov` from npm. It touches no system directory and needs no
`sudo`; `curl` and `tar` are the only prerequisites, and both are already present
everywhere this can run. Testers point it at a local build with
`GOV_PKG=/path/to.tgz`.

**What it changes on your machine (#211).** Node goes under `~/.local/share/gov/node`, and a
Node you already have is left alone — still the `node` your shell finds. `gov` reaches its own
Node through a small wrapper:

- If `~/.local/bin` is already on your `PATH` (Fedora, RHEL, Rocky), the wrapper goes there and
  **no shell profile is touched**. `gov` works in the terminal you ran the installer from.
- If it is not (Debian, Ubuntu, macOS), **one marked line is appended** to the end of your shell
  profile (`~/.zshrc`, `~/.bashrc`, `~/.bash_profile` or `~/.profile`, whichever your shell
  reads), after everything already on `PATH`, and the installer names the file in one line. Open
  a new terminal, or `source` that file.

**Fetch, then run — do not `curl … | bash`.** Piped, a failed download is silent:
`curl -f` writes nothing and exits 22, `bash` reads an empty stdin and exits 0, and
the pipeline reports success. Nothing installs, and the first symptom is
`gov: command not found` somewhere later, with nothing connecting the two.

## Windows

```powershell
winget install Svayam.Gov
```

Then open a **new** terminal and run `gov`. The first run takes you through setup.

The package is an MSI that installs for you alone. It needs no administrator rights and changes nothing
machine-wide. It brings its own Node 24 and leaves any Node already on the machine untouched. It adds one folder
to your PATH, `%LOCALAPPDATA%\Programs\gov\bin`. Double-clicking the `.msi` gives the same result, and its last page
offers to launch gov. Update with `winget upgrade Svayam.Gov`. Uninstalling from *Installed apps* removes gov and the
agents it installed, and keeps `~/.gov` (your workspaces and preferences).

- **winget lags a release.** Microsoft reviews every winget listing, which takes hours to days. The signed
  `gov-<version>-x64.msi` (or `-arm64.msi`) is on the release page as soon as the release is out. Use it when
  `winget` does not offer the new version yet.
- **Until the first signed MSI is released,** use `install.ps1`. The Windows code-signing certificate is pending.

---

## What changed from `prj`, for anyone following an old link

This page used to document `@svayam-opensource/prj` — the bash CLI, vendored into each governance
repo. That whole model is gone. The obsolete instructions are **removed rather than left below a
banner**: a reader who scrolled past the warning would have followed them.

| The old page said | Today |
|---|---|
| `npm i -g @svayam-opensource/prj` | `@svayam-opensource/gov`, installed by `install.sh`, which supplies its own Node |
| The CLI is bash; needs `yq` and `python3` | Node 24 / TypeScript; no system Node required |
| Windows: run inside Git Bash | Native Windows, no Git Bash: the per-user MSI, through `winget install Svayam.Gov` (above). `install.ps1` is kept only as a machine path (CI, Server Core) and documented in the command reference (`gov help install`) |
| Walk up from `$PWD` for `org-config.yaml` | `~/.gov/<org-slug>/gov_repo` is the bootstrap anchor; `$ADF_WORKSPACE` is gone, replaced by a per-invocation flag so it cannot stale-misdirect |
| Data includes `registry.yaml` | There is no `registry.yaml` — GitHub is the source of truth, and the board number is the allocator |
| Nothing changes for vendored use | Vendoring is gone; there is no vendored mode to be compatible with |

Phase 4's argument — that framework code on every project branch makes the CLI's release cadence a
project concern — is the reasoning the current layout still rests on, and is recorded in
`docs/adr/ADR-0001-simplify-developer-experience.md` and `docs/un-vendor-migration.md`. A full
rewrite of the adopter-facing install story is framework#181.
