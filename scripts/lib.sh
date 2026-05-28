#!/usr/bin/env bash
# Shared library for all Agentic Development Framework scripts.
# Source this at the top of each script:
#   source "$(dirname "$0")/lib.sh"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$REPO_ROOT/org-config.yaml"
REGISTRY="$REPO_ROOT/registry.yaml"

# ── Dependency check ─────────────────────────────────────────────────────────

check_deps() {
  local missing=()
  for dep in git gh yq python3; do
    command -v "$dep" &>/dev/null || missing+=("$dep")
  done
  # yq optional if python3 present; python3 optional if yq present
  local missing_str=" ${missing[*]:-} "
  if [[ "$missing_str" == *" yq "* && "$missing_str" != *" python3 "* ]]; then
    missing=("${missing[@]/yq}")   # python3 covers for yq
  fi
  missing_str=" ${missing[*]:-} "
  if [[ "$missing_str" == *" python3 "* && "$missing_str" != *" yq "* ]]; then
    missing=("${missing[@]/python3}")  # yq covers for python3
  fi
  # Remove empty entries
  local truly_missing=()
  for m in "${missing[@]:-}"; do [[ -n "$m" ]] && truly_missing+=("$m"); done

  if [[ ${#truly_missing[@]} -gt 0 ]]; then
    echo "" >&2
    echo "Missing dependencies: ${truly_missing[*]}" >&2
    echo "Run: bash scripts/install-deps.sh" >&2
    exit 1
  fi
}

# ── Config ────────────────────────────────────────────────────────────────────

load_config() {
  check_deps
  if command -v yq &>/dev/null; then
    ORG_NAME=$(yq '.org_name'           "$CONFIG")
    ORG_SLUG=$(yq '.org_slug'           "$CONFIG")
    ORG_SLUG_LOWER=$(yq '.org_slug_lower' "$CONFIG")
    GITHUB_ORG=$(yq '.github_org'       "$CONFIG")
    WORKSPACE_REPO=$(yq '.workspace_repo' "$CONFIG")
    DEFAULT_BRANCH=$(yq '.default_branch' "$CONFIG")
    DEFAULT_CODE_BRANCH=$(yq '.default_code_branch' "$CONFIG")
    POLICY_OWNER_EMAIL=$(yq '.policy_owner_email' "$CONFIG")
  else
    _py() { python3 -c "import yaml; print(yaml.safe_load(open('$CONFIG'))['$1'])"; }
    ORG_NAME=$(_py org_name)
    ORG_SLUG=$(_py org_slug)
    ORG_SLUG_LOWER=$(_py org_slug_lower)
    GITHUB_ORG=$(_py github_org)
    WORKSPACE_REPO=$(_py workspace_repo)
    DEFAULT_BRANCH=$(_py default_branch)
    DEFAULT_CODE_BRANCH=$(_py default_code_branch)
    POLICY_OWNER_EMAIL=$(_py policy_owner_email)
  fi
  export ORG_NAME ORG_SLUG ORG_SLUG_LOWER GITHUB_ORG WORKSPACE_REPO \
         DEFAULT_BRANCH DEFAULT_CODE_BRANCH POLICY_OWNER_EMAIL

  # Project-governance root: where Gov.local, per-project clones, and developer
  # preferences live. Resolution: $PRJ_GOV_LOC > legacy $AGENT_WORK_ROOT >
  # default ~/prj_gov. It lives in the shell environment (not a config file) to
  # avoid a bootstrap cycle with the per-user preferences kept under it.
  PRJ_GOV_LOC="${PRJ_GOV_LOC:-${AGENT_WORK_ROOT:-$HOME/prj_gov}}"
  export PRJ_GOV_LOC
  # Back-compat alias: older scripts/users reference AGENT_WORK_ROOT as the
  # project-clones root. Keep it pointing at the same place until the layout
  # migration lands.
  AGENT_WORK_ROOT="${AGENT_WORK_ROOT:-$PRJ_GOV_LOC}"
  export AGENT_WORK_ROOT

  # Lazy-create the current user's prefs file if setup.sh didn't already.
  # No-op if gh login is unavailable; the file gets created on a later run
  # once gh is configured. Failures here are non-fatal — preferences are C03.
  ensure_user_prefs_file 2>/dev/null || true
}

# Resolve the current developer's preferences file path.
# Returns the path on stdout, or empty string if no gh login is available.
# Callers that need the file should also call ensure_user_prefs_file to
# lazily create it from the template when missing.
current_user_prefs_path() {
  local login
  login=$(gh api user --jq .login 2>/dev/null || echo "")
  [[ -z "$login" ]] && return 0
  echo "$PRJ_GOV_LOC/preferences/$login.md"
}

# Lazily create the current user's prefs file from the template if absent.
# No-op if:
#   - gh login is unavailable, OR
#   - the prefs file already exists, OR
#   - the template still contains {{PLACEHOLDER}} markers (workspace is
#     in template state, not yet configured by setup.sh — copying now
#     would persist unresolved placeholders into the user's prefs).
ensure_user_prefs_file() {
  local path template
  path=$(current_user_prefs_path)
  [[ -z "$path" ]] && return 0
  [[ -f "$path" ]] && return 0
  template="$REPO_ROOT/knowledge/guidance/preferences-template.md"
  [[ -f "$template" ]] || return 0
  # Refuse to seed from an un-substituted template. setup.sh is the
  # right tool to substitute placeholders; only then can we copy.
  if grep -q '{{[A-Z_a-z0-9]\+}}' "$template" 2>/dev/null; then
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  cp "$template" "$path"
}

# ── Terminal helpers ──────────────────────────────────────────────────────────

hard_stop() {
  echo "" >&2
  echo "HARD STOP [C01]: $*" >&2
  exit 1
}

warn() { echo "WARNING [C02]: $*"; }

info() { echo "  $*"; }

confirm() {
  local _ans
  printf "%s [y/N] " "$*"
  if ! IFS= read -r _ans; then
    echo ""
    echo "Aborted (no input)."
    exit 1
  fi
  if [[ "$_ans" != [yY] && "$_ans" != [yY][eE][sS] ]]; then
    echo "Aborted."
    exit 1
  fi
}

# ── String helpers ────────────────────────────────────────────────────────────

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-//;s/-$//'
}

today() { date +%Y-%m-%d; }

# ── YAML read/write ───────────────────────────────────────────────────────────

yaml_get() {
  local file="$1" key="$2"
  if command -v yq &>/dev/null; then
    local v
    v=$(yq ".$key" "$file" 2>/dev/null)
    [[ "$v" == "null" ]] && echo "" || echo "$v"
  else
    python3 - "$file" "$key" <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1]))
v = c
for k in sys.argv[2].split('.'):
    v = (v or {}).get(k) if isinstance(v, dict) else None
print('' if v is None else v)
PY
  fi
}

yaml_set() {
  local file="$1" key="$2" value="$3"
  if command -v yq &>/dev/null; then
    if [[ "$value" == "~" || "$value" == "null" ]]; then
      yq -i ".$key = null" "$file"
    else
      yq -i ".$key = \"$value\"" "$file"
    fi
  else
    python3 - "$file" "$key" "$value" <<'PY'
import sys, yaml
file, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
c = yaml.safe_load(open(file))
c[key] = None if value in ('~', 'null') else value
with open(file, 'w') as f:
    yaml.dump(c, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY
  fi
}

# ── Project YAML helpers ──────────────────────────────────────────────────────

get_project_yaml() { echo "$REPO_ROOT/projects/$1/project.yaml"; }
get_project_dir()  { echo "$REPO_ROOT/projects/$1"; }

check_project_exists() {
  local pf; pf=$(get_project_yaml "$1")
  [[ -f "$pf" ]] || hard_stop "project.yaml not found: $pf"
}

require_project_status() {
  local pf="$1" expected="$2"
  local s; s=$(yaml_get "$pf" "status")
  [[ "$s" == "$expected" ]] || hard_stop "Project status is '$s', expected '$expected'"
}

require_any_project_status() {
  local pf="$1"; shift
  local s; s=$(yaml_get "$pf" "status")
  for e in "$@"; do [[ "$s" == "$e" ]] && return 0; done
  hard_stop "Project status is '$s', expected one of: $*"
}

# Print one repo URL per line from project.yaml repos[]
get_project_repos() {
  python3 - "$1" <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1]))
for r in (c.get('repos') or []):
    if r and r.get('url'):
        print(r['url'])
PY
}

# Print base_branch for a specific repo URL
get_repo_base_branch() {
  python3 - "$1" "$2" <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1]))
for r in (c.get('repos') or []):
    if r and r.get('url') == sys.argv[2]:
        print(r.get('base_branch') or 'dev')
        sys.exit(0)
print('dev')
PY
}

get_repo_name() { basename "$1" .git; }

# ── Per-project clone paths (Option 2 layout) ──────────────────────────────
# Project working dir:         $PRJ_GOV_LOC/projects/<PID>
# Code-repo clones live under: $PRJ_GOV_LOC/projects/<PID>/repos/<repo-name>
project_clone_root() { echo "$PRJ_GOV_LOC/projects/$1"; }
repo_clone_dir()     { echo "$PRJ_GOV_LOC/projects/$1/repos/$2"; }

# Is the current user authorized to work this project? (per-task/team model)
# assigned_to is either an individual email (contains '@') or a GitHub team slug.
# Authorized when: assigned_to is empty/~ (unrestricted), OR equals the current
# git email (individual), OR the current gh login is a member of the team
# (needs read:org). seeded_by is an audit record and is NOT an authorization gate.
is_authorized() {
  local assigned="${1:-}"
  [[ -z "$assigned" || "$assigned" == "~" ]] && return 0
  local email; email=$(git config user.email 2>/dev/null || echo "")
  [[ -n "$email" && "$assigned" == "$email" ]] && return 0
  if [[ "$assigned" != *"@"* ]]; then            # treat as a GitHub team slug
    local login team
    login=$(gh api user --jq .login 2>/dev/null || echo "")
    [[ -z "$login" ]] && return 1
    team="${assigned#@}"; team="${team##*/}"       # strip leading @ and any org/ prefix
    gh api "orgs/$GITHUB_ORG/teams/$team/members" --jq '.[].login' 2>/dev/null \
      | grep -qx "$login" && return 0
  fi
  return 1
}

# Print active task IDs from project.yaml tasks[]
get_project_tasks() {
  python3 - "$1" <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1]))
for t in (c.get('tasks') or []):
    if t and t.get('id') and t.get('status') == 'active':
        print(t['id'])
PY
}

# ── Git helpers ───────────────────────────────────────────────────────────────

check_clean() {
  local path="${1:-$REPO_ROOT}"
  if [[ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]]; then
    hard_stop "Uncommitted changes in $path — commit or stash first."
  fi
}

# Create branch from a base branch and push it
create_and_push_branch() {
  local path="$1" branch="$2" from="$3"
  info "Creating branch '$branch' from '$from' in $(basename "$path")..."
  git -C "$path" fetch origin "$from" 2>/dev/null || true
  git -C "$path" checkout "$from"
  git -C "$path" pull origin "$from" 2>/dev/null || true
  if git -C "$path" rev-parse --verify "$branch" &>/dev/null; then
    hard_stop "Branch '$branch' already exists in $path — investigate before proceeding."
  fi
  git -C "$path" checkout -b "$branch"
  git -C "$path" push -u origin "$branch"
}

# Archive (tag) and delete a branch in a repo
archive_branch() {
  local path="$1" branch="$2"
  local tag="archive/$branch"
  info "Archiving '$branch' → '$tag' in $(basename "$path")..."
  git -C "$path" tag "$tag" \
    || hard_stop "Failed to create archive tag '$tag' in $path — branch NOT deleted."
  git -C "$path" push origin "$tag" \
    || hard_stop "Failed to push archive tag '$tag' — branch NOT deleted."
  git -C "$path" push origin --delete "$branch" 2>/dev/null \
    && info "Deleted remote branch '$branch'" \
    || warn "Remote branch '$branch' not found (may already be deleted)"
  git -C "$path" branch -D "$branch" 2>/dev/null || true
}

# Merge one branch into another; exit 2 on conflict so caller can handle
merge_branch() {
  local path="$1" from="$2" into="$3"
  info "Merging '$from' → '$into' in $(basename "$path")..."
  git -C "$path" checkout "$into"
  if ! git -C "$path" merge --no-edit "$from" 2>/dev/null; then
    echo ""
    echo "MERGE CONFLICT: $from → $into in $path"
    echo "Resolve conflicts manually, then re-run this script to continue."
    exit 2
  fi
}

# ── Validation ────────────────────────────────────────────────────────────────

# Run validators against the current working tree of the workspace repo.
# Used by scripts that commit DIRECTLY to $DEFAULT_BRANCH (cancel, close-knowledge
# project.yaml status update). Call AFTER making the commit, BEFORE pushing.
# On validation failure: rolls back the most recent commit and hard_stops.
# On success: returns silently.
#
# Usage: validate_or_revert
#   (Operates on $REPO_ROOT; reverts HEAD~1 on failure)
validate_or_revert() {
  local validator="$REPO_ROOT/scripts/validate/run.py"
  if [[ ! -x "$validator" ]]; then
    warn "Validator not found at $validator — skipping pre-push validation."
    return 0
  fi
  echo ""
  info "Running validators on local tree before push..."
  echo ""
  if ! python3 "$validator" "$REPO_ROOT"; then
    echo ""
    warn "Validation FAILED — rolling back last commit."
    git -C "$REPO_ROOT" reset --hard HEAD~1
    hard_stop "Local commit rolled back. Remote $DEFAULT_BRANCH is unchanged."
  fi
  info "✓ Validation passed."
}
