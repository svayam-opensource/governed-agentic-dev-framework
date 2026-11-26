> **Who this is for:** anyone putting `gov` on a machine for the first time — adopting the framework for an organization, or joining one that has.

# Installing `gov`

Start with the install page in the **[gov portal](https://portal.svayamtech.com/install)**. Sign in, or
register your organisation, to see it. [gov.svayamtech.com](https://gov.svayamtech.com) takes you there.
The page shows the commands for your OS and the versions on offer.

You don't need an account to install. The commands below work without signing in, as do npm and winget.
There is one door per OS, and every door ends in the same first-run flow.

| OS | Door |
|---|---|
| macOS, Linux | `curl -fsSL https://gov.svayamtech.com/install.sh -o install.sh && bash install.sh` |
| Windows | In PowerShell: `irm https://gov.svayamtech.com/install.ps1 \| iex` (until winget is live, [below](#windows)) |

**winget is coming.** `winget install Svayam.Gov` becomes the Windows door with the first release of the
Windows installer; until then winget does not find `Svayam.Gov`, and `install.ps1` is the way in.

## Upgrading

One command brings **gov and your organization's governance repository** to the release the site serves:

| OS | Command |
|---|---|
| macOS, Linux | `curl -fsSL https://gov.svayamtech.com/upgrade.sh -o upgrade.sh && bash upgrade.sh` |
| Windows (PowerShell) | `irm https://gov.svayamtech.com/upgrade.ps1 \| iex` |

1. **gov itself:** it runs the site's own installer, which updates gov to the pinned version and asks before it
   installs anything. No first-run menu.
2. **Your governance repository:** `gov upgrade` shows what the release changes; if you agree, `gov upgrade --pr`
   opens a pull request for you to review. Nothing is merged for you.

Run it from anywhere. If gov finds no governance repository from there, gov is still upgraded and it tells you to
run `gov upgrade --pr` from your governance repository. `GOV_YES=1` answers yes for scripts;
`GOV_UPGRADE_NO_PR=1` stops before the pull request.

From gov 2 on, `gov self-update` updates gov itself in place, with no script; run `gov upgrade --pr` afterwards
for the repository.

## Then: the first-run flow

When the install finishes, `gov` starts the first-run flow (on Windows, from the installer's
**Launch gov** button, or by typing `gov`):

1. It checks `git` and `gh`, installs what is missing if you agree, and asks you to sign in to
   GitHub. Re-running resumes; it never repeats a finished step.
2. It asks whether you are **adopting** the framework, **joining** an organization that has it,
   or **not sure**.
3. Adopt asks three questions: your GitHub organization, a 2-6 letter identifier for it, and which AI agents
   it allows (a default, then any others). In a terminal you pick the agents with the arrow keys, Space and
   Enter; without one they are numbered (`GOV_PLAIN_PROMPTS=1` asks for numbers anyway). Everything else
   takes a default: the organization's names are its display name on GitHub, the governance repo is
   `gov_repo`, the branches are `main` and `dev`, you are the Policy Owner, nobody else is named yet, no
   contact email is written, and governance is **soft**. gov prints every value, asked or not, before it
   creates anything; each one can be changed later by a pull request to `org-config.yaml` or
   `policies/governance.yaml`. If your organization already has a repository called `gov_repo` that is not a
   governance repo, gov stops, creates nothing, and says how to go on.
   Adopt then creates and seeds your governance repo; join finds it on GitHub and clones it. A new governance
   repo has the approval check and the rules' checks from its very first commit, so every pull request in it
   shows whether someone other than its author has approved it. If your organization later switches to
   **hard** governance, the default branch is protected, so GitHub blocks a merge until that approval arrives.
   On a plan that cannot protect the repo (a private repo on GitHub Free), gov says so and lists the ways
   forward.
4. If you adopted, it makes your practice project, **Make the policy ours**, without asking. It is a real
   project: a board, its anchor issue, a project branch, and one task. The task is to put your organization's
   name on the policy's title page. The pull request for that change shows a check waiting for someone other
   than you to approve it. The title page is the Policy Owner's, and you are the Policy Owner and its author,
   so the check waits for the Check Owner. That wait is the point: nobody approves their own work. Setup names
   nobody else, so the practice task asks you to invite a teammate and name them Check Owner
   (`check_owner.github` in `policies/governance.yaml`, in a pull request of its own). Under soft governance,
   or where GitHub cannot protect the repo, nothing technically stops a merge past the check, but the red check
   is there for everyone to see. Don't merge it yourself. Hard governance needs that second person. People who join get no practice project; their first project is
   one they are assigned to.
5. It installs an approved AI agent, if you agree, and helps you sign it in.
6. It opens a first project and launches the agent, which posts its context manifest.

### The set-up code and the set-up trail

When you're signed in, the Install page shows the command with a **one-time set-up code** in front of it:

```bash
GOV_SETUP_CODE=<code> GOV_SETUP_ISSUER=<address> bash install.sh
```

On Windows the page gives `$env:GOV_SETUP_CODE='<code>'; $env:GOV_SETUP_ISSUER='<address>'; irm …/install.ps1 | iex`.

The code lets gov tell gov web, once, that your set-up is done. That completes the second step of
**My Gov Journey**. The installer passes the code to gov and never prints it.

gov records your set-up in `~/.gov/setup-state.json`. Only you can read the file. It lists each step as done
or pending, with the time:

| Step | Done when |
|---|---|
| `client-installed` | gov is installed |
| `prerequisites` | `git` and `gh` are installed |
| `governance-repo` | your governance repository is in place: created when you adopt, cloned when you join |
| `machine-env` | the workspace folders (`~/.gov/<slug>/projects`) exist and the tools are ready |
| `setup-signal` | gov web has been told your set-up is done |

- **Re-running `gov` resumes** at the first step still pending. gov checks every step against the machine each
  time, so the file never claims something that is no longer true.
- **The code is sent once** `client-installed`, `governance-repo` and `machine-env` are all done. gov then
  removes the code from the file and prints *Your gov web set-up step is complete.*
- **gov only sends the code to `https://*.svayamtech.com`.** If the command names any other address, gov
  doesn't send the code.
- **If gov web refuses the code, or can't be reached,** gov says so in one line and carries on. Set-up is not
  affected.
  - A refused code has expired, was already used, or was replaced by a newer one. Get a new code from the
    Install page and run `gov` again.
  - After too many attempts from your network, wait a few minutes and run `gov` again.
  - Sending a code twice does no harm.
- **`gov doctor` shows the trail** in its `set-up` row: each step done or pending, and whether a set-up signal
  is still waiting. It never shows the code.

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

**Today (until winget is live): `install.ps1`.** Open **PowerShell** (Start → PowerShell — not as
administrator) and run:

```powershell
irm https://gov.svayamtech.com/install.ps1 | iex
```

From Command Prompt (`cmd.exe`) instead:

```bat
powershell -NoProfile -Command "irm https://gov.svayamtech.com/install.ps1 | iex"
```

- `irm` (`Invoke-RestMethod`) and `iex` (`Invoke-Expression`) are built into PowerShell 5.1 and 7 — there is
  nothing to install first. They do not exist in Command Prompt, hence the second form. `irm … | iex` runs the
  script in memory, so the execution policy does not block it.
- It installs for you alone: its own Node under `%LOCALAPPDATA%\gov\node`, gov on your user PATH. Nothing
  machine-wide, nothing elevated. Then it shows each remaining step (`gov doctor --fix`) and asks before it runs it.
- When it finishes, open a **new** PowerShell window (the old one does not see the new PATH) and run `gov`. The
  first run takes you through setup.
- Older Windows PowerShell 5.1 may say it *could not create SSL/TLS secure channel*. Run
  `[Net.ServicePointManager]::SecurityProtocol = 'Tls12'` in the same window first, then the command again.
- A version: `$env:GOV_PKG = '@svayam-opensource/gov@<version>'` before the command.

**When winget is live:**

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
| Windows: run inside Git Bash | Native Windows, no Git Bash: `install.ps1` in PowerShell today, and the per-user MSI through `winget install Svayam.Gov` once it is live (above) |
| Walk up from `$PWD` for `org-config.yaml` | `~/.gov/<org-slug>/gov_repo` is the bootstrap anchor; `$ADF_WORKSPACE` is gone, replaced by a per-invocation flag so it cannot stale-misdirect |
| Data includes `registry.yaml` | There is no `registry.yaml` — GitHub is the source of truth, and the board number is the allocator |
| Nothing changes for vendored use | Vendoring is gone; there is no vendored mode to be compatible with |

Why the CLI stopped living on project branches is recorded in
`docs/adr/ADR-0001-simplify-developer-experience.md` and `docs/un-vendor-migration.md`.
