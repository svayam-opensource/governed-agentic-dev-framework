#!/usr/bin/env bats
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; }
teardown() { sandbox_down; }

@test "version: prints 'prj <semver>'" {
  run bash "$PRJ_BIN" version
  assert_success
  assert_output --regexp '^prj [0-9]+\.[0-9]+\.[0-9]+'
}

@test "version: --version and -v are aliases" {
  run bash "$PRJ_BIN" --version; assert_success; assert_output --regexp '^prj [0-9]+'
  run bash "$PRJ_BIN" -v;        assert_success; assert_output --regexp '^prj [0-9]+'
}
