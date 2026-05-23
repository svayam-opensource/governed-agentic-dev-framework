#!/usr/bin/env bash
# Verify install-deps.sh treats yq as optional:
#   - Without yq on PATH, the script still passes Phase 1 (tools)
#   - It does NOT auto-install yq
#   - Phase 2 (org access) is skipped at template defaults

TEST_NAME="install_deps_no_yq"
source "$(dirname "$0")/lib.sh"

# Strategy: build a shim directory containing symlinks to every tool the
# script (and its subprocesses) needs EXCEPT yq, and use it as the entire
# PATH. yq won't be findable; everything else is.

SHIM=$(mktemp -d)
trap "rm -rf '$SHIM'" EXIT

# Tools install-deps.sh and the things it shells out to need. Some of these
# (date, mkdir, cat, curl, tr, sed, grep, find, awk, dirname, basename, cd,
# uname, command, etc.) are bash builtins or in /usr/bin or /bin already, so
# we'll prepend SHIM to a minimal-but-sufficient base PATH.
for t in git gh python3 pip3 bash; do
  src=$(command -v "$t" 2>/dev/null) || continue
  ln -s "$src" "$SHIM/$t"
done

# Sanity: yq should not be findable in our test PATH
TEST_PATH="$SHIM:/usr/bin:/bin:/usr/sbin:/sbin"
if PATH="$TEST_PATH" command -v yq &>/dev/null; then
  t_skip "yq still findable in test PATH (multi-install?) — skipping"
  exit 0
fi

# Sanity: required tools should be findable
for t in git gh python3 bash; do
  if ! PATH="$TEST_PATH" command -v "$t" &>/dev/null; then
    t_skip "$t not findable via shim — skipping"
    exit 0
  fi
done

out=$(PATH="$TEST_PATH" bash "$REPO_ROOT/scripts/install-deps.sh" --check 2>&1)
exit_code=$?

# Should exit 0 because yq is optional and template defaults skip Phase 2
assert_exit_code 0 "$exit_code" "install-deps --check passes without yq"

# Should not flag yq as missing-required
assert_not_contains "yq  — required" "$out" "yq not flagged as missing required"
assert_not_contains "Missing required: yq" "$out" "yq not in missing-required summary"

# Should mention yq is optional in the output
assert_contains "yq" "$out" "yq mentioned in output"
assert_contains "optional" "$out" "yq labeled as optional"
