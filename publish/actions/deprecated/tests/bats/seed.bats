#!/usr/bin/env bats
# P3 coverage — `prj seed` (catalog data-seed hook): resolves the LOCAL (WIP
# project) workspace; from a neutral dir with no project it aborts with guidance.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "seed: aborts with guidance when not inside a project workspace" {
  cd "$TEST_TMP"
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' seed </dev/null"
  assert_failure
  assert_output --partial "not inside a project"
}
