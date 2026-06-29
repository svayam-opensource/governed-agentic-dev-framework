# shellcheck shell=bash
# Common helpers for the governance test bed (BATS). Load with: load helpers
_BATS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SRC="$(cd "$_BATS_DIR/../.." && pwd)"     # framework repo root (ships prj)
PRJ_BIN="$REPO_SRC/prj"
BIN_PRJ="$REPO_SRC/bin/prj"                      # npm wrapper (does resolution)

# bats-support / bats-assert (fetched by bootstrap.sh). Each load.bash only
# sources its own src/, so source them directly (support first — assert uses it).
source "$_BATS_DIR/.libs/bats-support/load.bash"
source "$_BATS_DIR/.libs/bats-assert/load.bash"

# Hermetic sandbox: a throwaway HOME + XDG so tests never touch real machine
# state (pointer file, rc files, etc.). Call in setup(); pair with teardown.
sandbox_up() {
  # Resolve symlinks (macOS /var -> /private/var) so prefix comparisons against
  # paths the CLI resolves with `cd && pwd` are consistent.
  TEST_TMP="$(cd "$(mktemp -d)" && pwd -P)"; export TEST_TMP
  export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
  export XDG_CONFIG_HOME="$HOME/.config"
  export AGENT_WORK_ROOT="$TEST_TMP/work"; mkdir -p "$AGENT_WORK_ROOT"
  unset ADF_WORKSPACE
  # Neutral cwd: stand outside any org-config tree so prj's cwd-walk doesn't pick
  # up the framework repo itself. Gov-home resolution then comes from the pointer
  # (write_pointer) or the ADF_WORKSPACE bootstrap, exactly as in real use.
  cd "$TEST_TMP" || true
  # A git identity so require_git_identity-gated commands don't prompt/abort.
  git config --global user.email "testbot@example.com" 2>/dev/null || true
  git config --global user.name  "Test Bot" 2>/dev/null || true
  git config --global init.defaultBranch main 2>/dev/null || true
}

# Put a stub executable named $1 (body $2) at the front of PATH for this test.
# Used to make CLI tests hermetic (e.g. a fake `gh`). Cleared by sandbox_down.
stub_bin() {
  local name="$1" body="$2"
  if [[ -z "${_STUB_DIR:-}" ]]; then
    _STUB_DIR="$TEST_TMP/stub"; mkdir -p "$_STUB_DIR"; export PATH="$_STUB_DIR:$PATH"
  fi
  printf '#!/usr/bin/env bash\n%s\n' "$body" > "$_STUB_DIR/$name"
  chmod +x "$_STUB_DIR/$name"
}

# A canned `gh` stub: authenticated, login=testbot, empty project list. Extend by
# re-stubbing with a richer body in a specific test.
stub_gh_authed() {
  stub_bin gh '
case "$1 $2" in
  "auth status") exit 0 ;;
esac
case "$*" in
  *"api graphql"*)     echo "{\"data\":{}}" ;;   # valid-but-empty: nav engine + access checks parse to "nothing"
  *"api user"*)        echo "testbot" ;;
  *"project list"*)    echo "{\"projects\":[]}" ;;
  *"project item-list"*) echo "{\"items\":[]}" ;;
  *)                   exit 0 ;;
esac'
}
sandbox_down() { [[ -n "${TEST_TMP:-}" && -d "$TEST_TMP" ]] && rm -rf "$TEST_TMP"; }

# Make a minimal valid gov repo (the org-config.yaml signature) at $1.
make_gov_repo() { mkdir -p "$1"; cp "$REPO_SRC/org-config.yaml" "$1/org-config.yaml"; }

# Write the gov-home pointer file to <path>.
write_pointer() { mkdir -p "$XDG_CONFIG_HOME/prj"; printf '%s\n' "$1" > "$XDG_CONFIG_HOME/prj/gov-workspace"; }

# Resolve the workspace bin/prj would pick (no side effects), from $PWD.
resolved_workspace() { PRJ_PRINT_WORKSPACE=1 bash "$BIN_PRJ" 2>/dev/null; }

# Run the prj CLI (source build, not the installed npm package).
run_prj() { run bash "$PRJ_BIN" "$@"; }

# Native-form a path for embedding INSIDE a `python3 -c "...open('$(pp "$LOCK")')..."`
# string. On Windows Git-bash, MSYS auto-translates standalone path args/env (so the
# build's ADF_WORKSPACE resolves), but it does NOT translate a path buried inside a
# larger `-c` argument — there a `/c/...` MSYS path reaches Windows-Python literally
# and fails to open (read as C:\c\Users\...). cygpath -m yields the mixed C:/... form
# Windows-Python opens correctly. No-op on macOS/Linux (cygpath absent), so paths and
# the green platforms are untouched.
pp() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
