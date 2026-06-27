#!/usr/bin/env bats
# CLI-surface snapshot gate: `prj help --detail` is the canonical command/option
# surface. Any new command or option changes it → this fails → you must update
# the golden (tests/bats/update-golden.sh) and add/adjust the command's test.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; }
teardown() { sandbox_down; }

@test "help --detail matches the golden surface snapshot" {
  local golden actual
  golden=$(cat "${BATS_TEST_DIRNAME}/golden/help-detail.txt")
  actual=$(ADF_WORKSPACE="$ADF_WORKSPACE" bash "$PRJ_BIN" help --detail | sed -E 's/\x1b\[[0-9;]*m//g')
  if [ "$golden" != "$actual" ]; then
    echo "--- golden (tests/bats/golden/help-detail.txt) ---"; echo "$golden"
    echo "--- actual (prj help --detail) ---"; echo "$actual"
    echo "If this change is intentional, run tests/bats/update-golden.sh."
    return 1
  fi
}

@test "help: groups mirror the 7 menu categories" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' help --detail | sed -E 's/\x1b\[[0-9;]*m//g'"
  for g in "(1) Status" "(2) Work" "(3) Catalog" "(4) Data" "(5) Deploy" "(6) Admin" "(7) Help"; do
    assert_output --partial "$g"
  done
}

# #108 item 4 — every command has CLI-style per-command help (a `prj <cmd>` usage
# line), not the old generic "mostly interactive — follow the prompts" stub.
@test "help: every command gives real CLI help (no generic stub)" {
  local cmds=(start finish task merge pause resume sync init join add-repo cancel
              close knowledge onboard list list-all status deps upgrade validate
              config deploy seed publish catalog data iam-data creds schedules manage work)
  local c out
  for c in "${cmds[@]}"; do
    out="$(ADF_WORKSPACE="$ADF_WORKSPACE" bash "$PRJ_BIN" help "$c" 2>&1)"
    [[ "$out" == *"prj $c"* ]] || { echo "help '$c' missing usage line 'prj $c':"; echo "$out"; return 1; }
    [[ "$out" != *"mostly interactive — follow the prompts"* ]] \
      || { echo "help '$c' is still the generic stub"; return 1; }
  done
}

@test "help: previously-stubbed commands now carry examples" {
  local c out
  for c in start task merge status upgrade knowledge validate; do
    out="$(ADF_WORKSPACE="$ADF_WORKSPACE" bash "$PRJ_BIN" help "$c" 2>&1)"
    [[ "$out" == *"Examples:"* ]] || { echo "help '$c' has no Examples:"; echo "$out"; return 1; }
  done
}

@test "help: an unknown command errors with guidance" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' help no-such-cmd 2>&1"
  assert_failure
  assert_output --partial "Unknown command"
}
