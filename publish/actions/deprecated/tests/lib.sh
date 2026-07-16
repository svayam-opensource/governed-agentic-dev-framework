#!/usr/bin/env bash
# Shared helpers for tests/*.sh.
#
# Source from each test:
#   source "$(dirname "$0")/lib.sh"
#
# Each test file should:
#   - source this lib
#   - set TEST_NAME at the top
#   - run its assertions
#   - call test_summary at the end (auto-handled if you use assert_*)

set -uo pipefail   # NOT -e — assertions handle their own errors

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REPO_ROOT

TEST_NAME="${TEST_NAME:-$(basename "${BASH_SOURCE[1]:-unknown}" .sh)}"

# Counters
T_PASS=0
T_FAIL=0
T_FAILED_NAMES=()

# Output
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; DIM='\033[2m'; NC='\033[0m'

t_pass() { echo -e "  ${GREEN}✓${NC} $*"; T_PASS=$((T_PASS+1)); }
t_fail() { echo -e "  ${RED}✗${NC} $*"; T_FAIL=$((T_FAIL+1)); T_FAILED_NAMES+=("$*"); }
t_skip() { echo -e "  ${YELLOW}∼${NC} $*  ${DIM}(skipped)${NC}"; }
t_info() { echo -e "  ${CYAN}→${NC} $*"; }

# Portable SHA-1 of file(s). macOS ships `shasum`; Linux/Git-Bash ship `sha1sum`.
# Same SHA-1 and `<hash>  <name>` output, so before/after comparisons match.
sha() { if command -v shasum >/dev/null 2>&1; then shasum "$@"; else sha1sum "$@"; fi; }

# assert_eq <expected> <actual> <description>
assert_eq() {
  local expected="$1" actual="$2" desc="${3:-equality}"
  if [[ "$expected" == "$actual" ]]; then
    t_pass "$desc"
  else
    t_fail "$desc — expected '$expected', got '$actual'"
  fi
}

# assert_ne <not-expected> <actual> <description>
assert_ne() {
  local notexpected="$1" actual="$2" desc="${3:-inequality}"
  if [[ "$notexpected" != "$actual" ]]; then
    t_pass "$desc"
  else
    t_fail "$desc — value was unexpectedly '$actual'"
  fi
}

# assert_contains <needle> <haystack> <description>
assert_contains() {
  local needle="$1" haystack="$2" desc="${3:-contains}"
  if [[ "$haystack" == *"$needle"* ]]; then
    t_pass "$desc"
  else
    t_fail "$desc — '$needle' not found in: $(printf '%.120s' "$haystack")"
  fi
}

# assert_not_contains <needle> <haystack> <description>
assert_not_contains() {
  local needle="$1" haystack="$2" desc="${3:-does not contain}"
  if [[ "$haystack" != *"$needle"* ]]; then
    t_pass "$desc"
  else
    t_fail "$desc — '$needle' was found in: $(printf '%.120s' "$haystack")"
  fi
}

# assert_exit_code <expected> <actual> <description>
assert_exit_code() {
  local expected="$1" actual="$2" desc="${3:-exit code}"
  if [[ "$expected" -eq "$actual" ]]; then
    t_pass "$desc — exit $actual"
  else
    t_fail "$desc — expected exit $expected, got $actual"
  fi
}

# Print final summary AND set the script's exit code. trap-on-EXIT's `return`
# does NOT influence the script's exit code — the script exits with $? as it
# was when the trap fired. So we use `exit` here to set the code explicitly.
test_summary() {
  echo ""
  if [[ "$T_FAIL" -eq 0 ]]; then
    echo -e "${GREEN}[$TEST_NAME] PASS${NC}  ($T_PASS checks)"
    exit 0
  else
    echo -e "${RED}[$TEST_NAME] FAIL${NC}  ($T_FAIL of $((T_PASS+T_FAIL)) checks failed)"
    for f in "${T_FAILED_NAMES[@]:-}"; do
      [[ -n "$f" ]] && echo -e "    ${RED}-${NC} $f"
    done
    exit 1
  fi
}

# Run summary on exit (trap calls exit with the right code)
trap test_summary EXIT
