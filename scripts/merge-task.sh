#!/usr/bin/env bash
# Script: merge-task
# Purpose: Merges a completed sub-branch back into the project integration branch.
#          Archives sub-branch. Closes GitHub Issue.
# Usage:   bash merge-task.sh <project_id> <task_id>
# Compliance: C02 (POL-073 to POL-075)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
ISSUE_URL="${2:-}"

[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id> <github_issue_url>"
[[ -n "$ISSUE_URL"  ]] || hard_stop "Usage: $0 <project_id> <github_issue_url>"

echo "=== merge-task: $PROJECT_ID / $ISSUE_URL"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "active"

BRANCH=$(project_branch_for_id "$PROJECT_ID")

# Tasks-on-board model: derive the sub-branch from the issue title (same slugify
# as create-task) — no project.yaml tasks[] lookup.
ISSUE_TITLE=$(gh issue view "$ISSUE_URL" --json title -q '.title' 2>/dev/null) \
  || hard_stop "Could not fetch issue title from $ISSUE_URL — verify the issue URL."
TASK_SLUG=$(slugify "$ISSUE_TITLE")
TASK_ID="${BRANCH}.${TASK_SLUG}"   # '.' separator — see create-task.sh for why not '/'

# Verify the task sub-branch exists on the remote
git -C "$REPO_ROOT" ls-remote --exit-code --heads origin "$TASK_ID" >/dev/null 2>&1 \
  || hard_stop "No sub-branch '$TASK_ID' on the remote for $ISSUE_URL — was the task created?"

# Check no uncommitted changes in workspace
check_clean "$REPO_ROOT"

# Check no uncommitted changes in code repos
while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  [[ -d "$REPO_DIR/.git" ]] && check_clean "$REPO_DIR"
done < <(get_project_repos "$PROJECT_YAML")

# ── Merge sub-branch into project branch ─────────────────────────────────────

echo "Merging '$TASK_ID' → '$BRANCH' in workspace repo..."
cd "$REPO_ROOT"
git fetch origin "$TASK_ID" 2>/dev/null || true
merge_branch "$REPO_ROOT" "$TASK_ID" "$BRANCH"
git push origin "$BRANCH"

while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping merge."
    continue
  fi
  echo "Merging '$TASK_ID' → '$BRANCH' in $REPO_NAME..."
  git -C "$REPO_DIR" fetch origin "$TASK_ID" 2>/dev/null || true
  merge_branch "$REPO_DIR" "$TASK_ID" "$BRANCH"
  git -C "$REPO_DIR" push origin "$BRANCH"
done < <(get_project_repos "$PROJECT_YAML")

# ── Archive sub-branches ──────────────────────────────────────────────────────

echo ""
echo "Archiving sub-branches..."

archive_branch "$REPO_ROOT" "$TASK_ID"

while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  [[ -d "$REPO_DIR/.git" ]] && archive_branch "$REPO_DIR" "$TASK_ID"
done < <(get_project_repos "$PROJECT_YAML")

# ── Close the GitHub Issue + mark Done on the board (tasks-on-board) ──────────
gh issue close "$ISSUE_URL" --comment "Task \`$TASK_ID\` merged into \`$BRANCH\`." 2>/dev/null \
  || warn "Could not close issue $ISSUE_URL — close manually."
info "Closed issue: $ISSUE_URL"
GHPROJ=$(yaml_get "$PROJECT_YAML" "github_project")
board_set_status "$GHPROJ" "$ISSUE_URL" "Done" || true

echo ""
echo "=== Task merged successfully!"
echo "    Task:    $TASK_ID"
echo "    Merged → $BRANCH"
echo "    Issue:   ${ISSUE_URL:-n/a} (closed)"
