#!/usr/bin/env bats
# CLASS guard for the recurring "wrong workspace / no projects / blank org name" bug.
# prj has MORE THAN ONE entry point that resolves the governance workspace:
#   - bin/prj   (the npm wrapper)
#   - prj       (the standalone script — what `./prj` runs)
# The bug kept coming back because each resolved independently and tests only covered
# bin/prj, so the standalone script silently diverged (fell back to $SCRIPT_DIR = the
# framework/template repo → empty org, no projects). This suite runs BOTH entry points
# under identical env/cwd via the PRJ_PRINT_WORKSPACE probe and asserts they agree AND
# resolve the right home. Add a new entry point → add it to _ENTRYPOINTS below.
load helpers

_ENTRYPOINTS=()   # populated in setup from the real binaries

setup() {
  sandbox_up
  GOV="$TEST_TMP/gov";                 make_gov_repo "$GOV"
  PROJ="$AGENT_WORK_ROOT/PRJ-9-x/ws";  make_gov_repo "$PROJ"
  TMPL="$AGENT_WORK_ROOT/tmpl"; mkdir -p "$TMPL"
  cp "$REPO_SRC/org-config.yaml" "$TMPL/org-config.yaml"   # unconfigured template (github_org: "")
  write_pointer "$GOV"
  _ENTRYPOINTS=("$BIN_PRJ" "$PRJ_BIN")
}
teardown() { sandbox_down; }

# Resolve the workspace via ONE entry point with a controlled ADF_WORKSPACE
# ($2 empty => the var is UNSET). Uses the PRJ_PRINT_WORKSPACE probe (no gh, no side effects).
_resolve_via() {
  local bin="$1" adf="$2"
  if [[ -z "$adf" ]]; then
    env -u ADF_WORKSPACE bash -c "PRJ_PRINT_WORKSPACE=1 bash '$bin'" 2>/dev/null || true
  else
    ADF_WORKSPACE="$adf" bash -c "PRJ_PRINT_WORKSPACE=1 bash '$bin'" 2>/dev/null || true
  fi
}

# Assert EVERY entry point resolves to <expected> (and therefore agree with each other).
# $1 = ambient ADF_WORKSPACE ("" => unset), $2 = expected workspace.
_assert_parity() {
  local adf="$1" exp="$2" bin got
  for bin in "${_ENTRYPOINTS[@]}"; do
    got="$(_resolve_via "$bin" "$adf")"
    [[ "$got" == "$exp" ]] || { echo "DRIFT: $(basename "$(dirname "$bin")")/$(basename "$bin") resolved '$got' != expected '$exp' (adf='${adf:-<unset>}')"; return 1; }
  done
}

@test "parity: from a template dir, no ADF_WORKSPACE -> all entrypoints resolve the pointer home" {
  cd "$TMPL"                       # the exact bug: standing in an empty-github_org template
  run _assert_parity "" "$GOV"
  assert_success
}

@test "parity: inside a per-project workspace -> all entrypoints resolve IT" {
  cd "$PROJ"
  run _assert_parity "" "$PROJ"
  assert_success
}

@test "parity: neutral cwd -> all entrypoints resolve the pointer home" {
  cd "$TEST_TMP"
  run _assert_parity "" "$GOV"
  assert_success
}

@test "parity: an ambient (unresolved) ADF_WORKSPACE template is ignored by ALL entrypoints" {
  cd "$TEST_TMP"
  run _assert_parity "$TMPL" "$GOV"    # both must ignore the stale/template ambient export
  assert_success
}
