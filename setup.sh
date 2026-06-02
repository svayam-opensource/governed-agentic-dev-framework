#!/usr/bin/env bash
# Agentic Development Framework — Organization Setup Script
#
# One-time interactive setup for your organization. Writes org-specific values
# to org-config.yaml and configures git remotes so future framework upgrades
# can be pulled from the upstream TEMPLATE.
#
# Framework files (CLAUDE.md, AGENTS.md, knowledge/policies/, etc.) are NEVER
# modified by this script — they reference values from org-config.yaml at
# runtime. This keeps `git pull template main` conflict-free forever.
#
# Usage:
#   bash setup.sh                    # interactive (default)
#   bash setup.sh --non-interactive  # re-use existing org-config.yaml values
#                                    # (for CI / re-runs)
#
# Env escape hatches (testing):
#   SETUP_SKIP_GITHUB_VERIFY=1       Skip the gh / scope checks.
#   SETUP_SKIP_REMOTE_CONFIG=1       Skip rename/add of origin/template remotes.

set -euo pipefail

NON_INTERACTIVE=false
[[ "${1:-}" == "--non-interactive" ]] && NON_INTERACTIVE=true

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$REPO_ROOT/org-config.yaml"

# The framework's canonical upstream — used to seed the `template` remote.
TEMPLATE_REPO_URL="git@github.com:svayam-opensource/governed-agentic-dev-framework.git"
TEMPLATE_OWNER="svayam-opensource"
TEMPLATE_REPO="governed-agentic-dev-framework"

# ── Output helpers ────────────────────────────────────────────────────────────

BOLD='\033[1m'; DIM='\033[2m'
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()        { echo -e "${GREEN}  ✓${NC} $*"; }
warn()      { echo -e "${YELLOW}  !${NC} $*"; }
err()       { echo -e "${RED}  ✗${NC} $*" >&2; }
info()      { echo -e "${CYAN}  →${NC} $*"; }
header()    { echo ""; echo -e "${BOLD}${CYAN}$*${NC}"; }
hard_stop() { echo ""; err "$*"; echo ""; exit 1; }

# ── Read with EOF handling ────────────────────────────────────────────────────

# Helpers below use unique internal variable names (__rabort_val, __ask_val,
# __validated_val) to avoid shadowing the caller's __val via bash's dynamic
# scoping. printf -v writes to the closest local in scope — if both inner
# and outer scopes declare `local __val`, the inner wins and the value
# never propagates back to the caller.

_read_or_abort() {
  local __varname="$1" __rabort_val
  if ! IFS= read -r __rabort_val; then
    echo ""
    err "Aborted (no input)."
    exit 1
  fi
  printf -v "$__varname" '%s' "$__rabort_val"
}

ask() {
  local __var="$1" __prompt="$2" __default="${3:-}" __ask_val
  if [[ -n "$__default" ]]; then
    printf "  ${BOLD}%s${NC} ${DIM}[%s]${NC}: " "$__prompt" "$__default"
  else
    printf "  ${BOLD}%s${NC}: " "$__prompt"
  fi
  _read_or_abort __ask_val
  printf -v "$__var" '%s' "${__ask_val:-$__default}"
}

ask_required() {
  local __var="$1" __prompt="$2" __default="${3:-}" __validated_val
  while true; do
    ask __validated_val "$__prompt" "$__default"
    if [[ -n "$__validated_val" ]]; then
      printf -v "$__var" '%s' "$__validated_val"
      return
    fi
    err "Required."
  done
}

ask_slug() {
  local __var="$1" __prompt="$2" __default="${3:-}" __validated_val
  while true; do
    ask __validated_val "$__prompt" "$__default"
    if [[ "$__validated_val" =~ ^[A-Z][A-Z0-9]{1,5}$ ]]; then
      printf -v "$__var" '%s' "$__validated_val"
      return
    fi
    err "Must be 2-6 uppercase letters/digits, starting with a letter (e.g. ACME, NORDIC, SVM2)."
  done
}

ask_date() {
  local __var="$1" __prompt="$2" __default="${3:-}" __validated_val
  while true; do
    ask __validated_val "$__prompt" "$__default"
    if [[ "$__validated_val" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
      printf -v "$__var" '%s' "$__validated_val"
      return
    fi
    err "Must be YYYY-MM-DD format."
  done
}

# Parse a GitHub URL into owner/repo. Accepts ssh and https forms (with or
# without .git suffix). Returns 0 on success and sets the two named vars.
parse_github_url() {
  local url="$1" __owner_var="$2" __repo_var="$3"
  local normalized="${url%.git}"
  if [[ "$normalized" =~ github\.com[:/]([^/]+)/(.+)$ ]]; then
    printf -v "$__owner_var" '%s' "${BASH_REMATCH[1]}"
    printf -v "$__repo_var"  '%s' "${BASH_REMATCH[2]}"
    return 0
  fi
  return 1
}

ask_github_url() {
  local __var="$1" __prompt="$2" __default="${3:-}" __validated_val __owner __repo
  while true; do
    ask __validated_val "$__prompt" "$__default"
    if [[ -z "$__validated_val" ]]; then
      err "Required."
      continue
    fi
    if parse_github_url "$__validated_val" __owner __repo; then
      printf -v "$__var" '%s' "$__validated_val"
      return
    fi
    err "Expected a GitHub URL (git@github.com:owner/repo[.git] or https://github.com/owner/repo[.git])."
  done
}

# ── Read existing org-config.yaml values ──────────────────────────────────────

read_yaml_field() {
  local key="$1"
  if command -v yq &>/dev/null; then
    local v
    v=$(yq ".$key" "$CONFIG" 2>/dev/null)
    [[ "$v" == "null" ]] && echo "" || echo "$v"
  else
    python3 -c "import yaml; v = yaml.safe_load(open('$CONFIG')).get('$key', ''); print(v if v is not None else '')" 2>/dev/null
  fi
}

# ── Step 1: Pre-conditions ────────────────────────────────────────────────────

[[ -f "$CONFIG" ]] || hard_stop "org-config.yaml not found at $CONFIG"

cd "$REPO_ROOT"

if ! git rev-parse --git-dir &>/dev/null; then
  hard_stop "Not in a git repository. Initialize first: git init"
fi

ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [[ -z "$ORIGIN_URL" ]]; then
  hard_stop "No 'origin' remote configured. Set one up first:
    git remote add origin <YOUR_ORG_REPO_URL>
  Then re-run setup.sh."
fi

ORIGIN_OWNER=""
ORIGIN_REPO=""
parse_github_url "$ORIGIN_URL" ORIGIN_OWNER ORIGIN_REPO \
  || hard_stop "Could not parse owner/repo from origin URL: $ORIGIN_URL"

# Detect "origin still points at the framework TEMPLATE" — adopter cloned
# TEMPLATE directly. We re-point origin at their org repo during setup
# (not a hard stop the way it used to be — setup itself does the fix).
ORIGIN_IS_TEMPLATE=false
if [[ "$ORIGIN_OWNER" == "$TEMPLATE_OWNER" && "$ORIGIN_REPO" == "$TEMPLATE_REPO" ]]; then
  ORIGIN_IS_TEMPLATE=true
fi

# ── Step 2: Read existing config + runtime detections ────────────────────────

CURRENT_ORG_NAME=$(read_yaml_field org_name)
CURRENT_ORG_SHORT=$(read_yaml_field org_short_name)
CURRENT_ORG_SLUG=$(read_yaml_field org_slug)
CURRENT_ORG_REPO_URL=$(read_yaml_field org_repo_url)
CURRENT_DEFAULT_BRANCH=$(read_yaml_field default_branch)
CURRENT_DEFAULT_CODE_BRANCH=$(read_yaml_field default_code_branch)
CURRENT_AGENT_WORK_ROOT=$(read_yaml_field agent_work_root)
CURRENT_POLICY_OWNER_EMAIL=$(read_yaml_field policy_owner_email)
CURRENT_POLICY_OWNER_GITHUB=$(read_yaml_field policy_owner_github)
CURRENT_LEGAL=$(read_yaml_field legal_owner_github)
CURRENT_INFRA=$(read_yaml_field infra_owner_github)
CURRENT_SYS_ARCH=$(read_yaml_field system_arch_owner_github)
CURRENT_DATA_ARCH=$(read_yaml_field data_arch_owner_github)
CURRENT_POLICY_DATE=$(read_yaml_field policy_effective_date)

GH_USER=$(gh api user --jq .login 2>/dev/null || echo "")
GIT_EMAIL=$(git config user.email 2>/dev/null || echo "")
TODAY=$(date +%Y-%m-%d)

# ── Step 3: Prompt (or skip in --non-interactive) ─────────────────────────────

if $NON_INTERACTIVE; then
  warn "--non-interactive: using existing org-config.yaml values as-is."
  [[ -n "$CURRENT_ORG_NAME" ]] \
    || hard_stop "org-config.yaml has no org_name. Run setup.sh interactively first."
  ORG_NAME="$CURRENT_ORG_NAME"
  ORG_SHORT_NAME="$CURRENT_ORG_SHORT"
  ORG_SLUG="$CURRENT_ORG_SLUG"
  ORG_SLUG_LOWER=$(echo "$ORG_SLUG" | tr '[:upper:]' '[:lower:]')
  ORG_REPO_URL="${CURRENT_ORG_REPO_URL:-$ORIGIN_URL}"
  parse_github_url "$ORG_REPO_URL" ORIGIN_OWNER ORIGIN_REPO || true
  GITHUB_ORG="$ORIGIN_OWNER"
  WORKSPACE_REPO="$ORIGIN_REPO"
  DEFAULT_BRANCH="$CURRENT_DEFAULT_BRANCH"
  DEFAULT_CODE_BRANCH="$CURRENT_DEFAULT_CODE_BRANCH"
  AGENT_WORK_ROOT="$CURRENT_AGENT_WORK_ROOT"
  [[ -n "$AGENT_WORK_ROOT" ]] || AGENT_WORK_ROOT="$HOME/.${ORG_SLUG_LOWER}/projects"
  POLICY_OWNER_EMAIL="$CURRENT_POLICY_OWNER_EMAIL"
  POLICY_OWNER_GITHUB="$CURRENT_POLICY_OWNER_GITHUB"
  LEGAL_OWNER_GITHUB="$CURRENT_LEGAL"
  INFRA_OWNER_GITHUB="$CURRENT_INFRA"
  SYSTEM_ARCH_OWNER_GITHUB="$CURRENT_SYS_ARCH"
  DATA_ARCH_OWNER_GITHUB="$CURRENT_DATA_ARCH"
  POLICY_EFFECTIVE_DATE="$CURRENT_POLICY_DATE"
else
  echo ""
  echo -e "${BOLD}Agentic Development Framework — Setup${NC}"
  echo "─────────────────────────────────────────"
  echo ""
  echo "  Current 'origin':   ${ORIGIN_OWNER}/${ORIGIN_REPO}"
  [[ -n "$GH_USER"   ]] && echo "  Detected gh user:   ${GH_USER}"
  [[ -n "$GIT_EMAIL" ]] && echo "  Git user.email:     ${GIT_EMAIL}"
  echo ""
  echo "Press Enter to accept the [default] for any prompt."

  if $ORIGIN_IS_TEMPLATE; then
    header "Your organization's repository"
    echo "  Your 'origin' remote points at the framework TEMPLATE:"
    echo "    $ORIGIN_URL"
    echo ""
    echo "  Setup will re-point origin at your org's own repo and keep TEMPLATE"
    echo "  as a separate remote called 'template' for future framework"
    echo "  upgrades (git pull template main)."
    echo ""
    ask_github_url ORG_REPO_URL "Your org's repo URL (git@... or https://...)" "${CURRENT_ORG_REPO_URL:-}"
    parse_github_url "$ORG_REPO_URL" ORIGIN_OWNER ORIGIN_REPO \
      || hard_stop "Internal error: just-validated URL no longer parses."
  else
    ORG_REPO_URL="${CURRENT_ORG_REPO_URL:-$ORIGIN_URL}"
  fi
  GITHUB_ORG="$ORIGIN_OWNER"
  WORKSPACE_REPO="$ORIGIN_REPO"

  header "Organization"
  ask_required ORG_NAME       "Full legal name of your organization"          "$CURRENT_ORG_NAME"
  ask_required ORG_SHORT_NAME "Short display name (used in headings)"          "$CURRENT_ORG_SHORT"
  ask_slug     ORG_SLUG       "Org slug (uppercase, 2-6 chars; e.g. ACME)"     "$CURRENT_ORG_SLUG"
  ORG_SLUG_LOWER=$(echo "$ORG_SLUG" | tr '[:upper:]' '[:lower:]')
  echo ""
  ok "org_slug:        $ORG_SLUG"
  ok "org_slug_lower:  $ORG_SLUG_LOWER  (auto-derived)"
  ok "github_org:      $ORIGIN_OWNER    (from org repo URL)"
  ok "workspace_repo:  $ORIGIN_REPO     (from org repo URL)"

  header "Branches"
  ask DEFAULT_BRANCH      "Default branch for this workspace repo"     "${CURRENT_DEFAULT_BRANCH:-main}"
  ask DEFAULT_CODE_BRANCH "Default base branch for code repositories"  "${CURRENT_DEFAULT_CODE_BRANCH:-dev}"

  header "Agent work root"
  echo "  Per-project workspaces are created under this path. Each project"
  echo "  gets its own folder containing a clone of this repo on the project"
  echo "  branch plus clones of each impacted code repo on the project branch."
  echo ""
  ask AGENT_WORK_ROOT "Agent work root path" "${CURRENT_AGENT_WORK_ROOT:-$HOME/.${ORG_SLUG_LOWER}/projects}"

  header "Policy Owner (initial holder of all policy roles)"
  ask_required POLICY_OWNER_EMAIL  "Policy Owner email"             "${CURRENT_POLICY_OWNER_EMAIL:-$GIT_EMAIL}"
  ask_required POLICY_OWNER_GITHUB "Policy Owner GitHub @-handle"   "${CURRENT_POLICY_OWNER_GITHUB:-${GH_USER:+@$GH_USER}}"

  header "Domain Owners"
  echo "  Per the default policy, all domain roles are held by the Policy Owner"
  echo "  at launch. Press Enter to accept '$POLICY_OWNER_GITHUB' for each."
  ask LEGAL_OWNER_GITHUB         "Legal Owner"                  "${CURRENT_LEGAL:-$POLICY_OWNER_GITHUB}"
  ask INFRA_OWNER_GITHUB         "Infrastructure Owner"         "${CURRENT_INFRA:-$POLICY_OWNER_GITHUB}"
  ask SYSTEM_ARCH_OWNER_GITHUB   "System Architecture Owner"    "${CURRENT_SYS_ARCH:-$POLICY_OWNER_GITHUB}"
  ask DATA_ARCH_OWNER_GITHUB     "Data Architecture Owner"      "${CURRENT_DATA_ARCH:-$POLICY_OWNER_GITHUB}"

  header "Policy"
  ask_date POLICY_EFFECTIVE_DATE "Policy effective date (YYYY-MM-DD)" "${CURRENT_POLICY_DATE:-$TODAY}"

  echo ""
  echo "Configured values:"
  echo "  org_name:                  $ORG_NAME"
  echo "  org_short_name:            $ORG_SHORT_NAME"
  echo "  org_slug:                  $ORG_SLUG"
  echo "  org_repo_url:              $ORG_REPO_URL"
  echo "  github_org:                $GITHUB_ORG"
  echo "  workspace_repo:            $WORKSPACE_REPO"
  echo "  default_branch:            $DEFAULT_BRANCH"
  echo "  default_code_branch:       $DEFAULT_CODE_BRANCH"
  echo "  agent_work_root:           $AGENT_WORK_ROOT"
  echo "  policy_owner_email:        $POLICY_OWNER_EMAIL"
  echo "  policy_owner_github:       $POLICY_OWNER_GITHUB"
  echo "  legal_owner_github:        $LEGAL_OWNER_GITHUB"
  echo "  infra_owner_github:        $INFRA_OWNER_GITHUB"
  echo "  system_arch_owner_github:  $SYSTEM_ARCH_OWNER_GITHUB"
  echo "  data_arch_owner_github:    $DATA_ARCH_OWNER_GITHUB"
  echo "  policy_effective_date:     $POLICY_EFFECTIVE_DATE"
  echo ""
fi

# ── Step 4: Write org-config.yaml ─────────────────────────────────────────────

cat > "$CONFIG" <<EOF
# Agentic Development Framework — Organization Configuration
#
# Single source of truth for this organization's identity, defaults, and roles.
# Framework scripts and agents read these values at runtime — no placeholder
# substitution happens, so this file is the only thing that diverges from
# the upstream framework template.
#
# Re-run ./setup.sh to update. Do not edit by hand unless you know what you're
# doing (setup.sh overwrites the file).

# Full legal name of your organization
org_name: "$ORG_NAME"

# Short display name (used in headings and prose)
org_short_name: "$ORG_SHORT_NAME"

# Uppercase slug for human display and multi-org disambiguation (2-6 chars).
# Not used in project IDs (which use a literal PRJ- prefix).
org_slug: "$ORG_SLUG"

# Lowercase derivation of org_slug — used for filesystem paths under
# agent_work_root. Auto-derived from org_slug.
org_slug_lower: "$ORG_SLUG_LOWER"

# Full URL of this workspace repository. 'origin' will be set to this.
org_repo_url: "$ORG_REPO_URL"

# GitHub organization or username (derived from org_repo_url)
github_org: "$GITHUB_ORG"

# Name of this workspace repository (derived from org_repo_url)
workspace_repo: "$WORKSPACE_REPO"

# Default branch name for this workspace repo
default_branch: "$DEFAULT_BRANCH"

# Default base branch for code repositories (used by seed script)
default_code_branch: "$DEFAULT_CODE_BRANCH"

# Per-project workspaces are created under this path. Each gets its own
# folder containing a clone of this workspace repo on the project branch
# plus clones of each impacted code repo on the project branch.
agent_work_root: "$AGENT_WORK_ROOT"

# Policy Owner details (initial holder of all policy roles at launch)
policy_owner_email: "$POLICY_OWNER_EMAIL"
policy_owner_github: "$POLICY_OWNER_GITHUB"

# Other role GitHub handles (update as roles are formally assigned)
legal_owner_github: "$LEGAL_OWNER_GITHUB"
infra_owner_github: "$INFRA_OWNER_GITHUB"
system_arch_owner_github: "$SYSTEM_ARCH_OWNER_GITHUB"
data_arch_owner_github: "$DATA_ARCH_OWNER_GITHUB"

# Effective date of the policy (YYYY-MM-DD)
policy_effective_date: "$POLICY_EFFECTIVE_DATE"
EOF

ok "Wrote $CONFIG"

# ── Step 5: Configure git remotes ─────────────────────────────────────────────

if $NON_INTERACTIVE || [[ "${SETUP_SKIP_REMOTE_CONFIG:-}" == "1" ]]; then
  :
else
  header "Configuring git remotes"

  CURRENT_ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "")
  if [[ "$CURRENT_ORIGIN_URL" != "$ORG_REPO_URL" ]]; then
    if $ORIGIN_IS_TEMPLATE; then
      info "Renaming current 'origin' (TEMPLATE) → 'template'"
      git remote get-url template &>/dev/null && git remote remove template
      git remote rename origin template
      info "Setting new 'origin' → $ORG_REPO_URL"
      git remote add origin "$ORG_REPO_URL"
    else
      info "Updating 'origin' → $ORG_REPO_URL"
      git remote set-url origin "$ORG_REPO_URL"
    fi
  else
    ok "origin → $ORG_REPO_URL"
  fi

  if git remote get-url template &>/dev/null; then
    CURRENT_TEMPLATE_URL=$(git remote get-url template)
    if [[ "$CURRENT_TEMPLATE_URL" != "$TEMPLATE_REPO_URL" ]]; then
      info "Updating 'template' → $TEMPLATE_REPO_URL"
      git remote set-url template "$TEMPLATE_REPO_URL"
    else
      ok "template → $TEMPLATE_REPO_URL"
    fi
  else
    info "Adding 'template' remote → $TEMPLATE_REPO_URL"
    git remote add template "$TEMPLATE_REPO_URL"
  fi

  ok "Remotes:"
  git remote -v | sed 's/^/    /'
fi

# ── Step 6: GitHub identity & access verification ────────────────────────────

if $NON_INTERACTIVE || [[ "${SETUP_SKIP_GITHUB_VERIFY:-}" == "1" ]]; then
  :
else
  header "Identity & GitHub access"

  GIT_EMAIL=$(git config user.email 2>/dev/null || echo "")
  if [[ -z "$GIT_EMAIL" ]]; then
    warn "git config user.email is not set"
    ask GIT_EMAIL "Your email for git commits" ""
    if [[ -n "$GIT_EMAIL" ]]; then
      git config --global user.email "$GIT_EMAIL" && ok "Set git user.email: $GIT_EMAIL"
    else
      hard_stop "git user.email is required: git config --global user.email 'you@example.com'"
    fi
  else
    ok "git user.email:  $GIT_EMAIL"
  fi

  GH_USER=$(gh api user --jq .login 2>/dev/null || echo "")
  if [[ -z "$GH_USER" ]]; then
    warn "Not logged in to the GitHub CLI (gh)."
    if confirm_yn "Run 'gh auth login' now (recommended scopes will be requested)?"; then
      gh auth login -h github.com -s "$GOV_SCOPES_CSV" || true
      GH_USER=$(gh api user --jq .login 2>/dev/null || echo "")
    fi
    [[ -n "$GH_USER" ]] || hard_stop "Still not logged in. Run 'gh auth login' and re-run setup.sh."
  fi
  ok "gh user:         $GH_USER"

  if gh api "orgs/$GITHUB_ORG" &>/dev/null; then
    ok "Read access to org '$GITHUB_ORG'"
  elif gh api "users/$GITHUB_ORG" &>/dev/null; then
    ok "'$GITHUB_ORG' is a user account (not an org) — accessible"
  else
    err "Cannot read '$GITHUB_ORG' — not found, or no access"
    hard_stop "Verify github_org in org-config.yaml is correct, you are a member, and gh has 'read:org' scope:
    gh auth refresh -h github.com -s read:org"
  fi

  SCOPES=$(gh auth status 2>&1 | grep -i "Token scopes" | head -1 | sed -E 's/.*Token scopes:[[:space:]]*//' | tr -d "'\"" || echo "")
  if [[ -n "$SCOPES" ]]; then
    ok "Token scopes:    $SCOPES"
    if ! echo "$SCOPES" | grep -qw "repo"; then
      err "Missing required scope: repo"
      hard_stop "Refresh: gh auth refresh -h github.com -s repo"
    fi
    if [[ "$GITHUB_ORG_TYPE" == "org" ]] && ! echo "$SCOPES" | grep -qw "read:org"; then
      warn "Scope 'read:org' not detected — some org operations may fail"
      echo "    Refresh: gh auth refresh -h github.com -s read:org"
    fi
  else
    warn "Could not determine token scopes — assuming sufficient"
  fi

  if git ls-remote origin HEAD &>/dev/null; then
    ok "origin reachable"
  else
    warn "Could not contact 'origin' remote — verify with: git remote -v"
  fi
  if git ls-remote template HEAD &>/dev/null; then
    ok "template reachable"
  else
    warn "Could not contact 'template' remote — verify with: git remote -v"
  fi
fi

# ── Step 7: Bootstrap current user's preferences file ────────────────────────
#
# Per-user preferences live at $PRJ_GOV_LOC/preferences/<gh-login>.md.
# Copy the template here so the developer has a starting point. Never
# overwrite an existing file. Skip silently if no gh login is available.

PREFS_LOGIN=$(gh api user --jq .login 2>/dev/null || echo "")
PREFS_TEMPLATE="$REPO_ROOT/knowledge/guidance/preferences-template.md"
if [[ -n "$PREFS_LOGIN" ]] && [[ -f "$PREFS_TEMPLATE" ]]; then
  PREFS_DIR="$PRJ_GOV_LOC/preferences"
  PREFS_FILE="$PREFS_DIR/$PREFS_LOGIN.md"
  mkdir -p "$PREFS_DIR"
  if [[ -f "$PREFS_FILE" ]]; then
    ok "Preferences:    $PREFS_FILE (kept existing)"
  else
    cp "$PREFS_TEMPLATE" "$PREFS_FILE"
    ok "Preferences:    $PREFS_FILE (created from template)"
  fi
else
  warn "Could not bootstrap preferences file (gh login unavailable)."
  warn "It will be auto-created on first prj write op once gh auth is configured."
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}Configured framework for: $ORG_NAME ($ORG_SLUG)${NC}"
echo ""
echo "Next steps:"
echo "  1. Review changes:    git diff org-config.yaml"
echo "  2. Commit + push:     git add org-config.yaml && git commit -m 'configure framework for $ORG_NAME' && git push origin $DEFAULT_BRANCH"
echo "  3. Edit preferences:  ${PREFS_FILE:-<agent_work_root>/preferences/<your-gh-login>.md}"
echo "  4. Start using:       ./prj"
echo ""
echo "  Framework upgrades:   git fetch template && git merge template/$DEFAULT_BRANCH"
echo ""
