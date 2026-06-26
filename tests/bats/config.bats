#!/usr/bin/env bats
load helpers
setup()    { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }
@test "config: unknown action errors" {
  run bash "$PRJ_BIN" config bogus
  assert_failure
  assert_output --partial "config"
}
@test "config: no action shows config help" {
  run bash "$PRJ_BIN" config
  assert_output --partial "config"
}
