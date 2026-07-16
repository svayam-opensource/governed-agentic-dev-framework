#!/usr/bin/env bats
# Exercises the add-repo engine's argument contract.
load helpers
setup()    { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }
@test "add-repo: missing arguments shows usage" {
  run bash "$REPO_SRC/scripts/add-repo.sh"
  assert_failure
  assert_output --partial "Usage"
}
@test "add-repo: an invalid role is rejected" {
  run bash "$REPO_SRC/scripts/add-repo.sh" PRJ-9-x https://github.com/o/r bogus reason
  assert_failure
  assert_output --partial "role"
}
