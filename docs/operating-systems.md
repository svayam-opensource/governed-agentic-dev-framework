# Operating systems — macOS / Linux / Windows

The `prj` CLI and lifecycle scripts are POSIX `bash` and run on **macOS, Linux,
and Windows (via Git Bash / Git for Windows)**. Shell scripts are pinned to LF
line endings in `.gitattributes` (CRLF corrupts the shebang under bash), so a
Windows checkout stays runnable.

## Common prerequisites (all OSes)
Install and put on `PATH`: `git`, `gh` (GitHub CLI, authenticated), `python3`,
`yq`, and `bash`. `./prj deps` (or `bash scripts/install-deps.sh`) checks them.

## Windows (Git Bash)
- Run `prj` from **Git Bash**, not PowerShell/CMD. Git for Windows provides the
  `bash` runtime; install `gh`, Python 3, and `yq` into that PATH.
- **Enable long paths:** `git config --global core.longpaths true`. Per-project
  worktrees nest under `agent_work_root/PRJ-NNN-slug/<repo>/…`; long slugs can
  exceed the 260-char `MAX_PATH` limit otherwise.
- Auth: prefer **HTTPS + the gh credential helper**, or configure SSH keys —
  whichever your `repo_url`s use.
- `$HOME` resolves to `C:\Users\<you>`, so `agent_work_root: ~/.svm/projects`
  becomes `C:\Users\<you>\.svm\projects`. Keep `agent_work_root` as a portable
  `~/...` value (never a committed absolute path).

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
- **Do not keep this repo — or `agent_work_root` — inside an iCloud-synced
  folder** (`~/Documents`, `~/Desktop`). iCloud generates ` 2`/` 3` conflict
  copies and, with git worktrees, risks corrupting the shared object store.
  Use a non-synced path such as `~/code/...`.
- The system `/bin/bash` is 3.2; the scripts target it. A newer bash via
  Homebrew is optional, not required.

## Linux
- Usually ships `git`/`python3`; install `gh` and `yq`. No special notes.

## Storage model (ADR-0001 Phase 2 — all OSes)
Each repo is cloned once into `agent_work_root/.bases/<repo>`, and every
per-project workspace is a **git worktree** of that base (shared object store,
one fetch/identity, far less disk). This behaves identically across the three
platforms; the only OS-specific caveat is Windows `MAX_PATH` (see above).
