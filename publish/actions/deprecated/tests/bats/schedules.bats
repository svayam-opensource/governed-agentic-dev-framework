#!/usr/bin/env bats
# P3 coverage — `prj schedules`: routes to schedules.sh; no subcommand prints usage.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "schedules: no subcommand prints usage and exits non-zero" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' schedules </dev/null"
  assert_failure
  assert_output --partial "Usage: schedules.sh"
}
