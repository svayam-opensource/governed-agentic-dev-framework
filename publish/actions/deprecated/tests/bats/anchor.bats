#!/usr/bin/env bats
# Two-anchor handling (0.10.0). A board with MORE THAN ONE 'anchor' issue must resolve
# DETERMINISTICALLY (lowest issue # — never board order, which is unstable), and `prj doctor`
# must surface the ambiguity. See docs/design/team-ownership-and-searchable-state.md.
load helpers

# Both cases drive gh through project_context_list / a config read — un-stubbable/unreliable
# under Windows MSYS (see issue #90). Logic is covered on macOS + 4 Linux runners.
_skip_msys() { case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) skip "python-subprocess gh stub / MSYS config-inject (issue #90)" ;; esac; }

setup() { sandbox_up; GOV="$TEST_TMP/gov"; make_gov_repo "$GOV"; export ADF_WORKSPACE="$GOV"; stub_gh_authed; }
teardown() { sandbox_down; }

# Board #7 with TWO anchors: issue #5 (owner alice) and issue #3 (owner bob). Deterministic
# resolution must pick #3 (bob). Stub shape serves both project_context_list and
# boards_with_multiple_anchors (both read projectsV2 → items → Issue labels).
_gh_two_anchor_board() {
  local jf="$_STUB_DIR/board.json"
  printf '%s\n' '{"data":{"organization":{"projectsV2":{"nodes":[{"number":7,"title":"Dup","closed":false,"items":{"nodes":[{"content":{"__typename":"Issue","number":5,"labels":{"nodes":[{"name":"anchor"},{"name":"state:active"}]},"assignees":{"nodes":[{"login":"alice"}]}}},{"content":{"__typename":"Issue","number":3,"labels":{"nodes":[{"name":"anchor"},{"name":"state:active"}]},"assignees":{"nodes":[{"login":"bob"}]}}}]}}]}}}}' > "$jf"
  # gh stubs can't run --jq, so emulate post-jq output: project_context_list reads RAW json
  # (no --jq); boards_with_multiple_anchors uses --jq → return its TSV directly.
  stub_bin gh '
case "$1 $2" in "auth status") exit 0 ;; esac
case "$*" in
  *"api user"*)            echo "testbot" ;;
  *"api graphql"*"--jq"*)  printf "7\tDup\t2\n" ;;   # boards_with_multiple_anchors post-jq
  *"api graphql"*)         cat "'"$jf"'" ;;           # project_context_list raw json
  *) exit 0 ;;
esac'
}

@test "two-anchors: list resolves owners DETERMINISTICALLY from the lowest issue # (bob, not alice)" {
  _skip_msys
  _gh_two_anchor_board
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' list </dev/null"
  assert_success
  assert_output --partial "PRJ-7"
  assert_output --partial "bob"        # owner from issue #3 (lowest) — stable
  refute_output --partial "alice"      # NOT from #5, and NOT order-dependent
}

@test "two-anchors: doctor flags a board carrying more than one anchor issue" {
  _skip_msys
  python3 - "$GOV/org-config.yaml" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
s = re.sub(r'(?m)^agent_work_root:.*$', "agent_work_root: '~/wr'", s) if re.search(r'(?m)^agent_work_root:', s) else s + "\nagent_work_root: '~/wr'\n"
open(p, 'w').write(s)
PY
  mkdir -p "$HOME/wr"          # clean work root: no partial seeds → doctor reaches the anchor scan
  _gh_two_anchor_board
  run bash -c "ADF_WORKSPACE='$GOV' bash '$PRJ_BIN' doctor </dev/null"
  assert_success
  assert_output --partial "MORE THAN ONE anchor"
  assert_output --partial "#7"
}

# ── move anchor (re-designate) with migration ─────────────────────────────────
# All gh-from-BASH (no python), so this runs on ALL platforms incl. Windows. A logging
# stub records every `issue edit` so we can assert the migration mutations.
_gh_move_stub() {
  MOVE_LOG="$_STUB_DIR/edits.log"; : > "$MOVE_LOG"
  stub_bin gh '
case "$1 $2" in "auth status") exit 0 ;; esac
case "$*" in
  *"issue edit"*)             echo "$*" >> "'"$MOVE_LOG"'" ;;   # record mutations
  *"issue view"*assignees*)   echo "alice" ;;                    # OLD anchor assignees
  *"issue view"*owner-team*)  echo "developers" ;;               # OLD owner-team labels
  *"issue view"*state*)       echo "active" ;;                   # OLD state label
  *"api graphql"*)            echo "testorg/repo#5" ;;           # anchor_issue_ref → OLD anchor
  *"api user"*)               echo "testbot" ;;
  *) exit 0 ;;
esac'
}

@test "anchor move: migrates owners, team-owners & state to the new issue and strips the old" {
  _gh_move_stub
  run bash -c "ADF_WORKSPACE='$GOV' bash '$PRJ_BIN' anchor move 7 testorg/repo#8"
  assert_success
  run cat "$_STUB_DIR/edits.log"
  # NEW issue #8 gains everything the anchor carries
  assert_output --partial "issue edit 8 --repo testorg/repo --add-label anchor"
  assert_output --partial "--add-assignee alice"
  assert_output --partial "--add-label owner-team:developers"
  assert_output --partial "--add-label state:active"
  # OLD issue #5 loses the anchor marker
  assert_output --partial "issue edit 5 --repo testorg/repo --remove-label anchor"
}

@test "anchor move: rejects a bad new-ref and a same-as-current move" {
  run bash -c "ADF_WORKSPACE='$GOV' bash '$PRJ_BIN' anchor move 7 notaref"
  assert_failure
  assert_output --partial "owner/repo#issue"
  _gh_move_stub
  run bash -c "ADF_WORKSPACE='$GOV' bash '$PRJ_BIN' anchor move 7 testorg/repo#5"
  assert_output --partial "already the anchor"
}
