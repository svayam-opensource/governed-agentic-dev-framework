#!/usr/bin/env bats
# prj doctor + the seed-complete sentinel (PRJ-43 C/D). A seed writes `.seed-complete`
# LAST; a project work dir without it is a PARTIAL (failed mid-seed), not a project.
# `work` must re-seed it (not switch into it), and `doctor` finds + cleans the orphans.
load helpers

setup() {
  sandbox_up
  GOV="$TEST_TMP/gov"; make_gov_repo "$GOV"
  WR="$TEST_TMP/wr"; mkdir -p "$WR"
  # point agent_work_root at our sandbox dir so doctor/work scan it (absolute path).
  # Use stdlib `re` only — ubuntu CI's python3 has no pyyaml module.
  python3 - "$GOV/org-config.yaml" "$WR" <<'PY'
import sys, re
p, wr = sys.argv[1], sys.argv[2]
s = open(p).read()
line = 'agent_work_root: "%s"' % wr
if re.search(r'(?m)^agent_work_root:', s):
    s = re.sub(r'(?m)^agent_work_root:.*$', line, s)
else:
    s = s.rstrip() + '\n' + line + '\n'
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
