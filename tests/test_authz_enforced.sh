#!/usr/bin/env bash
# Regression test for #62 — uniform authorization across state-mutating scripts.
# Guards that no mutating script ships ungated, and that cancel no longer relies
# on the dead locked_by guard (C11: locked_by is never written → any user could
# cancel any project before the fix).
TEST_NAME="authz_enforced"
source "$(dirname "$0")/lib.sh"

# Every state-mutating lifecycle script must gate on GitHub-Project write access.
MUTATING="seed create-task merge-task close-project close-knowledge cancel pause resume join add-repo"
for s in $MUTATING; do
  f="$REPO_ROOT/scripts/$s.sh"
  if [[ ! -f "$f" ]]; then t_skip "$s.sh not present"; continue; fi
  if grep -q 'is_authorized_for_project' "$f"; then
    t_pass "$s.sh enforces is_authorized_for_project"
  else
    t_fail "$s.sh does NOT enforce authorization (state-mutating script is ungated)"
  fi
done

# #62/C11 specifically — cancel.sh must use the standard authz check, not the
# dead locked_by-only gate.
cf="$REPO_ROOT/scripts/cancel.sh"
if grep -q 'is_authorized_for_project' "$cf"; then
  t_pass "cancel.sh uses the standard authz gate (not the dead locked_by guard)"
else
  t_fail "cancel.sh still relies on the dead locked_by gate — any user could cancel"
fi
