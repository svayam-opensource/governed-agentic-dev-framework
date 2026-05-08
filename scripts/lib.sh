#!/usr/bin/env bash
# Shared library for all Svayam Agentic Development Framework scripts.
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

  # Agent work root — read from preferences file or fall back to ~/work
  local prefs="$HOME/preferences/agent.md"
  if [[ -f "$prefs" ]] && grep -q "agent_work_root:" "$prefs" 2>/dev/null; then
    AGENT_WORK_ROOT=$(grep "agent_work_root:" "$prefs" | head -1 \
      | sed "s/.*agent_work_root: *//;s/ *#.*//" | tr -d '"' | sed "s|^~|$HOME|")
  else
    AGENT_WORK_ROOT="$HOME/work"
  fi
  export AGENT_WORK_ROOT
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
  printf "%s [y/N] " "$*"
  read -r _ans
  [[ "$_ans" == [yY] ]] || { echo "Aborted."; exit 0; }
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
