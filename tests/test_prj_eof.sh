#!/usr/bin/env bash
# Verify prj's interactive helpers (ask, ask_choice, confirm) handle stdin EOF
# gracefully — exit 1 with "Aborted (no input)" rather than silent exit 0.

TEST_NAME="prj_eof"
source "$(dirname "$0")/lib.sh"

cd "$REPO_ROOT" || { t_fail "Cannot cd to REPO_ROOT"; exit 1; }

# 1. prj init with empty stdin should exit 1 (not 0)
out=$(printf '' | ./prj init 2>&1)
exit_code=$?
assert_exit_code 1 "$exit_code" "prj init with EOF on first prompt"
assert_contains "Aborted" "$out" "abort message printed"

# 2. prj init with template-default github_org but stdin closed at confirm:
#    accept default GH owner via Enter, then EOF on next prompt — should exit 1
out=$(printf '\n' | ./prj init 2>&1)
exit_code=$?
# May exit 1 either at the GH owner prompt (if no projects fetched) or later
# Either way, exit code must NOT be 0 unless real interaction happened
if [[ "$exit_code" -eq 0 ]]; then
  t_fail "prj init exited 0 on partial stdin — should fail closed"
else
  t_pass "prj init exits non-zero on partial stdin (got $exit_code)"
fi
