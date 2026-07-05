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

# ── 1. Per-project ORG GOVERNANCE worktree (carries the project branch + manifest) ──
# ADR-0001 Phase 2: a worktree of one shared base clone, not a full per-project
# clone. ensure_repo_worktree is backward compatible with an existing clone.
info "Setting up ORG GOVERNANCE worktree → $ORG_GOV_DIR ('$BRANCH')..."
ensure_repo_worktree "$GOV_REMOTE_URL" "$ORG_GOV_DIR" "$BRANCH" \
  || hard_stop "Could not set up the governance worktree for '$BRANCH' — has $PROJECT_ID been seeded and pushed?"

# Carry the joining developer's git identity into the per-project workspace so
# commits + C01 authorization here reflect them, not the ambient global.
set_clone_identity "$ORG_GOV_DIR"

PROJECT_YAML="$ORG_GOV_DIR/projects/$PROJECT_ID/project.yaml"
[[ -f "$PROJECT_YAML" ]] || hard_stop "project.yaml not found on branch '$BRANCH'."

# ── 2. Authorization + status (per-task / team model) ──
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")        # display/audit cache
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "You are not authorized to join '$PROJECT_ID' — you need write access to its GitHub Project ($GH_PROJECT)."
require_any_project_status "$PROJECT_YAML" "active" "paused"

# ── 3. Code-repo worktrees on the project branch ──
while IFS= read -r repo_url; do
  [[ -z "$repo_url" || "$repo_url" == "~" ]] && continue
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  info "Setting up $REPO_NAME worktree → $REPO_DIR ('$BRANCH')..."
  if ensure_repo_worktree "$repo_url" "$REPO_DIR" "$BRANCH"; then
    set_clone_identity "$REPO_DIR"
  else
    warn "Could not set up worktree for $REPO_NAME — skipping."
  fi
done < <(get_project_repos "$PROJECT_YAML")

echo ""
echo "=== Joined $PROJECT_ID  (branch '$BRANCH')."
echo "    No NNN allocated; assigned_to / seeded_by unchanged."
echo ""
echo "── How to start work ──────────────────────────────────────────────────"
echo ""
echo "  1. Enter your per-project workspace:"
echo "       cd $ORG_GOV_DIR"
echo "     (governance clone on '$BRANCH'; code repos are under $WORK_ROOT/)"
echo ""
echo "  2. Read the start-up guidance already on this branch:"
echo "       projects/$PROJECT_ID/agent.md     — project entrypoint"
echo "       CLAUDE.md / AGENTS.md             — universal session-start protocol"
echo ""
echo "  3. Load the knowledge layers fresh (highest priority first):"
echo "       knowledge/                                      (org-wide, read-only)"
echo "       projects/$PROJECT_ID/knowledge/                 (this project)"
echo "       <repo>/knowledge/                               (each code repo)"
echo "       $AGENT_WORK_ROOT/preferences/<your-gh-login>.md (your preferences)"
echo ""
echo "  4. Confirm authorization: you have write access to the project's GitHub"
echo "     Project board (project status must be active or paused)."
echo ""
echo "  5. Claim work — open a task sub-branch for a board issue:"
echo "       ./prj task <issue-url>      (or run ./prj start)"
echo ""
echo "  Coordinate via the shared '$BRANCH' branch; close is run once by any member."
