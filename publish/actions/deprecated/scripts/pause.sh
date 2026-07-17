#!/usr/bin/env bash
# Script: pause
# Purpose: Transitions a project from ACTIVE to PAUSED.
#          Preserves all state for later resumption.
# Usage:   bash pause.sh <project_id>
# Compliance: C02 (POL-049, POL-051)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id>"

echo "=== pause: $PROJECT_ID"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "active"

CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")        # display/audit cache
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "Not authorized to pause — '$CURRENT_USER' needs write access to the project's GitHub Project ($GH_PROJECT)."

BRANCH=$(project_branch_for_id "$PROJECT_ID")

echo "Checking for uncommitted changes..."

check_clean "$REPO_ROOT"

while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  [[ -e "$REPO_DIR/.git" ]] && check_clean "$REPO_DIR"
done < <(get_project_repos "$PROJECT_YAML")

info "All repos are clean."

# ── Update project.yaml ───────────────────────────────────────────────────────

TODAY=$(today)
yaml_set "$PROJECT_YAML" "status"    "paused"
yaml_set "$PROJECT_YAML" "paused_at" "$TODAY"

# ── Push all branches ─────────────────────────────────────────────────────────

cd "$REPO_ROOT"
git checkout "$BRANCH"
git add "projects/$PROJECT_ID/project.yaml"
git commit -m "pause: $PROJECT_ID"
git push origin "$BRANCH"

while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  if [[ -e "$REPO_DIR/.git" ]]; then
    git -C "$REPO_DIR" push origin "$BRANCH" 2>/dev/null || warn "Push skipped for $repo_url (nothing to push)"
  fi
done < <(get_project_repos "$PROJECT_YAML")

# ── Reflect pause on GitHub (the status SoT) + README mirror ──────────────────
# paused = board OPEN + anchor issue carries the 'paused' label. No registry
# write (registry-elimination Increment 2); `prj list`/`prj status` derive the
# paused state from the anchor label.
anchor_set_label add "$(yaml_get "$PROJECT_YAML" github_project)" paused
anchor_set_state "$(yaml_get "$PROJECT_YAML" github_project)" paused
project_readme_mirror "$PROJECT_ID" "$(yaml_get "$PROJECT_YAML" github_project)" "paused" \
  "$(yaml_get "$PROJECT_YAML" assigned_to)" "$(yaml_get "$PROJECT_YAML" seeded_by)" "$BRANCH" || true

echo ""
echo "=== Project paused."
echo "    Status:    paused"
echo "    paused_at: $TODAY"
echo ""
echo "    Resume with: bash resume.sh $PROJECT_ID"
