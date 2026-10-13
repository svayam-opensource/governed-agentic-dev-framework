> **Who this is for:** anyone installing or running `gov` who wants to know what differs between macOS, Linux and Windows.

# Operating systems — macOS / Linux / Windows

`gov` runs natively on all three. Each OS has one door; every door ends in the same
first-run flow (git and `gh` checked, GitHub sign-in, then adopt / join / not sure).
Start at [gov.svayamtech.com](https://gov.svayamtech.com).

| | Door | What it installs |
|---|---|---|
| macOS, Linux | `curl -fsSL https://gov.svayamtech.com/install.sh -o install.sh && bash install.sh` | a private Node 24 under `~/.local/share/gov`, `gov` in `~/.local/bin` |
| Windows | `winget install Svayam.Gov`, or the signed `.msi` from the [release page](https://github.com/svayam-opensource/governed-agentic-dev-framework/releases) | a per-user program with its own Node 24, `gov` on your PATH |

`gov` brings its own Node and does not touch one you already have. It needs `git` and
the GitHub CLI (`gh`); the first-run flow installs either if it is missing, after asking.
Nothing else — no Python, and no `bash` on Windows.

## Windows

The Windows door goes live with the **first signed release**: until then `winget` does
not find `Svayam.Gov` and the release page has no `.msi`, so there is no Windows door yet.
(`install.ps1` is a machine path for CI and Server Core, not a door for people.)

- **The MSI** installs for you alone, under `%LOCALAPPDATA%\Programs\gov` — no
  administrator rights, no UAC prompt. It puts one folder (`bin\`) on your user PATH,
  and its finish page offers **Launch gov**, which starts the first-run flow.
- **winget** installs the same signed MSI: `winget install Svayam.Gov`. Update with
  `winget upgrade Svayam.Gov`; uninstall from Settings → Apps or `winget uninstall Svayam.Gov`.
  Uninstalling removes the program and its PATH entry and keeps your `~/.gov`.
- Run `gov` from **PowerShell, Windows Terminal or `cmd`**. No WSL and no
  bash is needed.
- `git` and `gh` are installed per-user through winget if missing, when you agree.
- **Long paths:** project worktrees nest under `~/.gov/…/<PROJECT_ID>/<repo>/…`; turn on
  `git config --global core.longpaths true` so a long project slug cannot hit the
  260-character `MAX_PATH` limit.
- `~` is `C:\Users\<you>`, so `~/.gov` is `C:\Users\<you>\.gov`.

## Windows: installing gov
`winget install Svayam.Gov`, then run `gov` in a new terminal. It is a per-user MSI with its own Node, and it
needs no administrator rights. See `docs/installing.md` for the details, and for the release-page fallback while
winget's review is pending.

## Windows: how gov runs other programs and installs agents
gov runs `git`, `gh`, `npm` and your agent for you. On Windows most of these are
`.cmd` files rather than programs, so gov looks each one up the way Windows does
(every folder on `PATH`, with each extension in `PATHEXT`) and runs a `.cmd`
through `cmd.exe`. If a command is not there, gov names it and lists the folders
it looked in.

`gov agent install` on Windows:
- npm agents (Claude Code, Codex, Gemini CLI, Copilot CLI, …) install as on any
  other OS.
- Python agents (Aider) install with `python -m pip`, or `py -m pip` when only
  the Python launcher is present.
- Agents whose vendor installer is a shell script (`curl … | bash` — Cursor CLI,
  IBM Bob) are not installed on Windows. gov prints the vendor's page instead;
  install from there and run `gov agent` again.

After an install, gov writes a small `<agent>.cmd` into its own `bin` folder (the
one folder the gov installer put on your PATH) and runs it with `--version`, so
the agent still works in a new terminal after gov exits. Saved API keys are
limited to your Windows account (an owner-only ACL); gov says so if it cannot
set that. gov reads your answers from the console (`CONIN$`), and when no shell
is named it opens PowerShell 7 if present, else `cmd.exe`. To update gov itself:
`winget upgrade Svayam.Gov`.

## macOS
- **Do not keep `~/.gov` or your project worktrees inside an iCloud-synced folder**
  (`~/Documents`, `~/Desktop`). iCloud makes ` 2`/` 3` conflict copies and, with git
  worktrees, risks corrupting the shared object store.
- `install.sh` runs under the system `/bin/bash` 3.2; a newer bash is not needed.

## Linux
- `install.sh` needs only `curl` and `tar`. If `~/.local/bin` is not on your PATH, the
  installer appends one marked line to your shell profile and names the file.

## Storage model (all OSes)
Each repo is cloned once and every per-project workspace is a **git worktree** of that
clone (shared object store, one fetch, far less disk). This behaves the same on all
three platforms; the only OS-specific caveat is Windows `MAX_PATH` (see above).
