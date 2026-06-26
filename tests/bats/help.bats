#!/usr/bin/env bats
# CLI-surface snapshot gate: `prj help --detail` is the canonical command/option
# surface. Any new command or option changes it → this fails → you must update
# the golden (tests/bats/update-golden.sh) and add/adjust the command's test.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; }
teardown() { sandbox_down; }

@test "help --detail matches the golden surface snapshot" {
  local actual="$TEST_TMP/help-detail.txt"
  ADF_WORKSPACE="$ADF_WORKSPACE" bash "$PRJ_BIN" help --detail \
    | sed -E 's/\x1b\[[0-9;]*m//g' > "$actual"
  run diff -u "${BATS_TEST_DIRNAME}/golden/help-detail.txt" "$actual"
  assert_success
}

@test "help: groups mirror the 7 menu categories" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' help --detail | sed -E 's/\x1b\[[0-9;]*m//g'"
  for g in "(1) Status" "(2) Work" "(3) Catalog" "(4) Data" "(5) Deploy" "(6) Admin" "(7) Help"; do
    assert_output --partial "$g"
  done
}
