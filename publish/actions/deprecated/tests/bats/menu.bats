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

# Regression: #75 dropped menu_status/menu_admin but left the dispatch calling them, so
# choosing 1 or 3 hit "command not found" and (under set -euo pipefail) exited silently.
@test "menu: Status (option 1) reaches its submenu - menu_status is defined" {
  run bash -c "printf '1\n0\n0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  assert_success
  assert_output --partial "ongoing projects"
  refute_output --partial "command not found"
}

@test "menu: Admin (option 3) reaches its submenu - menu_admin is defined" {
  run bash -c "printf '3\n0\n0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  assert_success
  assert_output --partial "project access"
  refute_output --partial "command not found"
}

# Regression (Windows CRLF): Python print() emits \r\n, so the last read field kept a \r,
# making the board number "45\r" → display artifact + gh failure + silent exit. The
# _pick_open_project loop must strip it. (Windows-only at runtime; source-guard here.)
@test "menu: _pick_open_project strips the trailing CR from the board number" {
  run grep -nE 'IFS=\$.\\t. read -r t n;.*n="\$\{n%\$.\\r.\}"' "$PRJ_BIN"
  assert_success
}
