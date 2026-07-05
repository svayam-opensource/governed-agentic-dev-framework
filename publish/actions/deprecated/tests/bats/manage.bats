#!/usr/bin/env bats
# P3 coverage — `prj manage`: dispatches and offers its first choice; choosing
# 'back' (0) returns cleanly. Hermetic (stub gh + sandbox).
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "manage: dispatches and steps back cleanly" {
  run bash -c "printf '%b' '0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' manage"
  assert_success
  assert_output --partial "Manage Assignments"
}
