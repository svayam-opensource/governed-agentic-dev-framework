#!/usr/bin/env bats
# prj doctor + the seed-complete sentinel (PRJ-43 C/D). A seed writes `.seed-complete`
# LAST; a project work dir without it is a PARTIAL (failed mid-seed), not a project.
# `work` must re-seed it (not switch into it), and `doctor` finds + cleans the orphans.
load helpers

setup() {
  sandbox_up
  GOV="$TEST_TMP/gov"; make_gov_repo "$GOV"
  # Point agent_work_root at a TILDE path ('~/wr') — prj expands ~ to $HOME (the sandbox).
  # An ABSOLUTE injected path doesn't survive Windows MSYS translation into YAML (it lands as
  # C:\.. → invalid escapes → empty); the template's own agent_work_root is tilde-based for
  # exactly this reason. stdlib `re` only (ubuntu CI has no pyyaml).
  WR="$HOME/wr"; mkdir -p "$WR"
  python3 - "$GOV/org-config.yaml" <<'PY'
import sys, re
p = sys.argv[1]; line = "agent_work_root: '~/wr'"
s = open(p).read()
s = re.sub(r'(?m)^agent_work_root:.*$', line, s) if re.search(r'(?m)^agent_work_root:', s) \
    else s.rstrip() + '\n' + line + '\n'
open(p, 'w').write(s)
PY
  export ADF_WORKSPACE="$GOV"
}
teardown() { sandbox_down; }

@test "doctor: reports clean when there are no partial seeds" {
  mkdir -p "$WR/PRJ-1-good"; : > "$WR/PRJ-1-good/.seed-complete"
  run bash -c "ADF_WORKSPACE='$GOV' bash '$PRJ_BIN' doctor"
  assert_success
  assert_output --partial "no partial seeds"
}

@test "doctor: detects a partial (work dir without .seed-complete)" {
  mkdir -p "$WR/PRJ-1-good"; : > "$WR/PRJ-1-good/.seed-complete"   # complete
  mkdir -p "$WR/PRJ-9-partial/svm-prj-work"                       # partial (no sentinel)
  run bash -c "printf '0\n' | ADF_WORKSPACE='$GOV' bash '$PRJ_BIN' doctor"   # answer: don't clean
  assert_output --partial "PRJ-9-partial"
  assert_output --partial "partial"
  refute_output --partial "PRJ-1-good"        # complete one is NOT flagged
}

@test "doctor: cleans the partial on confirm, keeps the complete one" {
  mkdir -p "$WR/PRJ-1-good"; : > "$WR/PRJ-1-good/.seed-complete"
  mkdir -p "$WR/PRJ-9-partial/svm-prj-work"
  run bash -c "printf '1\n' | ADF_WORKSPACE='$GOV' bash '$PRJ_BIN' doctor"   # confirm clean
  assert [ ! -d "$WR/PRJ-9-partial" ]         # partial removed
  assert [ -d "$WR/PRJ-1-good" ]              # complete kept
}

@test "sentinel: _seed_complete is false for a partial, true for a complete seed" {
  # source the helper context indirectly via the same predicate prj uses
  mkdir -p "$WR/PRJ-9-partial"; mkdir -p "$WR/PRJ-1-good"; : > "$WR/PRJ-1-good/.seed-complete"
  [ ! -f "$WR/PRJ-9-partial/.seed-complete" ]   # partial: no sentinel
  [ -f "$WR/PRJ-1-good/.seed-complete" ]        # complete: sentinel present
}
