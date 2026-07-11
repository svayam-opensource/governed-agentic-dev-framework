#!/usr/bin/env bats
# prj 0.10.0 — `prj backfill-state` stamps searchable state:* labels on anchors that
# lack them (so 'label:state:*' search covers pre-0.10.0 projects). Hermetic: with no
# boards stubbed it reports a clean, zero-work run (and must not crash under set -e).
load helpers
setup() { sandbox_up; make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"; stub_gh_authed; }
teardown() { sandbox_down; }

@test "backfill-state: clean zero-work run when there are no boards" {
  run bash -c "ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN' backfill-state </dev/null"
  assert_success
  assert_output --partial "Backfill searchable state labels"
  assert_output --partial "Backfilled 0 project(s)"
}
