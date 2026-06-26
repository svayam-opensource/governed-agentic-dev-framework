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
  TEST_TMP="$(mktemp -d)"; export TEST_TMP
  export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
  export XDG_CONFIG_HOME="$HOME/.config"
  export AGENT_WORK_ROOT="$TEST_TMP/work"; mkdir -p "$AGENT_WORK_ROOT"
  unset ADF_WORKSPACE
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
