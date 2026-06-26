#!/usr/bin/env bats
# Regression suite for the PRJ-43 gov-home resolution bug. Fully hermetic.
load helpers

setup() {
  sandbox_up
  GOV="$TEST_TMP/gov";   make_gov_repo "$GOV"
  BASES="$AGENT_WORK_ROOT/.bases/wsrepo"; make_gov_repo "$BASES"
  PROJ="$AGENT_WORK_ROOT/PRJ-9-x/wsrepo";  make_gov_repo "$PROJ"
}
teardown() { sandbox_down; }

@test "resolves to the pointer-file home from /tmp (env unset)" {
  write_pointer "$GOV"; cd /tmp
  run resolved_workspace
  assert_success; assert_output "$GOV"
}

@test "never resolves to a .bases base clone (env unset, cwd inside .bases)" {
  write_pointer "$GOV"; cd "$BASES"
  run resolved_workspace
  assert_output "$GOV"
}

@test "rejects ADF_WORKSPACE pointing at .bases, falls back to pointer" {
  write_pointer "$GOV"; cd "$TEST_TMP"
  ADF_WORKSPACE="$BASES" run resolved_workspace
  assert_output "$GOV"
}

@test "honors a valid ADF_WORKSPACE override" {
  write_pointer "$GOV"; OTHER="$TEST_TMP/other"; make_gov_repo "$OTHER"
  ADF_WORKSPACE="$OTHER" run resolved_workspace
  assert_output "$OTHER"
}

@test "PWD-walk picks a per-project workspace when inside one (mid-project)" {
  write_pointer "$GOV"; cd "$PROJ"
  run resolved_workspace
  assert_output "$PROJ"
}

@test "hard-errors when nothing resolves (no env, no pointer, non-interactive)" {
  cd /tmp
  run bash "$BIN_PRJ" version
  assert_failure
  assert_output --partial "could not locate"
}
