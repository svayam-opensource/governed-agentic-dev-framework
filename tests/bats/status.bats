#!/usr/bin/env bats
# P3 coverage + #102.1 — `prj status` asks for the GitHub project NUMBER directly
# (no slow full-board listing) and summarises that board. Hermetic (stub gh + sandbox).
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "status: rejects a non-numeric project number (#102.1)" {
  run bash -c "printf '%b' 'abc\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' status"
  assert_failure
  assert_output --partial "Project Status"
  assert_output --partial "must be numeric"
}

@test "status: asks for the project number and summarises that board (#102.1)" {
  run bash -c "printf '%b' '43\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' status"
  assert_success
  assert_output --partial "Project Status"
  assert_output --partial "projects/43"
}
