#!/usr/bin/env bash
# Script: create-task
# Purpose: Creates a sub-branch for parallel work by a specific agent/developer.
# Usage:   bash create-task.sh <project_id> <github_issue_url> <assignee>
# Compliance: C02 (POL-073 to POL-075)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
ISSUE_URL="${2:-}"
ASSIGNEE="${3:-}"

[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id> <github_issue_url> <assignee>"
[[ -n "$ISSUE_URL"  ]] || hard_stop "Usage: $0 <project_id> <github_issue_url> <assignee>"
[[ -n "$ASSIGNEE"   ]] || hard_stop "Usage: $0 <project_id> <github_issue_url> <assignee>"

echo "=== create-task: $PROJECT_ID"
echo "    Issue:    $ISSUE_URL"
echo "    Assignee: $ASSIGNEE"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "active"

# Derive the project branch name from PROJECT_ID.
# PRJ-NNN-slug → brnch-NNN-slug
BRANCH=$(project_branch_for_id "$PROJECT_ID")

# Derive issue repo URL (everything before /issues/N)
ISSUE_REPO_URL=$(echo "$ISSUE_URL" | sed 's|/issues/[0-9]*$||')

# Verify issue repo is in project repos[]
REPO_FOUND=false
while IFS= read -r repo_url; do
  [[ "$repo_url" == "$ISSUE_REPO_URL" ]] && REPO_FOUND=true && break
done < <(get_project_repos "$PROJECT_YAML")
$REPO_FOUND || hard_stop "Repo '$ISSUE_REPO_URL' is not in project repos[]. Add it first via add-repo."

# The person creating the task must be authorized on the project — assigned_to
# individual or a member of the assigned_to team (per-task/team model, POL-047).
CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")
is_authorized "$ASSIGNED_TO" \
  || hard_stop "You ($CURRENT_USER) are not authorized on this project (assigned_to: $ASSIGNED_TO)."

# Derive task slug from issue title
ISSUE_TITLE=$(gh issue view "$ISSUE_URL" --json title -q '.title' 2>/dev/null) \
  || hard_stop "Could not fetch issue title from $ISSUE_URL"
TASK_SLUG=$(slugify "$ISSUE_TITLE")
# Task sub-branch name. NOTE the '.' separator (not '/'): git refuses to hold a
# branch '<x>' and '<x>/<y>' at once (refs/heads/<x> is a file, not a dir), so
# '<branch>/<slug>' would collide with the project branch. '<branch>.<slug>' is
# collision-free and still lets close-project glob tasks as "<branch>.*".
TASK_ID="${BRANCH}.${TASK_SLUG}"

# Tasks-on-board model: the issue + its sub-branch ARE the task (no project.yaml
# tasks[]). Refuse to task a closed issue; the sub-branch existence check below
# prevents creating a duplicate task for the same issue.
ISSUE_STATE=$(gh issue view "$ISSUE_URL" --json state -q '.state' 2>/dev/null || echo "")
[[ "$ISSUE_STATE" == "CLOSED" ]] && hard_stop "Issue $ISSUE_URL is closed — cannot start a task on it."

echo "Task ID : $TASK_ID"
echo ""

# ── Create sub-branches ───────────────────────────────────────────────────────

# Workspace repo
cd "$REPO_ROOT"
if git rev-parse --verify "$TASK_ID" &>/dev/null; then
  hard_stop "Sub-branch '$TASK_ID' already exists in workspace repo — investigate before proceeding."
fi
git fetch origin "$BRANCH" 2>/dev/null || true
git checkout "$BRANCH"
git checkout -b "$TASK_ID"
git push -u origin "$TASK_ID"
info "Sub-branch '$TASK_ID' pushed to workspace repo"

# Each code repo
TODAY=$(today)
while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping sub-branch creation (clone it first)."
    continue
  fi
  if git -C "$REPO_DIR" rev-parse --verify "$TASK_ID" &>/dev/null; then
    hard_stop "Sub-branch '$TASK_ID' already exists in $repo_url — investigate before proceeding."
  fi
  git -C "$REPO_DIR" fetch origin "$BRANCH" 2>/dev/null || true
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" checkout -b "$TASK_ID"
  git -C "$REPO_DIR" push -u origin "$TASK_ID"
  info "Sub-branch '$TASK_ID' pushed to $repo_url"
done < <(get_project_repos "$PROJECT_YAML")

# ── Assign GitHub Issue ───────────────────────────────────────────────────────

gh issue edit "$ISSUE_URL" --add-assignee "$ASSIGNEE" 2>/dev/null \
  || warn "Could not assign issue to $ASSIGNEE — assign manually."

# ── Mark the task active on the board (tasks-on-board: no project.yaml tasks[]) ──
# The issue + its sub-branch are the task record; reflect it on the board Status.
GHPROJ=$(yaml_get "$PROJECT_YAML" "github_project")
board_set_status "$GHPROJ" "$ISSUE_URL" "In progress" || true

echo ""
echo "=== Task created successfully!"
echo "    Task ID:    $TASK_ID"
echo "    Issue:      $ISSUE_URL"
echo "    Assignee:   $ASSIGNEE"
echo ""
echo "    Sub-branches merge back to '$BRANCH' ONLY — never directly to $DEFAULT_BRANCH."
