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

# The person cancelling must be authorized on the project — assigned_to
# individual or a member of the assigned_to team (GitHub-Project write, POL-046).
# (#62/C11: the old 'locked_by' gate was dead — locked_by is never written by
# any script, so the guard short-circuited on empty → any user could cancel any
# project. Mirror the standard authz used by create-task.sh / seed.sh.)
CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")        # display/audit cache
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "You ($CURRENT_USER) are not authorized on this project — you need write access to its GitHub Project ($GH_PROJECT)."

BRANCH=$(project_branch_for_id "$PROJECT_ID")

confirm "Cancelling '$PROJECT_ID' is irreversible (branches archived, not merged). Continue?"

# ── Archive all branches (continue-on-error, idempotent) ──────────────────────
# #64/H5: archiving is per-repo and must NOT leave inconsistent state. Each repo
# is handled independently: if the 'archive/<branch>' tag already exists the repo
# is treated as already-archived and skipped, so a re-run after a partial failure
# completes cleanly instead of hard-stopping on "tag exists". Failures are
# collected (never abort the loop) so every repo is attempted; the status flip
# below is gated on whether everything that was attempted actually succeeded.

ARCHIVE_FAILURES=()        # human-readable label of each repo that did not archive

# Idempotent wrapper around archive_branch: skips when the archive tag already
# exists (local or remote), and converts a hard_stop into a recorded failure so
# the loop can continue. $1=repo label (for summary), $2=git dir, $3=branch.
archive_branch_safe() {
  local label="$1" dir="$2" branch="$3" tag="archive/$branch"
  if git -C "$dir" rev-parse --verify "refs/tags/$tag" &>/dev/null \
     || git -C "$dir" ls-remote --exit-code --tags origin "$tag" &>/dev/null; then
    info "Archive tag '$tag' already exists in $label — skipping (idempotent)."
    git -C "$dir" branch -D "$branch" 2>/dev/null || true
    return 0
  fi
  # archive_branch hard_stops (exit) on failure; run it in a subshell so a
  # failure becomes a non-zero status we can record rather than aborting cancel.
  if ( archive_branch "$dir" "$branch" ); then
    return 0
  fi
  warn "Failed to archive branch '$branch' in $label — recorded; continuing."
  ARCHIVE_FAILURES+=("$label")
  return 1
}

# ── Archive workspace branch ──────────────────────────────────────────────────

echo "Archiving workspace branch..."
cd "$REPO_ROOT"
git fetch origin "$BRANCH" 2>/dev/null || true
if git rev-parse --verify "$BRANCH" &>/dev/null 2>&1 || git ls-remote --exit-code origin "$BRANCH" &>/dev/null; then
  archive_branch_safe "workspace repo" "$REPO_ROOT" "$BRANCH" || true
else
  warn "Branch '$BRANCH' not found in workspace repo — skipping archive."
fi

# ── Archive each code repo branch ────────────────────────────────────────────

while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  if [[ ! -e "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — archiving via remote only."
    TMP_DIR=$(mktemp -d)
    if git clone --branch "$BRANCH" --single-branch "$repo_url" "$TMP_DIR" 2>/dev/null; then
      archive_branch_safe "$REPO_NAME" "$TMP_DIR" "$BRANCH" || true
    elif git ls-remote --exit-code --tags "$repo_url" "archive/$BRANCH" &>/dev/null; then
      info "Archive tag 'archive/$BRANCH' already exists in $REPO_NAME — skipping (idempotent)."
    else
      warn "Could not archive branch '$BRANCH' in $repo_url — recorded; continuing."
      ARCHIVE_FAILURES+=("$REPO_NAME")
    fi
    rm -rf "$TMP_DIR"
    continue
  fi
  git -C "$REPO_DIR" fetch origin "$BRANCH" 2>/dev/null || true
  if git -C "$REPO_DIR" rev-parse --verify "$BRANCH" &>/dev/null 2>&1 \
     || git -C "$REPO_DIR" rev-parse --verify "refs/tags/archive/$BRANCH" &>/dev/null \
     || git -C "$REPO_DIR" ls-remote --exit-code --tags origin "archive/$BRANCH" &>/dev/null; then
    archive_branch_safe "$REPO_NAME" "$REPO_DIR" "$BRANCH" || true
  else
    warn "Branch '$BRANCH' not found in $REPO_NAME — skipping archive."
  fi
done < <(get_project_repos "$PROJECT_YAML")

# ── Gate the status flip on a clean archive ───────────────────────────────────
# H5: only flip status to 'cancelled' if every repo we attempted archived
# successfully. If any failed, stop BEFORE mutating status so the project stays
# active/paused and the operator can re-run — the re-run is idempotent (already-
# archived repos are skipped) and will complete the remaining repos.
if [[ ${#ARCHIVE_FAILURES[@]} -gt 0 ]]; then
  hard_stop "Archive incomplete for: ${ARCHIVE_FAILURES[*]}. Status NOT changed — re-run cancel after resolving (already-archived repos will be skipped)."
fi

# ── Record cancellation ──────────────────────────────────────────────────────
# project.yaml status is recorded on the project branch (preserved in the
# archive tag). Cancelled status is GitHub-derived: the anchor issue gets the
# 'cancelled' label and the board is closed below (no registry write —
# registry-elimination Increment 2).

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

anchor_set_label add "$(yaml_get "$PROJECT_YAML" github_project 2>/dev/null)" cancelled
project_readme_mirror "$PROJECT_ID" "$(yaml_get "$PROJECT_YAML" github_project 2>/dev/null)" "cancelled" \
  "$(yaml_get "$PROJECT_YAML" assigned_to 2>/dev/null)" "$(yaml_get "$PROJECT_YAML" seeded_by 2>/dev/null)" "$BRANCH" || true

# Close the GitHub Project board so a cancelled project stops reading as active (#56 Facet A).
close_project_board "$GH_PROJECT"

echo ""
echo "=== Project cancelled."
echo "    Status:              cancelled"
echo "    cancelled_at:        $TODAY"
echo "    cancellation_reason: $CANCELLATION_REASON"
echo ""
echo "    All code changes are preserved in archive tags (archive/$BRANCH)."
echo "    No knowledge close was run."
