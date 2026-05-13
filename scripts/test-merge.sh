#!/usr/bin/env bash
# Script: test-merge
# Purpose: Pre-merge gate for the workspace repo's default branch.
#          Validates that merging <source-branch> will not violate schema
#          or invariants. On pass, fast-forwards local default to the
#          merged tip — caller pushes. On fail, leaves local default
#          unchanged.
#
# Usage:   bash scripts/test-merge.sh <source-branch>
#
# Behavior:
#   1. Sync local $DEFAULT_BRANCH with remote (only legitimate remote read)
#   2. Create ephemeral test branch test-merge/<source> from $DEFAULT_BRANCH
#   3. Merge <source> into test branch (no push)
#   4. Run scripts/validate/run.py against the merged tree
#   5a. Pass: fast-forward $DEFAULT_BRANCH to test-merge tip; delete test branch
#   5b. Fail: discard test branch; $DEFAULT_BRANCH untouched; exit non-zero
#
# This script is the foundation of the test-merge gate strategy. See:
#   knowledge/guidance/test-merge-gate.md (TODO)
#
# Compliance: C01 — workspace integrity gate

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

SOURCE_BRANCH="${1:-}"
[[ -n "$SOURCE_BRANCH" ]] || hard_stop "Usage: $0 <source-branch>"

cd "$REPO_ROOT"

ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
TEST_BRANCH="test-merge/$SOURCE_BRANCH"
VALIDATOR="$REPO_ROOT/scripts/validate/run.py"

[[ -x "$VALIDATOR" ]] || hard_stop "Validator not found or not executable: $VALIDATOR"

# Verify source branch exists locally or on remote
if ! git rev-parse --verify "$SOURCE_BRANCH" &>/dev/null; then
  if git ls-remote --exit-code origin "$SOURCE_BRANCH" &>/dev/null; then
    info "Fetching $SOURCE_BRANCH from origin..."
    git fetch origin "$SOURCE_BRANCH:$SOURCE_BRANCH" 2>/dev/null \
      || git fetch origin "$SOURCE_BRANCH"
  else
    hard_stop "Source branch '$SOURCE_BRANCH' not found locally or on remote."
  fi
fi

# Cleanup helper — used on failure to restore state
on_fail() {
  git merge --abort 2>/dev/null || true
  git checkout "$ORIGINAL_BRANCH" 2>/dev/null \
    || git checkout "$DEFAULT_BRANCH" 2>/dev/null || true
  git branch -D "$TEST_BRANCH" 2>/dev/null || true
}

# 1. Sync local default with remote
info "Syncing local $DEFAULT_BRANCH with origin..."
git fetch origin "$DEFAULT_BRANCH"
git checkout "$DEFAULT_BRANCH"
if ! git pull --ff-only origin "$DEFAULT_BRANCH"; then
  on_fail
  hard_stop "Cannot fast-forward local $DEFAULT_BRANCH from remote — resolve manually."
fi

# 2. Create ephemeral test branch from current default tip
if git rev-parse --verify "$TEST_BRANCH" &>/dev/null; then
  warn "Stale test branch '$TEST_BRANCH' exists from a previous run — deleting."
  git branch -D "$TEST_BRANCH"
fi
git checkout -b "$TEST_BRANCH"

# 3. Merge source into test branch (local only)
info "Test-merging '$SOURCE_BRANCH' into '$TEST_BRANCH'..."
if ! git merge --no-ff -m "test-merge: $SOURCE_BRANCH" "$SOURCE_BRANCH"; then
  on_fail
  hard_stop "Merge conflict: '$SOURCE_BRANCH' cannot merge cleanly into '$DEFAULT_BRANCH'. Resolve before retrying."
fi

# 4. Run validators against merged tree
echo ""
info "Running validators against merged tree..."
echo ""
if ! python3 "$VALIDATOR" "$REPO_ROOT"; then
  echo ""
  on_fail
  hard_stop "Test-merge gate FAILED for '$SOURCE_BRANCH'. Local '$DEFAULT_BRANCH' is unchanged."
fi

# 5. Pass: fast-forward default to test-merge tip; clean up test branch
echo ""
info "Test-merge gate PASSED. Promoting to local '$DEFAULT_BRANCH'..."
git checkout "$DEFAULT_BRANCH"
git merge --ff-only "$TEST_BRANCH"
git branch -d "$TEST_BRANCH"

echo ""
info "✓ Local '$DEFAULT_BRANCH' now contains the merge of '$SOURCE_BRANCH'."
info "  Caller should: git push origin $DEFAULT_BRANCH"
