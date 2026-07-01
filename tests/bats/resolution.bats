#!/usr/bin/env bats
# Regression suite for the PRJ-43 gov-home resolution bug. Fully hermetic.
load helpers

setup() {
  sandbox_up
  GOV="$TEST_TMP/gov";   make_gov_repo "$GOV"
  BASES="$AGENT_WORK_ROOT/.bases/wsrepo"; make_gov_repo "$BASES"
  PROJ="$AGENT_WORK_ROOT/PRJ-9-x/wsrepo";  make_gov_repo "$PROJ"
}
teardown() { sandbox_down; }

@test "resolves to the pointer-file home from /tmp (env unset)" {
  write_pointer "$GOV"; cd /tmp
  run resolved_workspace
  assert_success; assert_output "$GOV"
}

@test "never resolves to a .bases base clone (env unset, cwd inside .bases)" {
  write_pointer "$GOV"; cd "$BASES"
  run resolved_workspace
  assert_output "$GOV"
}

@test "rejects ADF_WORKSPACE pointing at .bases, falls back to pointer" {
  write_pointer "$GOV"; cd "$TEST_TMP"
  ADF_WORKSPACE="$BASES" run resolved_workspace
  assert_output "$GOV"
}

@test "ignores an ambient ADF_WORKSPACE when the pointer resolves (deterministic)" {
  # The CLI must NOT depend on an ambient ADF_WORKSPACE: a working pointer wins,
  # so a stale login-shell export can never misdirect it.
  write_pointer "$GOV"; OTHER="$TEST_TMP/other"; make_gov_repo "$OTHER"
  ADF_WORKSPACE="$OTHER" run resolved_workspace
  assert_output "$GOV"
}

@test "bootstraps the registry from ADF_WORKSPACE only when nothing is registered" {
  # Nothing registered yet → an inbound ADF_WORKSPACE seeds the registry (and is
  # recorded), so a FUTURE run resolves deterministically without the env var.
  OTHER="$TEST_TMP/other"; make_gov_repo "$OTHER"
  ADF_WORKSPACE="$OTHER" run resolved_workspace
  assert_output "$OTHER"
  # persisted in the registry → next run (no env, neutral cwd) still resolves it
  cd /tmp; run resolved_workspace
  assert_output "$OTHER"
}

@test "PWD-walk picks a per-project workspace when inside one (mid-project)" {
  write_pointer "$GOV"; cd "$PROJ"
  run resolved_workspace
  assert_output "$PROJ"
}

@test "PWD-walk SKIPS an unconfigured template org-config (empty github_org)" {
  # The shipped framework/template org-config has github_org: "". Running prj from
  # inside such a dir (e.g. the framework repo) must NOT resolve it as the workspace
  # (empty GITHUB_ORG -> no org name, no projects); fall through to the pointer home.
  write_pointer "$GOV"
  local TMPL="$AGENT_WORK_ROOT/tmpl"; mkdir -p "$TMPL"
  cp "$REPO_SRC/org-config.yaml" "$TMPL/org-config.yaml"   # RAW template: github_org: ""
  cd "$TMPL"
  run resolved_workspace
  assert_output "$GOV"          # fell through to the pointer home, not the template dir
}

@test "hard-errors when nothing resolves (no env, no pointer, non-interactive)" {
  # a HOME-REQUIRING command (status) — version/help/org are intentionally homeless-OK.
  cd /tmp
  run bash "$BIN_PRJ" status
  assert_failure
  assert_output --partial "could not locate"
}
