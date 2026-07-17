#!/usr/bin/env bats
# P3 coverage — `prj list-all`: every board incl. closed; none stubbed -> empty render.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "list-all: renders the all-projects view (newest first)" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' list-all </dev/null"
  assert_success
  assert_output --partial "All Projects"
}
