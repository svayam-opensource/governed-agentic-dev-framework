#!/usr/bin/env bats
# P3 coverage — `prj list`: GitHub-derived ongoing boards; none stubbed -> empty render.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "list: renders the ongoing-projects view (empty when no boards)" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' list </dev/null"
  assert_success
  assert_output --partial "Ongoing Projects"
  assert_output --partial "No ongoing projects"
}
