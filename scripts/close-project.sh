#!/usr/bin/env bash
# Script: close-project
# Purpose: Closes project work. Validates completion, merges branches to base,
#          archives, then triggers close-knowledge.
# Usage:   bash close-project.sh <project_id>
# Compliance: C01 for pre-close gate (POL-087 to POL-096)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id>"

echo "=== close-project: $PROJECT_ID"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
PROJECT_DIR=$(get_project_dir "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── C01 Pre-close Gate ────────────────────────────────────────────────────────

echo "[ C01 ] Running pre-close gate..."
GATE_FAILURES=()

# 1. knowledge/ contains at least one file
KNOWLEDGE_DIR="$PROJECT_DIR/knowledge"
if [[ ! -d "$KNOWLEDGE_DIR" ]] || [[ -z "$(find "$KNOWLEDGE_DIR" -type f 2>/dev/null)" ]]; then
  GATE_FAILURES+=("projects/$PROJECT_ID/knowledge/ is empty — document project learnings first.")
fi

# 2. compliance.md exists
if [[ ! -f "$KNOWLEDGE_DIR/compliance.md" ]]; then
  GATE_FAILURES+=("projects/$PROJECT_ID/knowledge/compliance.md is missing — required before close.")
fi

# 3. project.yaml mandatory fields populated
for field in id slug assigned_to seeded_by started_at; do
  val=$(yaml_get "$PROJECT_YAML" "$field")
  [[ -z "$val" || "$val" == "~" ]] && GATE_FAILURES+=("project.yaml field '$field' is not populated.")
done

if [[ ${#GATE_FAILURES[@]} -gt 0 ]]; then
  echo "" >&2
  echo "[ C01 ] Pre-close gate FAILED:" >&2
  for f in "${GATE_FAILURES[@]}"; do
    echo "    - $f" >&2
  done
  hard_stop "Fix the above issues before closing the project."
fi

echo "[ C01 ] Pre-close gate passed."
echo ""

# Allow re-runs after partial failure: status may be 'active' (first run)
# or 'completed' (re-run after step 2/3 succeeded but later step failed).
require_any_project_status "$PROJECT_YAML" "active" "completed"

BRANCH=$(project_branch_for_id "$PROJECT_ID")
TODAY=$(today)

# Tasks-on-board: a task is a sub-branch (<branch>.<task-slug>). Refuse to close
# while any remain unmerged — merge them (prj merge) or cancel first. The "$BRANCH.*"
# glob matches task sub-branches only (not "$BRANCH" itself, nor "$BRANCH-knowledge").
OPEN_TASKS=$(git -C "$REPO_ROOT" ls-remote --heads origin "$BRANCH.*" 2>/dev/null | awk '{print $2}' | sed 's|refs/heads/||')
[[ -n "$OPEN_TASKS" ]] && hard_stop "Unmerged task sub-branches exist — merge or cancel them first:
$OPEN_TASKS"

# ── Update state on project branch (so the gate validates it) ────────────────

echo "Updating project state on '$BRANCH'..."
cd "$REPO_ROOT"
git fetch origin "$DEFAULT_BRANCH"
git fetch origin "$BRANCH" 2>/dev/null || true
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH" 2>/dev/null || true

# Sync project branch with latest default — needed to pick up registry.yaml updates
# from any other projects that closed after this one was seeded.
if ! git merge --no-edit "origin/$DEFAULT_BRANCH" 2>/dev/null; then
  echo ""
  echo "MERGE CONFLICT: $DEFAULT_BRANCH → $BRANCH in workspace repo."
  echo "Resolve conflicts manually, commit, then re-run: bash close-project.sh $PROJECT_ID"
  exit 2
fi

yaml_set "$PROJECT_YAML" "status"       "completed"
yaml_set "$PROJECT_YAML" "completed_at" "$TODAY"

# project.yaml status lives on the project branch (merges to $DEFAULT_BRANCH
# below). The registry index entry lives on $DEFAULT_BRANCH (authored at seed)
# and is flipped to 'completed' after the merge, near the end of this script.
git add "projects/$PROJECT_ID/project.yaml"
if ! git diff --cached --quiet; then
  git commit -m "close-project: $PROJECT_ID — mark completed"
  git push origin "$BRANCH"
fi

# ── Merge each code repo branch → base_branch ────────────────────────────────

echo ""
echo "Merging code repo branches..."

while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  REPO_BASE=$(get_repo_base_branch "$PROJECT_YAML" "$repo_url")

  if [[ ! -d "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping merge (merge manually)."
    continue
  fi

  echo "Merging '$BRANCH' → '$REPO_BASE' in $REPO_NAME..."
  git -C "$REPO_DIR" fetch origin "$REPO_BASE"
  git -C "$REPO_DIR" fetch origin "$BRANCH" 2>/dev/null || true
  git -C "$REPO_DIR" checkout "$REPO_BASE"
  if ! git -C "$REPO_DIR" merge --no-edit "$BRANCH" 2>/dev/null; then
    echo ""
    echo "MERGE CONFLICT: $BRANCH → $REPO_BASE in $REPO_NAME."
    echo "Resolve conflicts manually, commit, then re-run: bash close-project.sh $PROJECT_ID"
    exit 2
  fi
  git -C "$REPO_DIR" push origin "$REPO_BASE"
  info "$REPO_NAME: merged successfully."
done < <(get_project_repos "$PROJECT_YAML")

# ── Test-merge gate: $BRANCH → $DEFAULT_BRANCH (workspace repo only) ─────────

echo ""
echo "Running test-merge gate for workspace repo..."
bash "$SCRIPT_DIR/test-merge.sh" "$BRANCH"

# ── Push $DEFAULT_BRANCH ──────────────────────────────────────────────────────

cd "$REPO_ROOT"
git push origin "$DEFAULT_BRANCH"

# ── Flip the registry index entry to completed (on $DEFAULT_BRANCH) + mirror ──
registry_set_status_on_main "$PROJECT_ID" "completed"
project_readme_mirror "$PROJECT_ID" "$(yaml_get "$PROJECT_YAML" github_project)" "completed" \
  "$(yaml_get "$PROJECT_YAML" assigned_to)" "$(yaml_get "$PROJECT_YAML" seeded_by)" "$BRANCH" || true

# ── Archive branches ──────────────────────────────────────────────────────────

echo ""
echo "Archiving branches..."

archive_branch "$REPO_ROOT" "$BRANCH"

while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  [[ -d "$REPO_DIR/.git" ]] && archive_branch "$REPO_DIR" "$BRANCH"
done < <(get_project_repos "$PROJECT_YAML")

echo ""
echo "=== Project closed."
echo "    Status:       completed"
echo "    completed_at: $TODAY"
echo ""

# ── Automatically trigger close-knowledge ────────────────────────────────────

echo "Triggering close-knowledge..."
bash "$(dirname "$0")/close-knowledge.sh" "$PROJECT_ID"
