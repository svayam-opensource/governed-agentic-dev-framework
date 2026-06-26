#!/usr/bin/env bats
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; }
teardown() { sandbox_down; }

@test "menu: shows the 7 numbered categories and exits on 0" {
  run bash -c "printf '0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  assert_success
  assert_output --partial "(1) Status"
  assert_output --partial "(6) Admin"
  assert_output --partial "(7) Help"
  assert_output --partial "Bye."
}

@test "menu: unknown option is rejected, not dispatched" {
  run bash -c "printf '99\n0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  assert_output --partial "Unknown option"
}
