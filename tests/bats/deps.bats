#!/usr/bin/env bats
# The `deps` command = scripts/install-deps.sh (env prep). Tested against the
# prepared environment (CI runs it as the prep step; here we re-verify).
load helpers
@test "deps: --check passes in a prepared environment" {
  run bash "$REPO_SRC/scripts/install-deps.sh" --check
  assert_success
}
@test "deps: --check reports the required tools" {
  run bash "$REPO_SRC/scripts/install-deps.sh" --check
  assert_output --partial "git"
  assert_output --partial "python3"
  assert_output --partial "gh"
}
