#!/usr/bin/env bash
# Script: sync
# Purpose: Merges latest DEFAULT_BRANCH/base into active project branch on demand.
#          Use mid-project to stay current without pausing/resuming.
# Usage:   bash sync.sh <project_id>
# Compliance: C03 — encouraged but not mandatory (POL-122)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id>"

echo "=== sync: $PROJECT_ID"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "active"

BRANCH=$(project_branch_for_id "$PROJECT_ID")

echo "Checking for uncommitted changes..."
check_clean "$REPO_ROOT"
while IFS= read -r repo_url; do
  REPO_DIR="$AGENT_WORK_ROOT/$PROJECT_ID/$(get_repo_name "$repo_url")"
  [[ -d "$REPO_DIR/.git" ]] && check_clean "$REPO_DIR"
done < <(get_project_repos "$PROJECT_YAML")
info "All repos are clean."
echo ""

# ── Sync workspace repo ───────────────────────────────────────────────────────

echo "Syncing workspace repo: $DEFAULT_BRANCH → $BRANCH..."
cd "$REPO_ROOT"
git fetch origin "$DEFAULT_BRANCH"
git checkout "$BRANCH"
if ! git merge --no-edit "origin/$DEFAULT_BRANCH" 2>/dev/null; then
  echo ""
  echo "MERGE CONFLICT: $DEFAULT_BRANCH → $BRANCH in workspace repo."
  echo "Resolve conflicts manually, commit, then re-run: bash sync.sh $PROJECT_ID"
  exit 2
fi
git push origin "$BRANCH"
info "Workspace repo synced."

# ── Sync each code repo ───────────────────────────────────────────────────────

while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$AGENT_WORK_ROOT/$PROJECT_ID/$REPO_NAME"
  REPO_BASE=$(get_repo_base_branch "$PROJECT_YAML" "$repo_url")

  if [[ ! -d "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping sync."
    continue
  fi

  echo "Syncing $REPO_NAME: $REPO_BASE → $BRANCH..."
  git -C "$REPO_DIR" fetch origin "$REPO_BASE"
  git -C "$REPO_DIR" checkout "$BRANCH"
  if ! git -C "$REPO_DIR" merge --no-edit "origin/$REPO_BASE" 2>/dev/null; then
    echo ""
    echo "MERGE CONFLICT: $REPO_BASE → $BRANCH in $REPO_NAME."
    echo "Resolve conflicts manually, commit, then re-run: bash sync.sh $PROJECT_ID"
    exit 2
  fi
  git -C "$REPO_DIR" push origin "$BRANCH"
  info "$REPO_NAME synced."
done < <(get_project_repos "$PROJECT_YAML")

echo ""
echo "=== Sync complete. All project branches are current."
echo ""
echo "[ C03 ] Reload knowledge layers before continuing work:"
echo "    1. $WORKSPACE_REPO/knowledge/"
echo "    2. $WORKSPACE_REPO/projects/$PROJECT_ID/knowledge/"
echo "    3. <repo>/knowledge/ for each repo"
