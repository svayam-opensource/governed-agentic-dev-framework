#!/usr/bin/env bash
# Script: join
# Purpose: Set up an authorized member's OWN per-project workspace on an existing
#          active/paused project. No new NNN, no change to assigned_to or
#          seeded_by — this is how a teammate gets a local working copy under
#          the per-task / team-ownership model (POL-047).
# Usage:   bash join.sh <project_id>
# Compliance: authorization via is_authorized (assigned_to individual or team).

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

PROJECT_ID="${1:-}"
[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id>"

BRANCH=$(project_branch_for_id "$PROJECT_ID")
WORK_ROOT="$(project_work_root "$PROJECT_ID")"
ORG_GOV_DIR="$(org_gov_clone "$PROJECT_ID")"
GOV_REMOTE_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")
[[ -n "$GOV_REMOTE_URL" ]] || hard_stop "No 'origin' remote on the governance repo."

echo "=== join: $PROJECT_ID"
echo "    Branch: $BRANCH"
echo ""

mkdir -p "$WORK_ROOT"

# ── 1. Per-project ORG GOVERNANCE clone (carries the project branch + manifest) ──
if [[ -d "$ORG_GOV_DIR/.git" ]]; then
  info "ORG GOV clone present — fetching '$BRANCH'..."
  git -C "$ORG_GOV_DIR" fetch origin "$BRANCH" 2>/dev/null || true
  git -C "$ORG_GOV_DIR" checkout "$BRANCH" 2>/dev/null \
    || hard_stop "Branch '$BRANCH' not found in existing clone — investigate."
else
  info "Cloning ORG GOVERNANCE → $ORG_GOV_DIR ..."
  git_clone_retry "$GOV_REMOTE_URL" "$ORG_GOV_DIR" || hard_stop "Could not clone the governance repo."
  git -C "$ORG_GOV_DIR" checkout "$BRANCH" 2>/dev/null \
    || hard_stop "Branch '$BRANCH' not found — has $PROJECT_ID been seeded and pushed?"
fi

PROJECT_YAML="$ORG_GOV_DIR/projects/$PROJECT_ID/project.yaml"
[[ -f "$PROJECT_YAML" ]] || hard_stop "project.yaml not found on branch '$BRANCH'."

# ── 2. Authorization + status (per-task / team model) ──
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")
is_authorized "$ASSIGNED_TO" \
  || hard_stop "You are not authorized to join '$PROJECT_ID' (assigned_to: $ASSIGNED_TO)."
require_any_project_status "$PROJECT_YAML" "active" "paused"

# ── 3. Code-repo clones on the project branch ──
while IFS= read -r repo_url; do
  [[ -z "$repo_url" || "$repo_url" == "~" ]] && continue
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  if [[ -d "$REPO_DIR/.git" ]]; then
    info "$REPO_NAME present — fetching '$BRANCH'..."
    git -C "$REPO_DIR" fetch origin "$BRANCH" 2>/dev/null || true
    git -C "$REPO_DIR" checkout "$BRANCH" 2>/dev/null || true
  else
    info "Cloning $REPO_NAME → $REPO_DIR ..."
    if git_clone_retry "$repo_url" "$REPO_DIR"; then
      git -C "$REPO_DIR" checkout "$BRANCH" 2>/dev/null \
        || warn "Branch '$BRANCH' not in $REPO_NAME — check it out manually."
    else
      warn "Clone failed for $repo_url — skipping."
    fi
  fi
done < <(get_project_repos "$PROJECT_YAML")

echo ""
echo "=== Joined $PROJECT_ID."
echo "    cd $ORG_GOV_DIR   (ORG GOVERNANCE clone, on '$BRANCH')"
echo "    code repos under  $WORK_ROOT/"
echo ""
echo "    No NNN allocated; assigned_to / seeded_by unchanged."
echo "    Claim work with  ./prj task <issue-url>  (one assignee per sub-branch)."
echo "    Coordinate via the shared project branch; close is run once by any member."
