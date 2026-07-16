#!/usr/bin/env bash
# tests/e2e_cleanup.sh — Manual cleanup for a smoke-test run.
#
# When tests/e2e_smoke.sh fails (without --always-clean), it preserves the
# throwaway repo, local clone, branches, and tags for inspection. Run this
# script when you're done inspecting:
#
#   bash tests/e2e_cleanup.sh <test-repo-name>
#
# Example:
#   bash tests/e2e_cleanup.sh adf-smoke-1714000000
#
# This script is best-effort: every delete is wrapped in `|| true` so missing
# items don't block the rest. It will:
#   - delete the throwaway repo on GitHub (this drops all branches and tags
#     transitively, so we don't enumerate them)
#   - remove the local clone under /tmp
#   - remove any AGENT_WORK_ROOT clones for projects seeded under the test repo

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$REPO_ROOT/tests/e2e_config.env"
[[ -f "$CONFIG" ]] || { echo "ERROR: $CONFIG not found"; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"

TEST_REPO_NAME="${1:-}"
[[ -n "$TEST_REPO_NAME" ]] || {
  echo "Usage: bash tests/e2e_cleanup.sh <test-repo-name>"
  echo "Example: bash tests/e2e_cleanup.sh adf-smoke-1714000000"
  exit 2
}

TEST_REPO="$SMOKE_TEST_OWNER/$TEST_REPO_NAME"
TEST_CLONE="/tmp/$TEST_REPO_NAME"
AGENT_WORK_ROOT="${AGENT_WORK_ROOT:-$HOME/work}"

echo "Cleaning up smoke test artifacts for $TEST_REPO_NAME..."

# Delete the throwaway repo (cascades to branches + tags)
if gh repo view "$TEST_REPO" >/dev/null 2>&1; then
  if gh repo delete "$TEST_REPO" --yes 2>/dev/null; then
    echo "  ✓ deleted GitHub repo $TEST_REPO"
  else
    echo "  ! could not delete GitHub repo $TEST_REPO (check delete_repo scope on PAT)"
  fi
else
  echo "  - GitHub repo $TEST_REPO already gone"
fi

# Remove local clone under /tmp
if [[ -d "$TEST_CLONE" ]]; then
  rm -rf "$TEST_CLONE"
  echo "  ✓ removed local clone $TEST_CLONE"
else
  echo "  - local clone $TEST_CLONE already gone"
fi

# Remove any AGENT_WORK_ROOT clones seeded by the smoke test.
# Smoke test seeds projects with id matching the org slug pattern, e.g. SMK-001-...
removed=0
if [[ -d "$AGENT_WORK_ROOT" ]]; then
  while IFS= read -r dir; do
    rm -rf "$dir"
    echo "  ✓ removed work clone $dir"
    removed=$((removed + 1))
  done < <(find "$AGENT_WORK_ROOT" -maxdepth 1 -type d -name "${SMOKE_ORG_SLUG}-*" 2>/dev/null)
fi
[[ "$removed" -eq 0 ]] && echo "  - no AGENT_WORK_ROOT clones to remove under $AGENT_WORK_ROOT"

echo ""
echo "Cleanup complete."
