#!/usr/bin/env bash
# Run the governance BATS suite. Fetches bats libs if needed, then runs every
# *.bats under tests/bats/. Used by PR CI and the Jenkins publish gate.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/bootstrap.sh"
BATS="$HERE/.libs/bats-core/bin/bats"
[[ -x "$BATS" ]] || { echo "run.sh: bats not available after bootstrap" >&2; exit 1; }
# Only our own suites (NOT .libs/, which contains the vendored libraries' own
# tests). --print-output-on-failure surfaces assertion diffs in CI logs.
exec "$BATS" --print-output-on-failure "$HERE"/*.bats
