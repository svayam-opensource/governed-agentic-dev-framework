#!/usr/bin/env bats
# `prj publish` — governed CLI publish via the Jenkins job (single interface).
# Hermetic: these cases never reach Jenkins (they exit at help / flag-parse /
# the irreversible-publish confirmation, all before ensure-job).
load helpers
setup()    { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; }
teardown() { sandbox_down; }

@test "publish: -h shows CLI help (usage + examples)" {
  run bash "$PRJ_BIN" publish -h
  assert_success
  assert_output --partial "prj publish"
  assert_output --partial "Examples:"
  assert_output --partial "npmjs-token"
}

@test "publish: an unknown flag is rejected (before touching Jenkins)" {
  run bash "$PRJ_BIN" publish --bogus
  assert_failure
  assert_output --partial "unknown flag"
  refute_output --partial "Queued"
}

@test "publish: a real publish without -y aborts at confirmation (no Jenkins)" {
  run bash -c "printf '\n' | bash '$PRJ_BIN' publish v9.9.9"
  assert_failure
  refute_output --partial "Queued"
  refute_output --partial "ensure-job"
}
