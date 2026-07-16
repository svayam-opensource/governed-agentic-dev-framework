#!/usr/bin/env bats
# P3 coverage — `prj onboard`: dispatches, collects repo facts, and aborts at
# the confirm step (answer 'n'). Hermetic.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "onboard: dispatches and aborts at confirmation" {
  run bash -c "printf '%b' 'https://x/r\none-liner\nteam\nn\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' onboard"
  assert_failure
  assert_output --partial "Onboard Repository"
  assert_output --partial "Aborted"
}
