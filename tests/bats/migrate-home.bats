#!/usr/bin/env bats
load helpers
setup()    { sandbox_up; stub_gh_authed; }
teardown() { sandbox_down; }
@test "migrate-home: idempotent no-op when already at the canonical home" {
  make_gov_repo "$TEST_TMP/gov"
  printf 'gov_workspace: "%s"\n' "$TEST_TMP/gov" >> "$TEST_TMP/gov/org-config.yaml"
  export ADF_WORKSPACE="$TEST_TMP/gov"
  run bash "$PRJ_BIN" migrate-home --yes
  assert_success
  assert_output --partial "already"
}
@test "migrate-home: refuses a non-canonical per-project workspace (no migration)" {
  local pp="$AGENT_WORK_ROOT/PRJ-9-x/wsrepo"; make_gov_repo "$pp"
  export ADF_WORKSPACE="$pp"
  run bash "$PRJ_BIN" migrate-home --yes
  assert_failure
  refute_output --partial "Migration complete"
}
