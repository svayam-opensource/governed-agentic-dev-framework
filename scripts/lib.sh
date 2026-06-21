#!/usr/bin/env bash
# Shared library for all Agentic Development Framework scripts.
# Source this at the top of each script:
#   source "$(dirname "$0")/lib.sh"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ADR-0001 Phase 4: honor $ADF_WORKSPACE (CLI installed separately from data);
# otherwise default to the vendored layout (scripts/ inside the workspace repo)
# — unchanged behavior.
if [[ -n "${ADF_WORKSPACE:-}" && -f "$ADF_WORKSPACE/org-config.yaml" ]]; then
  REPO_ROOT="$ADF_WORKSPACE"
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
CONFIG="$REPO_ROOT/org-config.yaml"
REGISTRY="$REPO_ROOT/registry.yaml"

# ── Dependency check ─────────────────────────────────────────────────────────

check_deps() {
  local missing=()
  # perl is a hidden seed.sh dependency (#65/H6 audit) — required, no fallback.
  for dep in git gh yq python3 perl; do
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

  # #65/H7: presence is not enough — an unauthenticated gh fails cryptically
  # deep inside lifecycle ops (e.g. a misleading "Project not found"). Fail fast.
  gh auth status >/dev/null 2>&1 \
    || hard_stop "gh is not authenticated — run: gh auth login"
}

# ── Config ────────────────────────────────────────────────────────────────────

load_config() {
  check_deps
  if command -v yq &>/dev/null; then
    ORG_NAME=$(yq '.org_name'           "$CONFIG")
    ORG_SHORT_NAME=$(yq '.org_short_name' "$CONFIG")
    ORG_SLUG=$(yq '.org_slug'           "$CONFIG")
    ORG_SLUG_LOWER=$(yq '.org_slug_lower' "$CONFIG")
    ORG_REPO_URL=$(yq '.org_repo_url'   "$CONFIG" 2>/dev/null || echo "")
    GITHUB_ORG=$(yq '.github_org'       "$CONFIG")
    WORKSPACE_REPO=$(yq '.workspace_repo' "$CONFIG")
    DEFAULT_BRANCH=$(yq '.default_branch' "$CONFIG")
    DEFAULT_CODE_BRANCH=$(yq '.default_code_branch' "$CONFIG")
    AGENT_WORK_ROOT_CFG=$(yq '.agent_work_root' "$CONFIG" 2>/dev/null || echo "")
    POLICY_OWNER_EMAIL=$(yq '.policy_owner_email' "$CONFIG")
  else
    _py() { python3 -c "import yaml; v = yaml.safe_load(open('$CONFIG')).get('$1', ''); print(v if v is not None else '')"; }
    ORG_NAME=$(_py org_name)
    ORG_SHORT_NAME=$(_py org_short_name)
    ORG_SLUG=$(_py org_slug)
    ORG_SLUG_LOWER=$(_py org_slug_lower)
    ORG_REPO_URL=$(_py org_repo_url)
    GITHUB_ORG=$(_py github_org)
    WORKSPACE_REPO=$(_py workspace_repo)
    DEFAULT_BRANCH=$(_py default_branch)
    DEFAULT_CODE_BRANCH=$(_py default_code_branch)
    AGENT_WORK_ROOT_CFG=$(_py agent_work_root)
    POLICY_OWNER_EMAIL=$(_py policy_owner_email)
  fi
  # yq emits the literal "null" for missing keys; treat that as empty.
  [[ "$AGENT_WORK_ROOT_CFG" == "null" ]] && AGENT_WORK_ROOT_CFG=""
  [[ "$ORG_REPO_URL"        == "null" ]] && ORG_REPO_URL=""
  [[ "$ORG_SHORT_NAME"      == "null" ]] && ORG_SHORT_NAME=""
  export ORG_NAME ORG_SHORT_NAME ORG_SLUG ORG_SLUG_LOWER ORG_REPO_URL \
         GITHUB_ORG WORKSPACE_REPO \
         DEFAULT_BRANCH DEFAULT_CODE_BRANCH POLICY_OWNER_EMAIL

  # Resolve AGENT_WORK_ROOT in priority order:
  #   1. Env var (escape hatch for tests / overrides)
  #   2. org-config.yaml agent_work_root
  #   3. Fallback: ~/.<org_slug_lower>/projects (the documented default)
  if [[ -z "${AGENT_WORK_ROOT:-}" ]]; then
    if [[ -n "$AGENT_WORK_ROOT_CFG" ]]; then
      AGENT_WORK_ROOT="$AGENT_WORK_ROOT_CFG"
    else
      AGENT_WORK_ROOT="$HOME/.${ORG_SLUG_LOWER:-org}/projects"
    fi
  fi
  # Expand a leading ~ against the current user's $HOME. The config value is
  # committed and shared, so it must stay portable (~/.svm/projects); without
  # this, a literal "~" would be treated as a directory name and a path like
  # "/Users/<other-user>" would fail on Windows/other machines.
  case "$AGENT_WORK_ROOT" in
    "~")    AGENT_WORK_ROOT="$HOME" ;;
    "~/"*)  AGENT_WORK_ROOT="$HOME/${AGENT_WORK_ROOT#\~/}" ;;
  esac
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
  echo "$AGENT_WORK_ROOT/preferences/$login.md"
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
  template="$REPO_ROOT/framework/knowledge/guidance/preferences-template.md"
  [[ -f "$template" ]] || return 0
  # Refuse to seed from an un-substituted template. setup.sh is the
  # right tool to substitute placeholders; only then can we copy.
  if grep -q '{{[A-Z_a-z0-9][A-Z_a-z0-9]*}}' "$template" 2>/dev/null; then
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
    | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'
}

today() { date +%Y-%m-%d; }

# ── Concurrency / atomic writes ───────────────────────────────────────────────
# Shared state (project.yaml, registry.yaml) is mutated by parallel agents
# (audit C7/C8). Two guarantees protect it:
#   * _with_lock — serialize a mutation behind an advisory file lock.
#   * never truncate-write in place — write a temp file beside the target and
#     atomically rename() over it, so a crash mid-write leaves the old file
#     intact (POL-002 "recoverable").

# Run <cmd...> while holding an exclusive advisory lock on <lockfile>.
# Uses flock(1) when available. macOS/BSD ships no flock by default; when it is
# absent we proceed WITHOUT the lock (still safe-ish thanks to the atomic
# temp+rename writes below) rather than failing the operation.
_with_lock() {
  local lockfile="$1"; shift
  if command -v flock &>/dev/null; then
    exec 9>"$lockfile"
    flock 9
    "$@"
    local rc=$?
    flock -u 9
    exec 9>&-
    return $rc
  fi
  # flock absent (e.g. stock macOS): degrade gracefully — no lock, atomic write
  # via temp+rename still prevents torn/partial files.
  "$@"
}

# Atomically replace <file> with the contents written to stdin: write to a
# temp file in the same directory (so rename() is atomic on the same FS) then
# mv over the target. Preserves the original on any failure mid-write.
atomic_write() {
  local file="$1"
  local tmp; tmp="$(mktemp "${file}.XXXXXX")" || return 1
  if cat >"$tmp"; then
    mv -f "$tmp" "$file"
  else
    rm -f "$tmp"
    return 1
  fi
}

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
  _with_lock "$file.lock" _yaml_set_impl "$file" "$key" "$value"
}

# Internal: the actual mutation, run under _with_lock. KEY is an internal
# constant and stays interpolated; VALUE is untrusted and is NEVER interpolated
# into the yq expression (audit C9 — PoC value `x" | .assigned_to = "evil@x.com`
# would otherwise rewrite an unrelated field). The value is passed via the
# environment and read with yq's strenv(). The python3 fallback already passes
# the value through argv (safe). Both backends write atomically (temp+rename,
# audit C8) instead of truncating the file in place.
_yaml_set_impl() {
  local file="$1" key="$2" value="$3"
  if command -v yq &>/dev/null; then
    if [[ "$value" == "~" || "$value" == "null" ]]; then
      yq ".$key = null" "$file" | atomic_write "$file"
    else
      VAL="$value" yq ".$key = strenv(VAL)" "$file" | atomic_write "$file"
    fi
  else
    python3 - "$file" "$key" "$value" <<'PY' | atomic_write "$file"
import sys, yaml
file, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
c = yaml.safe_load(open(file))
c[key] = None if value in ('~', 'null') else value
yaml.dump(c, sys.stdout, default_flow_style=False, allow_unicode=True, sort_keys=False)
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
sys.stdout.reconfigure(newline='\n')
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
sys.stdout.reconfigure(newline='\n')
c = yaml.safe_load(open(sys.argv[1]))
for r in (c.get('repos') or []):
    if r and r.get('url') == sys.argv[2]:
        print(r.get('base_branch') or 'dev')
        sys.exit(0)
print('dev')
PY
}

get_repo_name() { basename "$1" .git; }

# Resolve the project branch name for a given PROJECT_ID. Prefers the
# canonical value from registry.yaml's projects[<id>].branch; falls back to
# deriving from the ID for backwards compatibility:
#   - PRJ-NNN-slug  → brnch-NNN-slug   (v0.2.0+ convention)
#   - <ANY>-NNN-slug → lowercase form  (pre-v0.2.0 convention; ORG_SLUG-NNN → org_slug-NNN)
project_branch_for_id() {
  local pid="$1" branch
  branch=$(python3 - "$REGISTRY" "$pid" 2>/dev/null <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1])) or {}
for p in (c.get('projects') or []):
    if p and p.get('id') == sys.argv[2]:
        b = p.get('branch')
        if b:
            print(b); sys.exit(0)
sys.exit(1)
PY
)
  if [[ -n "$branch" && "$branch" != "null" ]]; then
    echo "$branch"
    return 0
  fi
  # Fallback: derive from ID. PRJ- prefix gets the new brnch- mapping;
  # legacy uppercase prefixes (e.g. ACME-001-foo) get the historical
  # lowercase mapping (acme-001-foo).
  if [[ "$pid" == PRJ-* ]]; then
    echo "brnch-${pid#PRJ-}"
  else
    echo "$pid" | tr '[:upper:]' '[:lower:]'
  fi
}

# Per-project workspace paths (Direction A layout)
project_work_root() { echo "$AGENT_WORK_ROOT/$1"; }
org_gov_clone()       { echo "$AGENT_WORK_ROOT/$1/$WORKSPACE_REPO"; }
repo_clone_dir()      { echo "$AGENT_WORK_ROOT/$1/$2"; }
# Back-compat aliases used by join.sh
project_clone_root()  { project_work_root "$1"; }

# Base clone shared by all per-project worktrees of a repo (ADR-0001 Phase 2).
base_clone_dir() { echo "$AGENT_WORK_ROOT/.bases/$(get_repo_name "$1")"; }

# Materialize <branch> of <repo_url> at <target_dir> as a git WORKTREE of a
# single shared base clone (one base per repo under $AGENT_WORK_ROOT/.bases/),
# instead of a full per-project clone. This is the ADR-0001 Phase 2 storage
# model: one fetch/identity per repo, shared object store, far less disk.
#
# Backward compatible: if <target_dir> already exists (a legacy full clone or
# an existing worktree), it is just fetched + checked out, never re-created.
# Returns non-zero on failure so callers can warn/skip.
ensure_repo_worktree() {
  local url="$1" target="$2" branch="$3"
  local base; base="$(base_clone_dir "$url")"

  # Already materialized (legacy clone OR existing worktree) — update in place.
  if [[ -e "$target/.git" ]]; then
    git -C "$target" fetch origin "$branch" 2>/dev/null || true
    git -C "$target" checkout "$branch" 2>/dev/null || return 1
    return 0
  fi

  # Ensure the single shared base clone exists and knows the branch.
  if [[ ! -e "$base/.git" ]]; then
    mkdir -p "$(dirname "$base")"
    git_clone_retry "$url" "$base" || return 1
  fi
  git -C "$base" fetch origin "$branch" 2>/dev/null \
    || git -C "$base" fetch origin 2>/dev/null || true

  mkdir -p "$(dirname "$target")"
  # Add the worktree on the branch, tracking origin/<branch> when needed.
  if git -C "$base" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$base" worktree add "$target" "$branch"
  elif git -C "$base" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git -C "$base" worktree add --track -b "$branch" "$target" "origin/$branch"
  else
    git -C "$base" worktree add -b "$branch" "$target"
  fi
}

# Clone with retry + backoff.
# "early EOF / unexpected disconnect while reading sideband packet"; a couple of
# retries usually rides through a transient drop. Honors GIT_CLONE_ATTEMPTS
# (default 3). Any extra git-clone args (a branch, --depth, …) pass through after
# <dest>. Removes a partial <dest> before each attempt. Returns non-zero if all
# attempts fail (callers decide whether that's fatal).
git_clone_retry() {
  local url="$1" dest="$2"; shift 2
  local attempts="${GIT_CLONE_ATTEMPTS:-3}" n=1 delay=5
  while true; do
    rm -rf "$dest"
    if git -c http.postBuffer=524288000 clone "$@" "$url" "$dest"; then
      return 0
    fi
    if [[ "$n" -ge "$attempts" ]]; then
      return 1
    fi
    warn "Clone of $url failed (attempt $n/$attempts) — retrying in ${delay}s..."
    sleep "$delay"
    n=$((n + 1)); delay=$((delay * 3))
  done
}

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
  if [[ "$assigned" == @* || "$assigned" != *"@"* ]]; then   # team: leading '@' or bare slug
    local login team
    login=$(gh api user --jq .login 2>/dev/null || echo "")
    [[ -z "$login" ]] && return 1
    team="${assigned#@}"; team="${team##*/}"       # strip leading @ and any org/ prefix
    gh api "orgs/$GITHUB_ORG/teams/$team/members" --jq '.[].login' 2>/dev/null \
      | grep -qx "$login" && return 0
  fi
  return 1
}

# ── GitHub Project access — ADR-0001 Phase 3 authorization source of truth ───
# Authorization moves from YAML assigned_to to "does the current GitHub user
# have write access to the linked GitHub Project v2" (viewerCanUpdate). YAML
# assigned_to becomes a display/audit cache. When GitHub is unreachable these
# signal (rc 2) so callers fall back to the legacy YAML check.

# Parse "<scope> <owner> <number>" from a Project v2 URL (scope = orgs|users).
gh_project_owner_number() {
  if [[ "$1" =~ /(orgs|users)/([^/]+)/projects/([0-9]+) ]]; then
    printf '%s %s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return 0
  fi
  return 1
}
_gh_owner_field() { [[ "$1" == "orgs" ]] && echo organization || echo user; }

# Close the GitHub Project board for a project URL so a completed/cancelled
# project stops showing as active in board-driven views (#56 Facet A). The
# board's open/closed state is what `prj manage list` keys on (open-only), so
# closing it both fixes the status display AND drops the project out of the
# active-management view (registry-backed `prj list` still shows it). Idempotent
# and non-fatal: a missing URL or already-closed board only warns.
close_project_board() {
  local url="$1" scope owner num
  if ! read -r scope owner num < <(gh_project_owner_number "$url"); then
    warn "Could not derive project number from '$url' — close the board manually."
    return 0
  fi
  if gh project close "$num" --owner "$owner" >/dev/null 2>&1; then
    info "Closed GitHub Project board #$num (owner $owner)"
  else
    warn "Could not close GitHub Project board #$num — close manually: gh project close $num --owner $owner"
  fi
  return 0
}

# Echo the ProjectV2 node id for a project URL (empty + non-zero on failure).
gh_project_node_id() {
  local scope owner num field id
  read -r scope owner num < <(gh_project_owner_number "$1") || return 2
  field=$(_gh_owner_field "$scope")
  id=$(gh api graphql -f query="query{ $field(login:\"$owner\"){ projectV2(number:$num){ id } } }" \
        --jq ".data.$field.projectV2.id" 2>/dev/null) || return 1
  [[ -n "$id" && "$id" != "null" ]] && { echo "$id"; return 0; }
  return 1
}

# rc 0 = current gh user can write the Project (authorized); rc 1 = cannot;
# rc 2 = GitHub unreachable (caller should fall back to the YAML check).
gh_viewer_can_update_project() {
  local scope owner num field v
  read -r scope owner num < <(gh_project_owner_number "$1") || return 2
  field=$(_gh_owner_field "$scope")
  v=$(gh api graphql -f query="query{ $field(login:\"$owner\"){ projectV2(number:$num){ viewerCanUpdate } } }" \
        --jq ".data.$field.projectV2.viewerCanUpdate" 2>/dev/null) || return 2
  [[ -z "$v" || "$v" == "null" ]] && return 2
  [[ "$v" == "true" ]]
}

# Authorization gate (Phase 3). Args: <project_url> [yaml_assigned_to_for_fallback].
is_authorized_for_project() {
  local url="$1" yaml_assigned="${2:-}"
  gh_viewer_can_update_project "$url"
  case "$?" in
    0) return 0 ;;
    1) return 1 ;;
    2) warn "Could not reach GitHub to check Project access — using cached assignment."
       is_authorized "$yaml_assigned"; return $? ;;
  esac
  return 1
}

# Resolve an assignee token to "user <nodeId>" or "team <nodeId>".
# Convention: '@slug' = a GitHub team; a bare 'login' = a GitHub user.
# An email-style value (contains '@' not at the start) is legacy and unsupported.
gh_resolve_actor() {
  local who="$1" id
  if [[ "$who" == @* ]]; then
    local slug="${who#@}"; slug="${slug##*/}"
    id=$(gh api graphql -f query="query{ organization(login:\"$GITHUB_ORG\"){ team(slug:\"$slug\"){ id } } }" --jq '.data.organization.team.id' 2>/dev/null)
    [[ -n "$id" && "$id" != "null" ]] && { echo "team $id"; return 0; }
    return 1
  elif [[ "$who" != *"@"* ]]; then
    id=$(gh api graphql -f query="query{ user(login:\"$who\"){ id } }" --jq '.data.user.id' 2>/dev/null)
    [[ -n "$id" && "$id" != "null" ]] && { echo "user $id"; return 0; }
    return 1
  fi
  return 1
}

# Grant/revoke Project access. role: WRITER (assign) | NONE (unassign).
# kind: user|team. MUTATES real GitHub Project access. Returns gh's exit status.
gh_project_set_access() {
  local project_id="$1" kind="$2" actor_id="$3" role="$4" idfield
  [[ "$kind" == "team" ]] && idfield="teamId" || idfield="userId"
  gh api graphql -f query="mutation(\$p:ID!,\$a:ID!){ updateProjectV2Collaborators(input:{projectId:\$p, collaborators:[{$idfield:\$a, role:$role}]}){ clientMutationId } }" \
    -f p="$project_id" -f a="$actor_id" >/dev/null 2>&1
}

# Copy the developer's git identity from the workspace a lifecycle command runs
# in ($REPO_ROOT, where setup.sh configured user.name/user.email) into a freshly
# created per-project clone. Without this, the per-project workspace inherits
# only the ambient global identity, so commits and C01 authorization there would
# not reflect the developer who seeded/joined the project.
set_clone_identity() {
  local dir="$1" name email
  name=$(git -C "$REPO_ROOT" config user.name 2>/dev/null || echo "")
  email=$(git -C "$REPO_ROOT" config user.email 2>/dev/null || echo "")
  [[ -n "$name" ]]  && git -C "$dir" config user.name  "$name"
  [[ -n "$email" ]] && git -C "$dir" config user.email "$email"
  return 0
}

# ── Registry-on-default-branch (Option 2 global index) ──────────────────────
# registry.yaml is the authoritative index and lives on $DEFAULT_BRANCH so
# management/read commands see all projects without checking out a project
# branch. This sets a project's status there and pushes. Safe to call from a
# standalone clone on any branch when the working tree is clean (callers commit
# their own changes first); it switches to the default branch and back.
# Internal: rewrite a project's status in registry.yaml atomically. Run under
# _with_lock by registry_set_status_on_main. Writes to stdout and lets
# atomic_write handle the temp+rename, never truncating the file in place.
_registry_set_status_impl() {
  python3 - "$1" "$2" "$3" <<'PY' | atomic_write "$1"
import sys, yaml
reg, pid, status = sys.argv[1:]
c = yaml.safe_load(open(reg)) or {}
for p in (c.get('projects') or []):
    if p and p.get('id') == pid:
        p['status'] = status
        break
yaml.dump(c, sys.stdout, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY
}

registry_set_status_on_main() {
  local pid="$1" status="$2"
  local cur; cur=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]]; then
    warn "Working tree not clean — skipping registry status update on $DEFAULT_BRANCH for $pid."
    return 0
  fi
  git -C "$REPO_ROOT" fetch origin "$DEFAULT_BRANCH" 2>/dev/null || true
  git -C "$REPO_ROOT" checkout "$DEFAULT_BRANCH" 2>/dev/null \
    || { warn "Could not switch to $DEFAULT_BRANCH to update registry for $pid."; return 0; }
  git -C "$REPO_ROOT" pull --ff-only origin "$DEFAULT_BRANCH" 2>/dev/null || true
  # Audit C7: serialize concurrent seed/status writers and write atomically
  # (temp+rename) so a crash mid-write can't truncate the shared registry.
  _with_lock "$REGISTRY.lock" _registry_set_status_impl "$REGISTRY" "$pid" "$status"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain registry.yaml 2>/dev/null)" ]]; then
    git -C "$REPO_ROOT" add registry.yaml
    git -C "$REPO_ROOT" commit -m "registry: $pid status=$status" >/dev/null 2>&1 || true
    git -C "$REPO_ROOT" push origin "$DEFAULT_BRANCH" 2>/dev/null \
      || warn "Could not push registry status=$status for $pid to $DEFAULT_BRANCH."
  fi
  [[ -n "$cur" ]] && git -C "$REPO_ROOT" checkout "$cur" 2>/dev/null || true
  return 0
}

# Best-effort: mirror a read-only governance summary into the GitHub Project
# README. Needs the 'project' (write) scope; on any failure it warns and
# returns 0 so it can never break a lifecycle op. git stays authoritative.
project_readme_mirror() {
  local pid="$1" gh_url="$2" status="$3" assigned="$4" seeded="$5" branch="$6"
  [[ -z "$gh_url" ]] && return 0
  command -v gh >/dev/null 2>&1 || return 0
  local num owner field
  num=$(echo "$gh_url" | grep -oE '/projects/[0-9]+' | grep -oE '[0-9]+' || echo "")
  [[ -z "$num" ]] && return 0
  if echo "$gh_url" | grep -q '/orgs/'; then
    owner=$(echo "$gh_url" | sed 's|.*/orgs/\([^/]*\)/.*|\1|'); field="organization"
  else
    owner=$(echo "$gh_url" | sed 's|.*/users/\([^/]*\)/.*|\1|'); field="user"
  fi
  local node_id
  node_id=$(gh api graphql -f query="query{ ${field}(login: \"$owner\"){ projectV2(number: $num){ id } } }" \
    --jq ".data.${field}.projectV2.id" 2>/dev/null || echo "")
  if [[ -z "$node_id" || "$node_id" == "null" ]]; then
    warn "README mirror skipped for $pid (could not resolve project — needs 'project' scope)."
    return 0
  fi
  local readme
  readme=$(cat <<MD
<!-- Managed by the agentic-dev framework — do not edit. Mirrored from registry.yaml. -->
## Governance — $pid

| Field | Value |
|---|---|
| Project ID | \`$pid\` |
| Status | $status |
| Assigned to | $assigned |
| Seeded by | $seeded |
| Branch | \`$branch\` |

Authoritative record: \`registry.yaml\` + \`projects/$pid/\` in the governance repo.
MD
)
  gh api graphql \
    -f query='mutation($id:ID!,$r:String!){ updateProjectV2(input:{projectId:$id, readme:$r}){ projectV2 { id } } }' \
    -f id="$node_id" -f r="$readme" >/dev/null 2>&1 \
    || warn "README mirror skipped for $pid (write failed — needs 'project' scope)."
  return 0
}

# Print active task IDs from project.yaml tasks[]
# Active tasks = OPEN/non-Done issues on the project board (tasks-on-board model;
# the board is the source of truth for task state, not project.yaml). Echoes one
# issue URL per line. Reads the board via gh (needs 'project' scope). Arg: project.yaml path.
get_project_tasks() {
  local pf="$1"
  local url; url=$(yaml_get "$pf" "github_project")
  [[ -z "$url" || "$url" == "~" ]] && return 0
  command -v gh >/dev/null 2>&1 || return 0
  local num owner
  num=$(echo "$url" | grep -oE '/projects/[0-9]+' | grep -oE '[0-9]+' || echo "")
  [[ -z "$num" ]] && return 0
  if echo "$url" | grep -q '/orgs/'; then
    owner=$(echo "$url" | sed 's|.*/orgs/\([^/]*\)/.*|\1|')
  else
    owner=$(echo "$url" | sed 's|.*/users/\([^/]*\)/.*|\1|')
  fi
  gh project item-list "$num" --owner "$owner" --format json --limit 200 2>/dev/null | python3 -c "
import sys, json
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for i in d.get('items', []):
    c = i.get('content') or {}
    if c.get('type') == 'Issue' and str(i.get('status','')).strip().lower() != 'done':
        u = c.get('url')
        if u: print(u)
" 2>/dev/null
}

# Best-effort: set a GitHub Project 'Status' single-select for an issue's item.
# Needs the 'project' (write) scope; warns + returns 0 on any failure so it can
# never break a task op. Args: project_url, issue_url, status_option_name.
board_set_status() {
  local url="$1" issue="$2" want="$3"
  [[ -z "$url" || -z "$issue" ]] && return 0
  command -v gh >/dev/null 2>&1 || return 0
  local num owner
  num=$(echo "$url" | grep -oE '/projects/[0-9]+' | grep -oE '[0-9]+' || echo "")
  [[ -z "$num" ]] && return 0
  if echo "$url" | grep -q '/orgs/'; then
    owner=$(echo "$url" | sed 's|.*/orgs/\([^/]*\)/.*|\1|')
  else
    owner=$(echo "$url" | sed 's|.*/users/\([^/]*\)/.*|\1|')
  fi
  local pid fid oid iid
  pid=$(gh project view "$num" --owner "$owner" --format json 2>/dev/null \
        | python3 -c "import sys,json; print((json.load(sys.stdin) or {}).get('id',''))" 2>/dev/null)
  read -r fid oid <<EOF2
$(gh project field-list "$num" --owner "$owner" --format json 2>/dev/null | WANT="$want" python3 -c "
import sys, json, os
want = os.environ.get('WANT','').strip().lower()
d = json.load(sys.stdin)
for f in d.get('fields', []):
    if f.get('name') == 'Status':
        oid = ''
        for o in (f.get('options') or []):
            if o.get('name','').strip().lower() == want: oid = o.get('id','')
        print(f.get('id',''), oid); break
" 2>/dev/null)
EOF2
  iid=$(gh project item-list "$num" --owner "$owner" --format json --limit 200 2>/dev/null \
        | ISSUE="$issue" python3 -c "
import sys, json, os
iss = os.environ.get('ISSUE','')
d = json.load(sys.stdin)
for i in d.get('items', []):
    if (i.get('content') or {}).get('url') == iss: print(i.get('id','')); break
" 2>/dev/null)
  if [[ -z "$pid" || -z "$fid" || -z "$oid" || -z "$iid" ]]; then
    warn "Board Status not set for $issue (need 'project' scope + a '$want' option)."
    return 0
  fi
  gh project item-edit --id "$iid" --project-id "$pid" --field-id "$fid" \
     --single-select-option-id "$oid" >/dev/null 2>&1 \
    || warn "Board Status update to '$want' failed for $issue."
  return 0
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

# ── Framework version guard ───────────────────────────────────────────────────
# No lower framework version may silently overwrite a higher one. Compare two
# semver-ish versions (strip leading v + any -suffix). Echoes -1 / 0 / 1.
version_cmp() {
  local a="${1#v}" b="${2#v}"; a="${a%%-*}"; b="${b%%-*}"
  [[ "$a" == "$b" ]] && { echo 0; return; }
  local lo; lo="$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -n1)"
  [[ "$lo" == "$a" ]] && echo -1 || echo 1
}

# Hard-stop if INCOMING framework version < CURRENT (a downgrade that would
# overwrite newer framework code with older). Override only with the deliberate
# ALLOW_DOWNGRADE=true escape hatch ("stop and take a careful look").
assert_no_framework_downgrade() {
  local incoming="$1" current="$2" context="${3:-framework sync}"
  [[ -z "$incoming" || -z "$current" ]] && return 0
  if [[ "$(version_cmp "$incoming" "$current")" == "-1" ]]; then
    if [[ "${ALLOW_DOWNGRADE:-false}" == "true" ]]; then
      warn "DOWNGRADE OVERRIDE ($context): applying v$incoming over v$current — proceeding (--allow-downgrade)."
    else
      hard_stop "Refusing $context: incoming framework v$incoming is LOWER than current v$current.
This would overwrite newer framework code with an older version — stopped for a careful look.
If this is genuinely intended, re-run with --allow-downgrade (ALLOW_DOWNGRADE=true)."
    fi
  fi
}
