#!/usr/bin/env bash
# Script: create-task
# Purpose: Creates a sub-branch for parallel work on one or more GitHub Issues.
# Usage:   bash create-task.sh <project_id> <issue_url[,issue_url2,...]> <assignee>
# Compliance: C02 (POL-070, POL-073 to POL-075)
#
# Scheme B (POL-070): the sub-branch is keyed on the GitHub issue NUMBER(s):
#   <project-branch>.ISSUE-<n>            (single issue)
#   <project-branch>.ISSUE-<n1>-<n2>-...  (combined branch for related issues)
# Repo-on-demand: an issue whose repo isn't yet in the project is brought in
# automatically (add-repo), so new-repo issues "just work" — no manual add-repo.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
ISSUE_ARG="${2:-}"     # one URL, or a comma-separated list for a combined branch
ASSIGNEE="${3:-}"

[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id> <issue_url[,issue_url2,...]> <assignee>"
[[ -n "$ISSUE_ARG"  ]] || hard_stop "Usage: $0 <project_id> <issue_url[,issue_url2,...]> <assignee>"
[[ -n "$ASSIGNEE"   ]] || hard_stop "Usage: $0 <project_id> <issue_url[,issue_url2,...]> <assignee>"

# Split the (comma-separated) issue list into an array, trimming whitespace.
ISSUE_URLS=()
while IFS= read -r __u || [[ -n "$__u" ]]; do
  __u="${__u#"${__u%%[![:space:]]*}"}"; __u="${__u%"${__u##*[![:space:]]}"}"
  [[ -n "$__u" ]] && ISSUE_URLS+=("$__u")
done < <(printf '%s' "$ISSUE_ARG" | tr ',' '\n')
[[ ${#ISSUE_URLS[@]} -gt 0 ]] || hard_stop "No issue URLs given."

echo "=== create-task: $PROJECT_ID"
echo "    Issues:   ${ISSUE_URLS[*]}"
echo "    Assignee: $ASSIGNEE"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "active"

# Derive the project branch (reads the stored registry branch field; see lib.sh).
BRANCH=$(project_branch_for_id "$PROJECT_ID")

# Normalize a git remote URL to a comparable "owner/repo" tail (lowercased, no
# scheme/host/.git/trailing-slash) so https and git@ forms compare equal.
normalize_repo_url() {
  local u="$1"
  u="${u%.git}"; u="${u%/}"
  u="${u#git@*:}"; u="${u#https://*/}"; u="${u#http://*/}"
  printf '%s' "$(printf '%s' "$u" | tr '[:upper:]' '[:lower:]')"
}

# True if the given repo URL is already in the project's repos[].
repo_in_project() {
  local target; target="$(normalize_repo_url "$1")"
  local r
  while IFS= read -r r; do
    [[ "$(normalize_repo_url "$r")" == "$target" ]] && return 0
  done < <(get_project_repos "$PROJECT_YAML")
  return 1
}

# ── Per-issue validation + repo-on-demand ─────────────────────────────────────
# For each issue: refuse if closed; ensure its repo is in the project (auto-add
# unless it's the workspace repo, which create_subbranch_in handles directly).
ISSUE_NUMS=()
for ISSUE_URL in "${ISSUE_URLS[@]}"; do
  ISSUE_NUM=$(printf '%s' "$ISSUE_URL" | grep -oE '/issues/[0-9]+' | grep -oE '[0-9]+$') \
    || hard_stop "Could not extract an issue number from '$ISSUE_URL'."
  [[ -n "$ISSUE_NUM" ]] || hard_stop "Could not extract an issue number from '$ISSUE_URL'."
  ISSUE_NUMS+=("$ISSUE_NUM")

  # Tasks-on-board: the issue + its sub-branch ARE the task. Refuse a closed issue.
  ISSUE_STATE=$(gh issue view "$ISSUE_URL" --json state -q '.state' 2>/dev/null || echo "")
  [[ "$ISSUE_STATE" == "CLOSED" ]] && hard_stop "Issue $ISSUE_URL is closed — cannot start a task on it."

  ISSUE_REPO_URL=$(echo "$ISSUE_URL" | sed 's|/issues/[0-9]*$||')
  if [[ -n "$ORG_REPO_URL" && "$(normalize_repo_url "$ISSUE_REPO_URL")" == "$(normalize_repo_url "$ORG_REPO_URL")" ]]; then
    info "Issue #$ISSUE_NUM is on the workspace repo (POL-057, C5) — no add-repo needed."
  elif repo_in_project "$ISSUE_REPO_URL"; then
    : # already a project repo
  else
    info "Issue #$ISSUE_NUM is in '$ISSUE_REPO_URL', not yet in the project — bringing it in (repo-on-demand)."
    bash "$SCRIPTS/add-repo.sh" "$PROJECT_ID" "$ISSUE_REPO_URL" "dependency" \
      "auto: brought in for task on issue #$ISSUE_NUM" "${DEFAULT_CODE_BRANCH:-dev}" \
      || hard_stop "Could not bring in '$ISSUE_REPO_URL' (check access), required to task issue #$ISSUE_NUM."
  fi
done

# Combined sub-branch name: numbers sorted ascending, de-duplicated, joined by '-'.
# NOTE the '.' separator (not '/'): git refuses to hold a branch '<x>' and
# '<x>/<y>' at once (refs/heads/<x> is a file, not a dir), so '<branch>/<...>'
# would collide with the project branch. '<branch>.ISSUE-...' is collision-free
# and still lets close-project glob tasks as "<branch>.*".
SUFFIX=$(printf '%s\n' "${ISSUE_NUMS[@]}" | sort -n -u | paste -sd '-' -)
TASK_ID="${BRANCH}.ISSUE-${SUFFIX}"

# The person creating the task must be authorized on the project — write access to
# its GitHub Project board (the authoritative gate; assigned_to is a display cache).
CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "You ($CURRENT_USER) are not authorized on this project — you need write access to its GitHub Project ($GH_PROJECT)."

echo "Task ID : $TASK_ID"
echo ""

# ── Create sub-branches ───────────────────────────────────────────────────────

# Multi-repo branch creation is not atomic (H5): a failure on repo K used to leave
# repos 1..K-1 with branches created+pushed and no way to recover, and a re-run then
# hard-stopped on "branch already exists". We now (a) track every local/remote branch
# this run creates and roll them back on failure via an EXIT trap (mirrors seed.sh),
# and (b) treat a pre-existing sub-branch that already points at the expected base as
# a resumable no-op instead of a hard stop. Branches created by a *previous* successful
# run are left untouched on rollback (only this run's creations are reverted).
CREATED_LOCAL_BRANCHES=()    # '<repo_path>|<branch>'
PUSHED_REMOTE_BRANCHES=()    # '<repo_path>|<branch>'
TASK_OK=0

run_rollback() {
  local exit_code=$?
  if [[ "$TASK_OK" == "1" ]]; then return 0; fi
  if [[ ${#CREATED_LOCAL_BRANCHES[@]} -eq 0 && ${#PUSHED_REMOTE_BRANCHES[@]} -eq 0 ]]; then
    return 0
  fi
  echo ""
  warn "create-task failed (exit $exit_code). Rolling back sub-branches created this run..."

  # Delete remote branches this run pushed.
  for ((i=${#PUSHED_REMOTE_BRANCHES[@]}-1; i>=0; i--)); do
    local entry="${PUSHED_REMOTE_BRANCHES[$i]}"
    local path="${entry%%|*}"
    local branch="${entry#*|}"
    git -C "$path" push origin --delete "$branch" 2>/dev/null || true
  done

  # Delete local branches this run created (switch off them first).
  for ((i=${#CREATED_LOCAL_BRANCHES[@]}-1; i>=0; i--)); do
    local entry="${CREATED_LOCAL_BRANCHES[$i]}"
    local path="${entry%%|*}"
    local branch="${entry#*|}"
    if [[ -d "$path/.git" ]]; then
      local current=$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      if [[ "$current" == "$branch" ]]; then
        git -C "$path" checkout "$BRANCH" 2>/dev/null \
          || git -C "$path" checkout "$DEFAULT_BRANCH" 2>/dev/null || true
      fi
      git -C "$path" branch -D "$branch" 2>/dev/null || true
    fi
  done

  warn "Rollback complete. Sub-branches created this run were deleted."
}

trap 'run_rollback' EXIT

# Create (or resume) the sub-branch in one repo. If the sub-branch already exists
# and points at the expected base ($BRANCH), treat it as already-done (resumable).
# If it exists but diverges from the base, hard-stop for investigation.
create_subbranch_in() {
  local path="$1" label="$2"
  git -C "$path" fetch origin "$BRANCH" 2>/dev/null || true
  if git -C "$path" rev-parse --verify "$TASK_ID" &>/dev/null; then
    local task_sha base_sha
    task_sha=$(git -C "$path" rev-parse "$TASK_ID" 2>/dev/null || echo "")
    base_sha=$(git -C "$path" rev-parse "origin/$BRANCH" 2>/dev/null \
               || git -C "$path" rev-parse "$BRANCH" 2>/dev/null || echo "")
    if [[ -n "$task_sha" && "$task_sha" == "$base_sha" ]]; then
      info "Sub-branch '$TASK_ID' already exists at base in $label — resuming (no-op)."
      return 0
    fi
    hard_stop "Sub-branch '$TASK_ID' already exists in $label and diverges from '$BRANCH' — investigate before proceeding."
  fi
  git -C "$path" checkout "$BRANCH"
  git -C "$path" checkout -b "$TASK_ID"
  CREATED_LOCAL_BRANCHES+=("$path|$TASK_ID")
  git -C "$path" push -u origin "$TASK_ID"
  PUSHED_REMOTE_BRANCHES+=("$path|$TASK_ID")
  info "Sub-branch '$TASK_ID' pushed to $label"
}

# Workspace repo
create_subbranch_in "$REPO_ROOT" "workspace repo"

# Each code repo (re-read after any repo-on-demand add above).
TODAY=$(today)
while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  if [[ ! -e "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping sub-branch creation (clone it first)."
    continue
  fi
  create_subbranch_in "$REPO_DIR" "$repo_url"
done < <(get_project_repos "$PROJECT_YAML")

# All sub-branches created (or already present at base) — disarm rollback so the
# post-branch board/issue steps below don't trigger branch deletion on a soft failure.
TASK_OK=1
trap - EXIT

# ── Assign + mark active on the board, per issue ──────────────────────────────
# The issue + its sub-branch are the task record (tasks-on-board: no project.yaml
# tasks[]); reflect each issue on the board Status.
GHPROJ=$(yaml_get "$PROJECT_YAML" "github_project")
for ISSUE_URL in "${ISSUE_URLS[@]}"; do
  gh issue edit "$ISSUE_URL" --add-assignee "$ASSIGNEE" 2>/dev/null \
    || warn "Could not assign $ISSUE_URL to $ASSIGNEE — assign manually."
  board_set_status "$GHPROJ" "$ISSUE_URL" "In progress" || true
done

echo ""
echo "=== Task created successfully!"
echo "    Task ID:    $TASK_ID"
echo "    Issues:     ${ISSUE_URLS[*]}"
echo "    Assignee:   $ASSIGNEE"
echo ""
echo "    Sub-branches merge back to '$BRANCH' ONLY — never directly to $DEFAULT_BRANCH."
