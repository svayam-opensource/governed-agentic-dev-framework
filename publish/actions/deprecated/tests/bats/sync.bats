#!/usr/bin/env bats
# P3 coverage — `prj sync`: routes to its handler, then the GitHub-derived project
# picker finds no boards (stubbed) and aborts non-zero. Hermetic (stub gh + sandbox).
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "sync: dispatches to its handler and aborts cleanly when no projects exist" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' sync </dev/null"
  assert_failure
  assert_output --partial "Sync Project"
}
