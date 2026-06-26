#!/usr/bin/env bats
load helpers
setup()    { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }
@test "creds: path prints the per-user credentials file" {
  run bash "$PRJ_BIN" creds path
  assert_success
  assert_output --partial "credentials"
}
@test "creds: groups lists the jenkins group" {
  run bash "$PRJ_BIN" creds groups
  assert_success
  assert_output --partial "jenkins"
}
@test "creds: set then list shows the KEY but never the value" {
  bash "$PRJ_BIN" creds set FOO secret123 >/dev/null 2>&1
  run bash "$PRJ_BIN" creds list
  assert_success
  assert_output --partial "FOO"
  refute_output --partial "secret123"
}
