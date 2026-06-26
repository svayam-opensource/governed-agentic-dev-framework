#!/usr/bin/env bats
# P3 coverage — `prj validate`: dispatches and runs the data-workspace validator
# against $WORKSPACE_ROOT. Asserts the command routes (header); the validator's
# verdict on a minimal workspace is environment-dependent so isn't asserted here.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "validate: dispatches to the workspace validator" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' validate </dev/null"
  assert_output --partial "Validate Workspace"
}
