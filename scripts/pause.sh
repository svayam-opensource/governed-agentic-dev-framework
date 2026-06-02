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

BRANCH=$(project_branch_for_id "$PROJECT_ID")

echo "Checking for uncommitted changes..."

check_clean "$REPO_ROOT"

while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  [[ -d "$REPO_DIR/.git" ]] && check_clean "$REPO_DIR"
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
  if [[ -d "$REPO_DIR/.git" ]]; then
    git -C "$REPO_DIR" push origin "$BRANCH" 2>/dev/null || warn "Push skipped for $repo_url (nothing to push)"
  fi
done < <(get_project_repos "$PROJECT_YAML")

# ── Reflect pause in the registry index on the default branch + README mirror ─
# project.yaml status lives on the project branch; the authoritative index lives
# on $DEFAULT_BRANCH. Flip it so `prj list`/`prj status` don't show a paused
# project as active.
registry_set_status_on_main "$PROJECT_ID" "paused"
project_readme_mirror "$PROJECT_ID" "$(yaml_get "$PROJECT_YAML" github_project)" "paused" \
  "$(yaml_get "$PROJECT_YAML" assigned_to)" "$(yaml_get "$PROJECT_YAML" seeded_by)" "$BRANCH" || true

echo ""
echo "=== Project paused."
echo "    Status:    paused"
echo "    paused_at: $TODAY"
echo ""
echo "    Resume with: bash resume.sh $PROJECT_ID"
