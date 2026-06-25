#!/usr/bin/env bash
# Script: resume
# Purpose: Transitions a project from PAUSED to ACTIVE with mandatory base sync.
# Usage:   bash resume.sh <project_id>
# Compliance: C01 for knowledge sync (POL-122); C02 for state transition (POL-049, POL-051)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id>"

echo "=== resume: $PROJECT_ID"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "paused"

ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")        # display/audit cache
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "Not authorized to resume — you need write access to the project's GitHub Project ($GH_PROJECT)."

BRANCH=$(project_branch_for_id "$PROJECT_ID")

# ── C01: Mandatory DEFAULT_BRANCH sync for workspace repo ────────────────────

echo "[ C01 ] Syncing workspace repo: $DEFAULT_BRANCH → $BRANCH..."
cd "$REPO_ROOT"
git fetch origin "$DEFAULT_BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"

# Merge DEFAULT_BRANCH into project branch — exit 2 on conflict (caller resolves)
if ! git merge --no-edit "origin/$DEFAULT_BRANCH" 2>/dev/null; then
  echo ""
  echo "MERGE CONFLICT: $DEFAULT_BRANCH → $BRANCH in workspace repo."
  echo "Resolve conflicts manually, commit, then re-run: bash resume.sh $PROJECT_ID"
  exit 2
fi
git push origin "$BRANCH"
info "Workspace repo synced."

# ── C01: Mandatory base_branch sync for each code repo ───────────────────────

while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  REPO_BASE=$(get_repo_base_branch "$PROJECT_YAML" "$repo_url")

  if [[ ! -e "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping sync."
    continue
  fi

  echo "[ C01 ] Syncing $REPO_NAME: $REPO_BASE → $BRANCH..."
  git -C "$REPO_DIR" fetch origin "$REPO_BASE"
  git -C "$REPO_DIR" checkout "$BRANCH"
  if ! git -C "$REPO_DIR" merge --no-edit "origin/$REPO_BASE" 2>/dev/null; then
    echo ""
    echo "MERGE CONFLICT: $REPO_BASE → $BRANCH in $REPO_NAME."
    echo "Resolve conflicts manually, commit, then re-run: bash resume.sh $PROJECT_ID"
    exit 2
  fi
  git -C "$REPO_DIR" push origin "$BRANCH"
  info "$REPO_NAME synced."
done < <(get_project_repos "$PROJECT_YAML")

# ── Update project.yaml ───────────────────────────────────────────────────────

yaml_set "$PROJECT_YAML" "paused_at" "~"
yaml_set "$PROJECT_YAML" "status"    "active"

TODAY=$(today)

cd "$REPO_ROOT"
git checkout "$BRANCH"
git add "projects/$PROJECT_ID/project.yaml"
git commit -m "resume: $PROJECT_ID (synced with $DEFAULT_BRANCH)"
git push origin "$BRANCH"

# ── Reflect resume on GitHub (the status SoT) + README mirror ─────────────────
# active = board OPEN + anchor issue NO LONGER carries 'paused'. No registry
# write (registry-elimination Increment 2).
anchor_set_label remove "$(yaml_get "$PROJECT_YAML" github_project)" paused
project_readme_mirror "$PROJECT_ID" "$(yaml_get "$PROJECT_YAML" github_project)" "active" \
  "$ASSIGNED_TO" "$(yaml_get "$PROJECT_YAML" seeded_by)" "$BRANCH" || true

echo ""
echo "=== Project resumed."
echo "    Status: active"
echo "    All branches synced with their base branches."
echo ""
echo "[ C01 ] Reload all four knowledge layers fresh before starting work:"
echo "    1. $WORKSPACE_REPO/knowledge/"
echo "    2. $WORKSPACE_REPO/projects/$PROJECT_ID/knowledge/"
echo "    3. <repo>/knowledge/ for each repo"
echo "    4. \$PRJ_GOV_LOC/preferences/<your-gh-login>.md  (your own only)"
