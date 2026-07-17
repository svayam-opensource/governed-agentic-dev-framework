#!/usr/bin/env bats
# P3 coverage — `prj upgrade`: dispatches, cds to the workspace, and stops
# because the 'template' remote isn't configured (sandbox workspace). Hermetic.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "upgrade: dispatches and requires a 'template' remote" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' upgrade </dev/null"
  assert_failure
  assert_output --partial "Upgrade Framework"
  assert_output --partial "template' remote not configured"
}
