#!/usr/bin/env bash
# Script: sync-from-publish
# Purpose: Pull universal framework updates from `publish` into `main`,
#          preserving main's private overlay (org-config.yaml, registry.yaml,
#          projects/). Direction A: framework files contain no placeholders,
#          so this is a plain merge — no re-substitution step.
#
# Usage:   bash scripts/sync-from-publish.sh [--dry-run] [--no-push]
#
# Flags:
#   --dry-run   Show what would be merged without making any changes.
#   --no-push   Do the merge + validation locally; do not push to origin/main.
#
# Privacy: NEVER syncs main → publish. One-way (publish → main).
#
# Strategy:
#   1. Verify on main, clean, fast-forwardable from origin.
#   2. Show commits to be merged; confirm (skip if --dry-run).
#   3. Create ephemeral test branch test-sync-from-publish from main.
#   4. Merge publish with -X theirs (auto-prefer publish for content conflicts).
#   5. Restore main's private overlay (org-config.yaml, registry.yaml, projects/)
#      from main's pre-merge state.
#   6. Run validators — fail if any placeholders leaked (framework files must
#      stay placeholder-free; validator's placeholder check is always-on).
#   7. On pass: fast-forward main to test branch tip, push, delete test branch.
#   8. On fail: discard test branch, restore main, exit non-zero.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

DRY_RUN=false
NO_PUSH=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --no-push) NO_PUSH=true ;;
    --allow-downgrade) export ALLOW_DOWNGRADE=true ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //;s/^#//'
      exit 0
      ;;
    *) hard_stop "Unknown flag: $arg (see --help)" ;;
  esac
done

cd "$REPO_ROOT"

# ── Pre-conditions ────────────────────────────────────────────────────────────

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT_BRANCH" == "$DEFAULT_BRANCH" ]] \
  || hard_stop "Run from '$DEFAULT_BRANCH' (currently on '$CURRENT_BRANCH')."

[[ -z "$(git status --porcelain)" ]] \
  || hard_stop "Uncommitted changes present. Stash or commit first."

# ── Fetch latest ──────────────────────────────────────────────────────────────

echo "=== sync-from-publish"
$DRY_RUN && echo "    (dry-run mode — no changes will be made)"
$NO_PUSH && echo "    (--no-push — will merge locally but not push)"
echo ""

info "Fetching latest..."
git fetch origin "$DEFAULT_BRANCH"
git fetch origin publish

if ! git pull --ff-only origin "$DEFAULT_BRANCH"; then
  hard_stop "Cannot fast-forward local '$DEFAULT_BRANCH' from origin."
fi

# ── Identify commits to sync ──────────────────────────────────────────────────

COMMITS_TO_SYNC=$(git rev-list --count "$DEFAULT_BRANCH..origin/publish" 2>/dev/null || echo 0)

if [[ "$COMMITS_TO_SYNC" -eq 0 ]]; then
  echo "✓ '$DEFAULT_BRANCH' is already up to date with publish."
  exit 0
fi

# ── Framework version guard: never let an OLDER publish overwrite main ────────
PUB_VER="$(git show origin/publish:framework/VERSION 2>/dev/null | tr -d '[:space:]')"
CUR_VER="$(git show "$DEFAULT_BRANCH:framework/VERSION" 2>/dev/null | tr -d '[:space:]')"
[[ -n "$PUB_VER" ]] && info "framework: publish v$PUB_VER → $DEFAULT_BRANCH v$CUR_VER"
assert_no_framework_downgrade "$PUB_VER" "$CUR_VER" "sync-from-publish"

echo ""
echo "Commits on publish not yet on $DEFAULT_BRANCH ($COMMITS_TO_SYNC total):"
git log --oneline "$DEFAULT_BRANCH..origin/publish" | head -30
echo ""

if $DRY_RUN; then
  echo ""
  info "Dry-run: would merge the above commits into $DEFAULT_BRANCH using -X theirs,"
  info "         restore private overlay (org-config.yaml, registry.yaml, projects/),"
  info "         run validators,"
  info "         and (unless --no-push) push to origin/$DEFAULT_BRANCH."
  exit 0
fi

confirm "Proceed with merge?"

# ── Test branch + merge ───────────────────────────────────────────────────────

TEST_BRANCH="test-sync-from-publish"
ORIGINAL_SHA=$(git rev-parse HEAD)

cleanup_on_fail() {
  echo ""
  warn "Sync failed — restoring '$DEFAULT_BRANCH' to pre-sync state."
  git merge --abort 2>/dev/null || true
  git checkout "$DEFAULT_BRANCH" 2>/dev/null || true
  git reset --hard "$ORIGINAL_SHA" 2>/dev/null || true
  git branch -D "$TEST_BRANCH" 2>/dev/null || true
}

if git rev-parse --verify "$TEST_BRANCH" &>/dev/null; then
  warn "Stale test branch '$TEST_BRANCH' exists — deleting."
  git branch -D "$TEST_BRANCH"
fi
git checkout -b "$TEST_BRANCH"

info "Merging publish with -X theirs (auto-prefers publish for conflicts)..."
if ! git merge -X theirs --no-edit -m "sync: publish → $DEFAULT_BRANCH" origin/publish; then
  cleanup_on_fail
  hard_stop "Merge failed despite -X theirs. Manual intervention required."
fi

# ── Restore private overlay from pre-merge main ───────────────────────────────

info "Restoring private overlay (org-config.yaml, registry.yaml, projects/)..."

# HEAD^1 is the first parent (pre-merge main); HEAD^2 is publish's tip.
# We want main's pre-merge content for these specific paths.
PRIVATE_PATHS=("org-config.yaml" "registry.yaml")
for path in "${PRIVATE_PATHS[@]}"; do
  if git ls-tree HEAD^1 -- "$path" &>/dev/null; then
    git checkout HEAD^1 -- "$path"
  fi
done

# projects/ may exist on main only (publish has empty projects/)
if git ls-tree HEAD^1 -- projects/ &>/dev/null; then
  # Remove any projects content that came from publish, then restore main's
  git rm -rf --cached projects/ &>/dev/null || true
  rm -rf projects
  git checkout HEAD^1 -- projects/
fi

# Amend the merge commit with the overlay restorations.
if [[ -n "$(git diff --cached --name-only)" ]]; then
  git commit --amend --no-edit
fi

# ── Validate the merged tree ──────────────────────────────────────────────────

VALIDATOR="$REPO_ROOT/scripts/validate/run.py"
if [[ -x "$VALIDATOR" ]]; then
  echo ""
  info "Running validators against merged tree..."
  echo ""
  if ! python3 "$VALIDATOR" "$REPO_ROOT"; then
    echo ""
    cleanup_on_fail
    hard_stop "Validation FAILED — sync rolled back. '$DEFAULT_BRANCH' is unchanged."
  fi
else
  warn "Validator not found at $VALIDATOR — skipping post-merge validation."
fi

# ── Promote test branch to main and clean up ──────────────────────────────────

echo ""
info "Validation passed. Promoting to '$DEFAULT_BRANCH'..."
git checkout "$DEFAULT_BRANCH"
git merge --ff-only "$TEST_BRANCH"
git branch -d "$TEST_BRANCH"

# ── Push (unless --no-push) ───────────────────────────────────────────────────

if $NO_PUSH; then
  echo ""
  info "✓ Sync complete locally. NOT pushed (--no-push)."
  info "  When ready: git push origin $DEFAULT_BRANCH"
else
  echo ""
  info "Pushing to origin/$DEFAULT_BRANCH..."
  git push origin "$DEFAULT_BRANCH"
  echo ""
  info "✓ Sync complete. '$DEFAULT_BRANCH' updated and pushed."
fi
