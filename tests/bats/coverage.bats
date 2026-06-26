#!/usr/bin/env bats
# Enforcement: every prj command has a test or is on the (shrinking) baseline.
load helpers
@test "command coverage ratchet (check_coverage.sh)" {
  run bash "${BATS_TEST_DIRNAME}/check_coverage.sh"
  assert_success
}
