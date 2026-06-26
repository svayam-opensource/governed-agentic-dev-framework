#!/usr/bin/env bats
load helpers
setup()    { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }
@test "deploy: no target shows usage" {
  run bash "$PRJ_BIN" deploy
  assert_failure
  assert_output --partial "deploy"
}
@test "deploy: a target without an environment is rejected" {
  run bash "$PRJ_BIN" deploy somesvc
  assert_failure
  assert_output --partial "environment"
}
