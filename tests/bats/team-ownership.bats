#!/usr/bin/env bats
# prj 0.10.0 — team ownership + searchable state, exercised through the list/work
# surfaces with a gh stub that returns ONE board whose anchor carries owner-team +
# state:* labels. Proves: (a) status derives from the searchable state:* label, and
# (b) 'work' includes a project you own via TEAM membership (no assignee).
# See docs/design/team-ownership-and-searchable-state.md.
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

# project_context_list invokes gh via Python subprocess; Windows Python can't exec a
# shebang-only `gh` stub (no .exe/.cmd), so a DATA-returning stub yields nothing there.
# The team + state LOGIC is covered on macOS + 4 Linux runners; skip the 3 data-driven
# cases on Windows (same limitation doctor.bats skips for).
_skip_msys() { case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) skip "python-subprocess gh stub not executable under Windows MSYS" ;; esac; }

# Re-stub gh to return one team-owned board (#7), no individual assignees, anchor
# labelled owner-team:developers + state:<STATE>. `api user/teams` → developers, so
# the current user (testbot) owns it via the team. The board JSON lives in a sibling
# file the stub cats — NO nested heredocs (which corrupt under Windows MSYS CRLF).
_gh_stub_team_board() {
  local state="$1" jf="$_STUB_DIR/board.json"
  printf '%s\n' '{"data":{"organization":{"projectsV2":{"nodes":[{"number":7,"title":"Team Owned","closed":false,"items":{"nodes":[{"content":{"__typename":"Issue","labels":{"nodes":[{"name":"anchor"},{"name":"owner-team:developers"},{"name":"state:'"$state"'"}]},"assignees":{"nodes":[]}}}]}}]}}}}' > "$jf"
  stub_bin gh '
case "$1 $2" in "auth status") exit 0 ;; esac
case "$*" in
  *"api user/teams"*) echo "developers" ;;
  *"api user"*)       echo "testbot" ;;
  *"api graphql"*)    cat "'"$jf"'" ;;
  *) exit 0 ;;
esac'
}

@test "searchable-state: list derives status from the state:* label (paused wins over board-open)" {
  _skip_msys
  _gh_stub_team_board paused
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' list </dev/null"
  assert_success
  assert_output --partial "PRJ-7"        # board rendered as a project
  assert_output --partial "paused"       # status came from state:paused, not board open/closed
}

@test "searchable-state: an active state:* label renders as active" {
  _skip_msys
  _gh_stub_team_board active
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' list </dev/null"
  assert_success
  assert_output --partial "PRJ-7"
  assert_output --partial "active"
}

@test "team-ownership: work lists a project you own via TEAM membership (no assignee)" {
  _skip_msys
  _gh_stub_team_board active
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' work </dev/null"
  # the picker prints the assigned list before reading a choice
  assert_output --partial "Select a project assigned to you"
  assert_output --partial "PRJ-7"        # included via owner-team:developers ∩ my teams
  assert_output --partial "contact an admin"   # the 0.10.0 access footer
}
