#!/usr/bin/env bats
# Cursor GUI launch helpers (PRJ-43 follow-up). Two reported issues:
#   (b) the GUI opened the GOV CLONE alone, hiding sibling code repos — it must open the
#       PROJECT ROOT (the parent that holds the gov clone + every code repo).
#   (a) the protocol was printed to paste — the GUI must run it automatically via an
#       alwaysApply Cursor rule at the opened folder (the framework's Pattern 1).
load helpers

setup() { sandbox_up; source "$REPO_SRC/scripts/agent-launch.sh"; }
teardown() { sandbox_down; }

@test "project-root: resolves the parent of the gov clone (where all repos live)" {
  run _project_root_of_clone "/work/PRJ-7-x/aarambh-gov-repo"
  assert_success
  assert_output "/work/PRJ-7-x"
}

@test "autostart rule: writes an alwaysApply rule that auto-runs session-start (no paste)" {
  root="$TEST_TMP/PRJ-7-x"; mkdir -p "$root"
  run _ensure_cursor_autostart_rule "$root" "aarambh-gov-repo" "PRJ-7-x"
  assert_success
  rule="$root/.cursor/rules/session-start.mdc"
  assert [ -f "$rule" ]
  run cat "$rule"
  assert_output --partial "alwaysApply: true"          # auto-applies in every chat
  assert_output --partial "PRJ-7-x"                    # project-specific
  assert_output --partial "aarambh-gov-repo/projects/PRJ-7-x/agent.md"   # points into the gov clone
  assert_output --partial "do NOT wait for the user to paste"            # proactive (Pattern 1)
  assert_output --partial "context manifest"
}

@test "autostart rule: idempotent - never clobbers an existing rule" {
  root="$TEST_TMP/PRJ-7-x"; mkdir -p "$root/.cursor/rules"
  printf 'KEEP ME\n' > "$root/.cursor/rules/session-start.mdc"
  run _ensure_cursor_autostart_rule "$root" "gov" "PRJ-7-x"
  assert_success
  run cat "$root/.cursor/rules/session-start.mdc"
  assert_output "KEEP ME"
}

@test "autostart rule: rejects missing args (no half-written rule)" {
  run _ensure_cursor_autostart_rule "" "gov" "PRJ-7-x"
  assert_failure
}
