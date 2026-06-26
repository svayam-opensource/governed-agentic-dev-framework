#!/usr/bin/env bats
# P3 coverage — `prj start`: dispatches and offers its first choice; choosing
# 'back' (0) returns cleanly. Hermetic (stub gh + sandbox).
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "start: dispatches and steps back cleanly" {
  run bash -c "printf '%b' '0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' start"
  assert_success
  assert_output --partial "Start Work"
}
