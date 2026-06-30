# Testing guide — the prj test bed

For any agent (or human) **adding tests or changing `prj`**. It exists because real bugs
shipped that the suite *should* have caught. Each principle below is backed by an actual
escape, so treat them as load-bearing, not style.

## Principles (each learned the hard way)

1. **Static checks are blind to undefined-function calls.** `bash -n` and `shellcheck`
   pass a call to a function that doesn't exist — it's a *runtime* error, not a syntax one.
   *Escape:* PR #75 removed `menu_status()`/`menu_admin()` but left the menu dispatch calling
   them; CI was green; menu options 1 & 3 crashed with `command not found` and exited silently
   under `set -euo pipefail`.
   *Guard:* `prj-lint.bats` — **dispatch integrity**: every `cmd_*`/`menu_*` referenced in
   `prj` must be defined.

2. **Exercise every dispatch branch, not just the display.** A menu / `case` that lists N
   options needs each option *driven* to its handler — an untested branch is exactly where
   broken dispatch hides. *Escape:* `menu.bats` tested the display + option 4, never options
   1 or 3. *Guard:* drive each option (`menu.bats` now runs 1 & 3 + `refute "command not found"`).

3. **Platform/interactive/external-data bugs need STATIC source lints, not runtime repros.**
   If a bug only manifests on a platform you don't run hermetically (Windows), in an
   interactive flow, or against live external data, you **cannot** rely on a behavior test to
   catch it — encode the invariant as a source lint that runs on *every* platform.
   *Escape:* Python `print()` emits CRLF on Windows, so `read` of python output kept a `\r`
   → board number `"45\r"` → `gh` failure → silent exit. Linux/macOS CI can't reproduce it;
   the picker isn't hermetic on Windows CI. *Guard:* `prj-lint.bats` — **CRLF read safety**:
   every python-piped `read` must strip `\r`.

4. **Fix the CLASS, not the instance.** When you find a bug, `grep` for every sibling of the
   pattern before declaring it fixed. *Escape:* the CRLF bug was reported in ONE picker; it was
   actually in **four** reads across two functions. A lint that enforces the invariant
   everywhere is the real fix.

5. **E2E covers the *workflow*, not every *surface*.** The governance E2E drives subcommands
   (`prj task/merge/close`); the **interactive menu is a separate surface it never touches**.
   Every surface (menu, each subcommand, the pickers) needs its own coverage.

## Checklist — adding a feature, or doing a refactor

- [ ] Every interactive menu / `case` option is driven by a test to its handler (+ `refute "command not found"`).
- [ ] Removing a function? The **dispatch-integrity lint** confirms no dangling references remain.
- [ ] Any `read` over `python3`/`gh` output **strips `\r`** (`${v%$'\r'}`) — the **CRLF lint** enforces it.
- [ ] Paths embedded *inside* a `python3 -c "…"` string use `pp()` (Windows MSYS won't translate them — see `helpers.bash`).
- [ ] `@test` names are **ASCII** (`crlf.bats`; Windows `bats` mangles non-ASCII names — em-dashes/arrows bite repeatedly).
- [ ] New `cmd_*`/`menu_*` is reachable + tested, not just defined.

## The lints (`prj-lint.bats`) — keep them green, extend them

- **dispatch integrity** — every `cmd_*`/`menu_*` referenced is defined (catches the bug-1 class).
- **CRLF read safety** — every python-piped `read` strips `\r` (catches the bug-2 class).

Both run on **all platforms** and were **verified to flag the 0.9.3 bugs on the pre-fix source**.
When you add a new *class* of invariant (a "this must always be true of `prj`" rule), add a
lint here rather than hoping a behavior test happens to exercise it.

## Protocol when you find a bug

1. Write the **failing test or lint first** (red), then fix (green).
2. `grep` for **sibling instances** of the same pattern — fix the whole class.
3. If the class **can't be reproduced in CI** (platform / interactive / external), add a
   **static lint** that holds on every platform. That, not the one-line fix, is what closes
   the gap.
