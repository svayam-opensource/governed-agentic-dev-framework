#!/usr/bin/env bats
# P3 coverage — `prj manage` goes STRAIGHT to owner/assignee management (0.10.0: the
# redundant list/list-all/manage submenu was removed — list/list-all live under Status).
# Hermetic (stub gh + sandbox).
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "manage: goes straight to owner/assignee management (no redundant submenu)" {
  run bash -c "printf '%b' '0\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' manage"
  assert_output --partial "Manage Assignment"   # the real management surface (project picker)
  refute_output --partial "list-all"            # the removed submenu's option — must be gone
}
