#!/usr/bin/env bash
# Script: add-repo
# Purpose: Adds a new repository to an active project when scope expands.
# Usage:   bash add-repo.sh <project_id> <repo_url> <role> <added_reason> [base_branch]
# Compliance: C02 (POL-062 to POL-066)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
REPO_URL="${2:-}"
ROLE="${3:-}"
ADDED_REASON="${4:-}"
BASE_BRANCH="${5:-}"

[[ -n "$PROJECT_ID"    ]] || hard_stop "Usage: $0 <project_id> <repo_url> <role> <added_reason> [base_branch]"
[[ -n "$REPO_URL"      ]] || hard_stop "Usage: $0 <project_id> <repo_url> <role> <added_reason> [base_branch]"
[[ -n "$ROLE"          ]] || hard_stop "Usage: $0 <project_id> <repo_url> <role> <added_reason> [base_branch]"
[[ -n "$ADDED_REASON"  ]] || hard_stop "Usage: $0 <project_id> <repo_url> <role> <added_reason> [base_branch]"

# Validate role value
case "$ROLE" in
  primary|dependency|read-only) ;;
  *) hard_stop "Invalid role '$ROLE'. Must be: primary | dependency | read-only" ;;
esac

echo "=== add-repo: $PROJECT_ID"
echo "    Repo:   $REPO_URL"
echo "    Role:   $ROLE"
echo "    Reason: $ADDED_REASON"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "active"

CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")        # display/audit cache
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "Not authorized: '$CURRENT_USER' needs write access to the project's GitHub Project ($GH_PROJECT)."

# Check repo is not already in the project
python3 - "$PROJECT_YAML" "$REPO_URL" <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1]))
for r in (c.get('repos') or []):
    if r and r.get('url') == sys.argv[2]:
        print(f"Repo already in project: {sys.argv[2]}")
        sys.exit(1)
PY

BRANCH=$(project_branch_for_id "$PROJECT_ID")
TODAY=$(today)

# Prompt for base_branch if not provided. Repo-type-aware default (PRJ-012):
#   gov/workspace repo  → $DEFAULT_BRANCH (main)    — governance lives on the default branch
#   any other code repo → $DEFAULT_CODE_BRANCH (dev) — integration branch for code
if [[ -z "$BASE_BRANCH" ]]; then
  _default_base="$DEFAULT_CODE_BRANCH"
  case "$REPO_URL" in
    *"/$WORKSPACE_REPO" | *"/$WORKSPACE_REPO.git" | *":$WORKSPACE_REPO" | *":$WORKSPACE_REPO.git")
      _default_base="$DEFAULT_BRANCH" ;;
  esac
  printf "  Base branch for '%s' [%s]: " "$REPO_URL" "$_default_base"
  read -r input_base
  BASE_BRANCH="${input_base:-$_default_base}"
fi

REPO_NAME=$(get_repo_name "$REPO_URL")
REPO_DIR="$AGENT_WORK_ROOT/$PROJECT_ID/$REPO_NAME"

# ── Clone and create branch ───────────────────────────────────────────────────

mkdir -p "$AGENT_WORK_ROOT/$PROJECT_ID"

if [[ -e "$REPO_DIR/.git" ]]; then
  info "Already cloned — fetching..."
  git -C "$REPO_DIR" fetch origin
else
  info "Cloning $REPO_URL → $REPO_DIR..."
  git clone "$REPO_URL" "$REPO_DIR" \
    || hard_stop "Clone failed for $REPO_URL"
fi

git -C "$REPO_DIR" checkout "$BASE_BRANCH" \
  || hard_stop "Base branch '$BASE_BRANCH' not found in $REPO_URL"
git -C "$REPO_DIR" pull origin "$BASE_BRANCH" 2>/dev/null || true

if git -C "$REPO_DIR" rev-parse --verify "$BRANCH" &>/dev/null; then
  hard_stop "Branch '$BRANCH' already exists in $REPO_URL — investigate before proceeding."
fi

git -C "$REPO_DIR" checkout -b "$BRANCH"
git -C "$REPO_DIR" push -u origin "$BRANCH" \
  || hard_stop "Failed to push '$BRANCH' to $REPO_URL"
info "Branch '$BRANCH' pushed to $REPO_URL"

# ── Update project.yaml repos[] ──────────────────────────────────────────────

python3 - "$PROJECT_YAML" "$REPO_URL" "$ROLE" "$BASE_BRANCH" "$TODAY" "$ADDED_REASON" <<'PY'
import sys, yaml
pf, url, role, base, today, reason = sys.argv[1:]
with open(pf) as f:
    c = yaml.safe_load(f)
if not c.get('repos'):
    c['repos'] = []
c['repos'].append({
    'url': url, 'role': role, 'base_branch': base,
    'added_at': today, 'added_reason': reason,
})
with open(pf, 'w') as f:
    yaml.dump(c, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY

cd "$REPO_ROOT"
git checkout "$BRANCH"
git add "projects/$PROJECT_ID/project.yaml"
git commit -m "add-repo: $REPO_NAME to $PROJECT_ID"
git push origin "$BRANCH"

echo ""
echo "=== Repo added successfully!"
echo "    Repo:        $REPO_URL"
echo "    Role:        $ROLE"
echo "    Base branch: $BASE_BRANCH"
echo "    Local clone: $REPO_DIR"
