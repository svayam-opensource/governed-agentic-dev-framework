#!/usr/bin/env bats
# P3 coverage — `prj init`: dispatches, asks for the owner, finds no GitHub
# Projects (stubbed) and reports it. Hermetic.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "init: dispatches and reports when no GitHub Projects exist" {
  run bash -c "printf '%b' '\n n\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' init"
  assert_output --partial "Initialize New Project"
  assert_output --partial "No open GitHub Projects found"
}
