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
