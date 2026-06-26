#!/usr/bin/env bats
# P3 coverage — `prj work`: dispatches to the project-first front door; the
# board picker finds no GitHub Projects (stubbed) and aborts non-zero. Hermetic.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "work: dispatches and aborts when no GitHub Projects exist" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' work </dev/null"
  assert_failure
  assert_output --partial "No open GitHub Projects"
}
