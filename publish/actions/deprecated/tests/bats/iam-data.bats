#!/usr/bin/env bats
# iam-data is an alias for `data iam`.
load helpers
setup()    { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }
@test "iam-data: underspecified invocation is rejected (routes to data)" {
  run bash "$PRJ_BIN" iam-data
  assert_failure
}
