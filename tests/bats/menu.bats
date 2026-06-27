#!/usr/bin/env bats
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; }
teardown() { sandbox_down; }

@test "menu: shows the lifecycle categories + a CLI hint, exits on 0" {
  run bash -c "printf '0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  assert_success
  assert_output --partial "(1) Status"
  assert_output --partial "(2) Work"
  assert_output --partial "(3) Admin"
  assert_output --partial "(4) Help"
  # catalog/deploy/data are CLI-only now — surfaced as a hint, not menu options
  assert_output --partial "prj catalog"
  assert_output --partial "command-line"
  assert_output --partial "Bye."
}

@test "menu: catalog/deploy/data are NOT interactive menu options" {
  run bash -c "printf '0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  refute_output --partial "(3) Catalog"
  refute_output --partial "(4) Data"
  refute_output --partial "(5) Deploy"
}

@test "menu: unknown option is rejected, not dispatched" {
  run bash -c "printf '99\n0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  assert_output --partial "Unknown option"
}

@test "menu: Help -> full reference shows grouped commands (issue #102 item 4)" {
  run bash -c "printf '4\n1\n\n0\n0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  assert_success
  assert_output --partial "(2) Work"
  assert_output --partial "(5) Deploy"
}
