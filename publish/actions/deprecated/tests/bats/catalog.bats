#!/usr/bin/env bats
load helpers
setup()    { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }
@test "catalog: no env/subcommand shows usage" {
  run bash "$PRJ_BIN" catalog
  assert_failure
  assert_output --partial "catalog"
}
@test "catalog: an invalid env/subcommand is rejected" {
  run bash "$PRJ_BIN" catalog bogus
  assert_failure
}
