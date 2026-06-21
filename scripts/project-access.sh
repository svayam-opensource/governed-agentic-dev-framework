#!/usr/bin/env bash
# Script: project-access
# Purpose: Grant or revoke WRITE access on a GitHub Project v2 — the ADR-0001
#          Phase 3 source of truth for assignment (access = authorization).
#          Wraps lib.sh's gh_* helpers so the prj CLI (which does not source
#          lib.sh) can sync GitHub access from `manage assign/unassign/reassign`.
# Usage:   bash project-access.sh <grant|revoke> <github_project_url> <login-or-@team>
# Note:    MUTATES real GitHub Project permissions.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

ACTION="${1:-}"; URL="${2:-}"; WHO="${3:-}"
[[ -n "$ACTION" && -n "$URL" && -n "$WHO" ]] \
  || hard_stop "Usage: $0 <grant|revoke> <github_project_url> <login-or-@team>"

case "$ACTION" in
  grant)  ROLE=WRITER ;;
  revoke) ROLE=NONE ;;
  *)      hard_stop "Unknown action '$ACTION' (expected grant|revoke)." ;;
esac

PROJ_ID=$(gh_project_node_id "$URL") \
  || hard_stop "Could not resolve a GitHub Project from '$URL' (check access / token scopes)."

ACTOR=$(gh_resolve_actor "$WHO") \
  || hard_stop "Could not resolve '$WHO' to a GitHub user or team. Use a GitHub login, or '@team-slug'."
read -r KIND AID <<< "$ACTOR"

if gh_project_set_access "$PROJ_ID" "$KIND" "$AID" "$ROLE"; then
  info "GitHub Project access: ${ACTION}ed '$WHO' ($KIND) — role $ROLE."
else
  hard_stop "GitHub API call failed. Set access manually in the Project's Manage access."
fi
