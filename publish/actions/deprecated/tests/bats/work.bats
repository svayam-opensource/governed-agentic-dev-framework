#!/usr/bin/env bats
# P3 coverage + #102.2 — `prj work` lists only the projects ASSIGNED to you (not
# the full board universe). With none assigned it points you at Admin → manage and
# steps back cleanly. Hermetic (stub gh + sandbox).
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "work: shows only assigned projects; none -> guidance + back (#102.2)" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' work </dev/null"
  assert_success
  assert_output --partial "No active projects assigned to you"
  # 0.10.0 footer: only-yours + how to get access (replaces the old 'Admin -> manage' line)
  assert_output --partial "List only includes projects you are either owner and/or have access to it"
  assert_output --partial "contact an admin"
}
