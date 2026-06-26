#!/usr/bin/env bats
load helpers
setup()    { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }
@test "data: no args shows usage" {
  run bash "$PRJ_BIN" data
  assert_failure
  assert_output --partial "data"
}
@test "data: --list without an env is rejected" {
  run bash "$PRJ_BIN" data --list
  assert_failure
  assert_output --partial "env"
}
