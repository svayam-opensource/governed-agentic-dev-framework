> **Who this is for:** anyone putting `gov` on a machine for the first time — adopting the framework for an organization, or joining one that has.

# Installing `gov`

Start at **[gov.svayamtech.com](https://gov.svayamtech.com)**. It has one door per OS, and
every door ends in the same first-run flow.

| OS | Door |
|---|---|
| macOS, Linux | `curl -fsSL https://gov.svayamtech.com/install.sh -o install.sh && bash install.sh` |
| Windows | `winget install Svayam.Gov` |

**The Windows door goes live with the first release of the installer.** Until then `winget` does not
find `Svayam.Gov`. The installer is released **unsigned until a production code-signing certificate
exists**, so use `winget`: a `.msi` downloaded directly from the [release page](https://github.com/svayam-opensource/governed-agentic-dev-framework/releases) shows "Unknown publisher" until a production code-signing certificate exists. `install.ps1` is a machine path for CI and
Server Core only, not a door for people (see `gov help install`).

## Then: the first-run flow

When the install finishes, `gov` starts the first-run flow (on Windows, from the installer's
**Launch gov** button, or by typing `gov`):

1. It checks `git` and `gh`, installs what is missing if you agree, and asks you to sign in to
   GitHub. Re-running resumes; it never repeats a finished step.
2. It asks whether you are **adopting** the framework, **joining** an organization that has it,
   or **not sure**.
3. Adopt creates and seeds your governance repo; join finds it on GitHub and clones it.
4. It installs an approved AI agent, if you agree, and helps you sign it in.
5. It opens a first project and launches the agent, which posts its context manifest.

## What `install.sh` does

It fetches its own Node under your home directory and installs `@svayam-opensource/gov` from
npm. It touches no system directory and needs no `sudo`; `curl` and `tar` are the only
prerequisites, and both are already present everywhere this can run. Testers point it at a
local build with `GOV_PKG=/path/to.tgz`.

**What it changes on your machine (#211).** Node goes under `~/.local/share/gov/node`, and a
Node you already have is left alone — still the `node` your shell finds. `gov` reaches its own
Node through a small wrapper:

- If `~/.local/bin` is already on your `PATH` (Fedora, RHEL, Rocky), the wrapper goes there and
  **no shell profile is touched**. `gov` works in the terminal you ran the installer from.
- If it is not (Debian, Ubuntu, macOS), **one marked line is appended** to the end of your shell
  profile (`~/.zshrc`, `~/.bashrc`, `~/.bash_profile` or `~/.profile`, whichever your shell
  reads), after everything already on `PATH`, and the installer names the file in one line. Open
  a new terminal, or `source` that file.

**Fetch, then run — do not `curl … | bash`.** Piped, a failed download is silent: `curl -f`
writes nothing and exits 22, `bash` reads an empty stdin and exits 0, and the pipeline reports
success. Nothing installs, and the first symptom is `gov: command not found` somewhere later,
with nothing connecting the two.

What differs per OS is in [operating-systems.md](operating-systems.md).

## Windows

```powershell
winget install Svayam.Gov
```

Then open a **new** terminal and run `gov`. The first run takes you through setup.

The package is an MSI that installs for you alone. It needs no administrator rights and changes nothing
machine-wide. It brings its own Node 24 and leaves any Node already on the machine untouched. It adds one folder
to your PATH, `%LOCALAPPDATA%\Programs\gov\bin`. The installer's last page offers to launch gov. Update with `winget upgrade Svayam.Gov`. Uninstalling from *Installed apps* removes gov and the
agents it installed, and keeps `~/.gov` (your workspaces and preferences).

- **The installer is unsigned until a production code-signing certificate exists.** winget checks the
  installer's SHA256 against its listing, so `winget install` is the way in. A `.msi` downloaded directly from the [release page](https://github.com/svayam-opensource/governed-agentic-dev-framework/releases) shows "Unknown publisher" until a production code-signing certificate exists.
  Windows SmartScreen may also warn about it. Prefer winget.
- **winget lags a release.** Microsoft reviews every winget listing, which takes hours to days. The
  `gov-<version>-x64.msi` (or `-arm64.msi`) is on the release page as soon as the release is out, if you cannot
  wait. Expect the "Unknown publisher" prompt.
- **Pre-releases (`@next`) are npm-only.** The MSI and winget carry clean releases (`x.y.z`) only; a
  pre-release is published to npm under the `next` tag and nowhere else.

---

## If you followed an old link

This page used to document the framework's old bash CLI, `prj`, vendored into each governance
repo. That model is gone, and its instructions are **removed rather than left below a
banner**: a reader who scrolled past the warning would have followed them.

| The old page said | Today |
|---|---|
| Install the bash CLI from npm | `gov` (`@svayam-opensource/gov`), installed by the door for your OS, which supplies its own Node |
| The CLI is bash; needs `yq` and `python3` | Node 24 / TypeScript; no system Node required |
| Windows: run inside Git Bash | Native Windows, no Git Bash: the per-user MSI, through `winget install Svayam.Gov` (above). `install.ps1` is kept only as a machine path (CI, Server Core) and documented in the command reference (`gov help install`) |
| Walk up from `$PWD` for `org-config.yaml` | `~/.gov/<org-slug>/gov_repo` is the bootstrap anchor; `$ADF_WORKSPACE` is gone, replaced by a per-invocation flag so it cannot stale-misdirect |
| Data includes `registry.yaml` | There is no `registry.yaml` — GitHub is the source of truth, and the board number is the allocator |
| Nothing changes for vendored use | Vendoring is gone; there is no vendored mode to be compatible with |

Why the CLI stopped living on project branches is recorded in
`docs/adr/ADR-0001-simplify-developer-experience.md` and `docs/un-vendor-migration.md`.
