#!/usr/bin/env bash
# Script: cancel
# Purpose: Cancels a project. Archives all branches. No knowledge close.
# Usage:   bash cancel.sh <project_id> <cancellation_reason>
# Compliance: C01 for cancellation_reason requirement (POL-052, POL-070)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
CANCELLATION_REASON="${2:-}"

[[ -n "$PROJECT_ID"           ]] || hard_stop "Usage: $0 <project_id> <cancellation_reason>"
[[ -n "$CANCELLATION_REASON"  ]] || hard_stop "cancellation_reason is required (C01)."

echo "=== cancel: $PROJECT_ID"
echo "    Reason: $CANCELLATION_REASON"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_any_project_status "$PROJECT_YAML" "active" "paused"

CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
LOCKED_BY=$(yaml_get "$PROJECT_YAML" "locked_by")
if [[ -n "$CURRENT_USER" && -n "$LOCKED_BY" && "$CURRENT_USER" != "$LOCKED_BY" ]]; then
  hard_stop "Not authorized: current user '$CURRENT_USER' is not locked_by ('$LOCKED_BY')."
fi

BRANCH="${ORG_SLUG_LOWER}-$(echo "$PROJECT_ID" | sed "s/^${ORG_SLUG}-//")"

confirm "Cancelling '$PROJECT_ID' is irreversible (branches archived, not merged). Continue?"

# ── Archive workspace branch ──────────────────────────────────────────────────

echo "Archiving workspace branch..."
cd "$REPO_ROOT"
git fetch origin "$BRANCH" 2>/dev/null || true
if git rev-parse --verify "$BRANCH" &>/dev/null 2>&1 || git ls-remote --exit-code origin "$BRANCH" &>/dev/null; then
  archive_branch "$REPO_ROOT" "$BRANCH"
else
  warn "Branch '$BRANCH' not found in workspace repo — skipping archive."
fi

# ── Archive each code repo branch ────────────────────────────────────────────

while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    warn "Repo $(get_repo_name "$repo_url") not cloned locally — archiving via remote only."
    REPO_NAME=$(get_repo_name "$repo_url")
    TMP_DIR=$(mktemp -d)
    git clone --branch "$BRANCH" --single-branch "$repo_url" "$TMP_DIR" 2>/dev/null \
      && archive_branch "$TMP_DIR" "$BRANCH" \
      || warn "Could not archive branch '$BRANCH' in $repo_url — archive manually."
    rm -rf "$TMP_DIR"
    continue
  fi
  git -C "$REPO_DIR" fetch origin "$BRANCH" 2>/dev/null || true
  if git -C "$REPO_DIR" rev-parse --verify "$BRANCH" &>/dev/null 2>&1; then
    archive_branch "$REPO_DIR" "$BRANCH"
  else
    warn "Branch '$BRANCH' not found in $(get_repo_name "$repo_url") — skipping archive."
  fi
done < <(get_project_repos "$PROJECT_YAML")

# ── Record cancellation ──────────────────────────────────────────────────────
# project.yaml status is recorded on the project branch (preserved in the
# archive tag). The registry index entry is flipped to 'cancelled' on
# $DEFAULT_BRANCH, where it lives (authored at seed).

TODAY=$(today)
cd "$REPO_ROOT"
if [[ -f "$PROJECT_YAML" ]]; then
  yaml_set "$PROJECT_YAML" "status"               "cancelled"
  yaml_set "$PROJECT_YAML" "cancelled_at"         "$TODAY"
  yaml_set "$PROJECT_YAML" "cancellation_reason"  "$CANCELLATION_REASON"
  git add "projects/$PROJECT_ID/project.yaml"
  if ! git diff --cached --quiet; then
    git commit -m "cancel: $PROJECT_ID — $CANCELLATION_REASON"
    git push origin "$BRANCH" 2>/dev/null || true
  fi
fi

registry_set_status_on_main "$PROJECT_ID" "cancelled"
project_readme_mirror "$PROJECT_ID" "$(yaml_get "$PROJECT_YAML" github_project 2>/dev/null)" "cancelled" \
  "$(yaml_get "$PROJECT_YAML" assigned_to 2>/dev/null)" "$(yaml_get "$PROJECT_YAML" seeded_by 2>/dev/null)" "$BRANCH" || true

echo ""
echo "=== Project cancelled."
echo "    Status:              cancelled"
echo "    cancelled_at:        $TODAY"
echo "    cancellation_reason: $CANCELLATION_REASON"
echo ""
echo "    All code changes are preserved in archive tags (archive/$BRANCH)."
echo "    No knowledge close was run."
