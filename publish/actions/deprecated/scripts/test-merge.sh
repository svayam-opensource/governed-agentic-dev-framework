#!/usr/bin/env bash
# Script: test-merge
# Purpose: Pre-merge gate for the workspace repo's default branch.
#          Validates that merging <source-branch> into $DEFAULT_BRANCH will not
#          violate schema or invariants — WITHOUT checking out or mutating the
#          local default branch. The merge is validated in an ephemeral,
#          throwaway git worktree built from origin/$DEFAULT_BRANCH.
#
# Usage:   bash scripts/test-merge.sh <source-branch>
#
# Behavior:
#   1. Fetch origin/$DEFAULT_BRANCH (the only remote read).
#   2. Add an ephemeral detached worktree at origin/$DEFAULT_BRANCH.
#   3. Merge <source-branch> into it (in the throwaway worktree only).
#   4. Run scripts/validate/run.py against the merged tree.
#   5. Always remove the worktree. Pass -> exit 0; Fail -> exit non-zero.
#
# WORKTREE-SAFE: unlike the legacy gate, this NEVER runs `git checkout
# $DEFAULT_BRANCH` in the caller's working tree, and never fast-forwards the
# local default ref. That makes it safe when the workspace clone is a git
# worktree sharing its .git with another checkout that already holds
# $DEFAULT_BRANCH (the home governance checkout) — the case that made the old
# `git checkout main` gate fail with "'main' is already used by worktree at ...".
#
# Promotion to $DEFAULT_BRANCH is the CALLER's job: close-project opens a pull
# request. This gate only proves the merge is clean and valid; it ships nothing.
#
# Compliance: C01 — workspace integrity gate

set -euo pipefail
# Capture the script's own dir BEFORE any `cd` — the validator ships WITH the CLI
# (npm package), not vendored in the workspace data repo (Option C). Resolve it here.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config

SOURCE_BRANCH="${1:-}"
[[ -n "$SOURCE_BRANCH" ]] || hard_stop "Usage: $0 <source-branch>"

cd "$REPO_ROOT"

# Packaged validator (alongside this script), NOT $REPO_ROOT/scripts/validate — the
# workspace is a pure governance DATA repo and does not vendor scripts (matches CI's
# `prj validate` / cmd_validate, which runs $SCRIPTS/validate/run.py).
VALIDATOR="$SCRIPT_DIR/validate/run.py"
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

# 1. Refresh our knowledge of origin's default tip (fetch only — no checkout)
info "Fetching origin/$DEFAULT_BRANCH..."
git fetch origin "$DEFAULT_BRANCH"

# 2. Build an ephemeral, detached worktree at origin/$DEFAULT_BRANCH. This is a
#    throwaway tree OUTSIDE the repo; the real working tree and the local
#    $DEFAULT_BRANCH ref are never touched. Cleaned up unconditionally on exit.
WT_PARENT="$(mktemp -d "${TMPDIR:-/tmp}/adf-test-merge.XXXXXX")"
WT="$WT_PARENT/wt"

cleanup() {
  git worktree remove --force "$WT" 2>/dev/null || true
  rm -rf "$WT_PARENT" 2>/dev/null || true
  git worktree prune 2>/dev/null || true
}
trap cleanup EXIT

git worktree add --detach "$WT" "origin/$DEFAULT_BRANCH" >/dev/null 2>&1 \
  || hard_stop "Could not create ephemeral worktree at origin/$DEFAULT_BRANCH."

# 3. Merge source into the throwaway worktree (local only, never pushed)
info "Test-merging '$SOURCE_BRANCH' into origin/$DEFAULT_BRANCH (ephemeral worktree)..."
if ! git -C "$WT" merge --no-ff -m "test-merge: $SOURCE_BRANCH" "$SOURCE_BRANCH"; then
  git -C "$WT" merge --abort 2>/dev/null || true
  hard_stop "Merge conflict: '$SOURCE_BRANCH' cannot merge cleanly into '$DEFAULT_BRANCH'. Resolve before retrying."
fi

# 4. Run validators against the merged tree
echo ""
info "Running validators against merged tree..."
echo ""
if ! python3 "$VALIDATOR" --data "$WT"; then
  echo ""
  hard_stop "Test-merge gate FAILED for '$SOURCE_BRANCH'. Nothing was promoted; local '$DEFAULT_BRANCH' is untouched."
fi

# 5. Pass. The worktree is discarded by the EXIT trap; local '$DEFAULT_BRANCH' is
#    untouched. The caller (close-project) promotes via a pull request.
echo ""
info "✓ Test-merge gate PASSED for '$SOURCE_BRANCH' — merge is clean and validates."
info "  Promotion to '$DEFAULT_BRANCH' is via PR (close-project); nothing fast-forwarded here."
