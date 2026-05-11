#!/usr/bin/env bash
# Agentic Development Framework — Organization Setup Script
#
# Interactive: prompts for each org-config value with sensible defaults.
# Auto-derives github_org and workspace_repo from `git remote get-url origin`.
# Refuses to proceed if origin points at the framework template (a common
# adopter foot-gun: cloning the template directly instead of using
# "Use this template" on GitHub).
#
# Usage:
#   bash setup.sh                  # interactive (default)
#   bash setup.sh --non-interactive  # use existing org-config.yaml as-is,
#                                    # skip prompts (for CI / re-runs)
#
# After successful run, all {{PLACEHOLDER}} tokens in *.md, *.yaml, *.yml,
# and CODEOWNERS files are substituted with the configured values.

set -euo pipefail

NON_INTERACTIVE=false
[[ "${1:-}" == "--non-interactive" ]] && NON_INTERACTIVE=true

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$REPO_ROOT/org-config.yaml"

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

# NOTE: helpers below use unique internal variable names (__rabort_val,
# __ask_val, __validated_val) to avoid shadowing the caller's __val via
# bash's dynamic scoping. printf -v writes to the closest local in scope —
# if both inner and outer scopes declare `local __val`, the inner wins
# and the value never propagates back to the caller.

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

# Slug: 2-6 chars, must start with a letter, A-Z and 0-9 only after.
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

# Date: YYYY-MM-DD format (lightweight check).
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
  hard_stop "No 'origin' remote configured.

Set one up first:
  git remote add origin <YOUR_REPO_URL>

Then re-run setup.sh."
fi

# Parse owner/repo from URL.  Accepts:
#   git@github.com:owner/repo.git
#   git@github.com:owner/repo
#   https://github.com/owner/repo.git
#   https://github.com/owner/repo
#   ssh://git@github.com/owner/repo.git
ORIGIN_NORMALIZED="${ORIGIN_URL%.git}"
ORIGIN_OWNER=""
ORIGIN_REPO=""
if [[ "$ORIGIN_NORMALIZED" =~ github\.com[:/]([^/]+)/(.+)$ ]]; then
  ORIGIN_OWNER="${BASH_REMATCH[1]}"
  ORIGIN_REPO="${BASH_REMATCH[2]}"
fi

if [[ -z "$ORIGIN_OWNER" || -z "$ORIGIN_REPO" ]]; then
  hard_stop "Could not parse owner/repo from origin URL: $ORIGIN_URL"
fi

# Refuse if origin points at the framework's source template
if [[ "$ORIGIN_OWNER" == "Svayamtech" && "$ORIGIN_REPO" == "agentic-development-framework" ]]; then
  hard_stop "This repo's 'origin' remote points at the framework's source template:

  $ORIGIN_URL

Your changes would commit to the upstream template, not your org's
workspace. To fix:

  (a) RECOMMENDED: discard this clone. Go to
        https://github.com/Svayamtech/agentic-development-framework
      and click 'Use this template' to create your own private repo,
      then clone that.

  (b) Or re-target this clone to YOUR repo:
        git remote set-url origin <YOUR_REPO_URL>
        git push -u origin main
      Then re-run setup.sh."
fi

# ── Step 2: Read existing config + runtime detections ────────────────────────

CURRENT_ORG_NAME=$(read_yaml_field org_name)
CURRENT_ORG_SHORT=$(read_yaml_field org_short_name)
CURRENT_ORG_SLUG=$(read_yaml_field org_slug)
CURRENT_DEFAULT_BRANCH=$(read_yaml_field default_branch)
CURRENT_DEFAULT_CODE_BRANCH=$(read_yaml_field default_code_branch)
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

# Helper: returns the second arg if the first is "" or matches a known template default.
default_or() {
  local current="$1" fallback="$2"
  case "$current" in
    "" | "Your Organization Name" | "YourOrg" | "ORG" | "org" \
       | "your-github-org" | "000-org-prj" | "you@example.com" \
       | "@your-github-handle" | "@legal-owner-tbd" \
       | "@infrastructure-owner-tbd" | "@system-arch-owner-tbd" \
       | "@data-arch-owner-tbd" | "YYYY-MM-DD")
      echo "$fallback"
      ;;
    *)
      echo "$current"
      ;;
  esac
}

# ── Step 3: Prompt (or skip in --non-interactive) ─────────────────────────────

if $NON_INTERACTIVE; then
  warn "--non-interactive: using existing org-config.yaml values as-is."
  if [[ -z "$CURRENT_ORG_NAME" || "$CURRENT_ORG_NAME" == "Your Organization Name" ]]; then
    hard_stop "org-config.yaml is at template defaults. Run setup.sh interactively first."
  fi
  ORG_NAME="$CURRENT_ORG_NAME"
  ORG_SHORT_NAME="$CURRENT_ORG_SHORT"
  ORG_SLUG="$CURRENT_ORG_SLUG"
  ORG_SLUG_LOWER=$(echo "$ORG_SLUG" | tr '[:upper:]' '[:lower:]')
  GITHUB_ORG="$ORIGIN_OWNER"
  WORKSPACE_REPO="$ORIGIN_REPO"
  DEFAULT_BRANCH="$CURRENT_DEFAULT_BRANCH"
  DEFAULT_CODE_BRANCH="$CURRENT_DEFAULT_CODE_BRANCH"
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
  echo "  Origin remote:    ${ORIGIN_OWNER}/${ORIGIN_REPO}"
  [[ -n "$GH_USER"   ]] && echo "  Detected gh user: ${GH_USER}"
  [[ -n "$GIT_EMAIL" ]] && echo "  Git user.email:   ${GIT_EMAIL}"
  echo ""
  echo "Press Enter to accept the [default] for any prompt."

  header "Organization"
  ask_required ORG_NAME       "Full legal name of your organization" "$(default_or "$CURRENT_ORG_NAME"  "")"
  ask_required ORG_SHORT_NAME "Short display name (used in headings)"  "$(default_or "$CURRENT_ORG_SHORT" "")"
  ask_slug     ORG_SLUG       "Org slug (uppercase, 2-6 chars; e.g. ACME, NORDIC)" "$(default_or "$CURRENT_ORG_SLUG" "")"
  ORG_SLUG_LOWER=$(echo "$ORG_SLUG" | tr '[:upper:]' '[:lower:]')
  echo ""
  ok "org_slug:        $ORG_SLUG"
  ok "org_slug_lower:  $ORG_SLUG_LOWER  (auto-derived)"
  ok "github_org:      $ORIGIN_OWNER  (from origin remote)"
  ok "workspace_repo:  $ORIGIN_REPO    (from origin remote)"
  GITHUB_ORG="$ORIGIN_OWNER"
  WORKSPACE_REPO="$ORIGIN_REPO"

  header "Branches"
  ask DEFAULT_BRANCH      "Default branch for this workspace repo"     "$(default_or "$CURRENT_DEFAULT_BRANCH" "main")"
  ask DEFAULT_CODE_BRANCH "Default base branch for code repositories"  "$(default_or "$CURRENT_DEFAULT_CODE_BRANCH" "dev")"

  header "Policy Owner (initial holder of all policy roles)"
  POLICY_EMAIL_DEFAULT=$(default_or "$CURRENT_POLICY_OWNER_EMAIL" "$GIT_EMAIL")
  ask_required POLICY_OWNER_EMAIL  "Policy Owner email"             "$POLICY_EMAIL_DEFAULT"
  POLICY_GITHUB_DEFAULT=$(default_or "$CURRENT_POLICY_OWNER_GITHUB" "${GH_USER:+@$GH_USER}")
  ask_required POLICY_OWNER_GITHUB "Policy Owner GitHub @-handle"   "$POLICY_GITHUB_DEFAULT"

  header "Domain Owners"
  echo "  Per the default policy, all domain roles are held by the Policy Owner"
  echo "  at launch. Press Enter to accept '$POLICY_OWNER_GITHUB' for each."
  LEGAL_DEFAULT=$(default_or "$CURRENT_LEGAL"     "$POLICY_OWNER_GITHUB")
  INFRA_DEFAULT=$(default_or "$CURRENT_INFRA"     "$POLICY_OWNER_GITHUB")
  SYS_ARCH_DEFAULT=$(default_or "$CURRENT_SYS_ARCH" "$POLICY_OWNER_GITHUB")
  DATA_ARCH_DEFAULT=$(default_or "$CURRENT_DATA_ARCH" "$POLICY_OWNER_GITHUB")
  ask LEGAL_OWNER_GITHUB         "Legal Owner"                  "$LEGAL_DEFAULT"
  ask INFRA_OWNER_GITHUB         "Infrastructure Owner"         "$INFRA_DEFAULT"
  ask SYSTEM_ARCH_OWNER_GITHUB   "System Architecture Owner"    "$SYS_ARCH_DEFAULT"
  ask DATA_ARCH_OWNER_GITHUB     "Data Architecture Owner"      "$DATA_ARCH_DEFAULT"

  header "Policy"
  ask_date POLICY_EFFECTIVE_DATE "Policy effective date (YYYY-MM-DD)" "$(default_or "$CURRENT_POLICY_DATE" "$TODAY")"

  echo ""
  echo "Configured values:"
  echo "  org_name:                $ORG_NAME"
  echo "  org_short_name:          $ORG_SHORT_NAME"
  echo "  org_slug:                $ORG_SLUG"
  echo "  github_org:              $GITHUB_ORG"
  echo "  workspace_repo:          $WORKSPACE_REPO"
  echo "  default_branch:          $DEFAULT_BRANCH"
  echo "  default_code_branch:     $DEFAULT_CODE_BRANCH"
  echo "  policy_owner_email:      $POLICY_OWNER_EMAIL"
  echo "  policy_owner_github:     $POLICY_OWNER_GITHUB"
  echo "  legal_owner_github:      $LEGAL_OWNER_GITHUB"
  echo "  infra_owner_github:      $INFRA_OWNER_GITHUB"
  echo "  system_arch_owner_github:$SYSTEM_ARCH_OWNER_GITHUB"
  echo "  data_arch_owner_github:  $DATA_ARCH_OWNER_GITHUB"
  echo "  policy_effective_date:   $POLICY_EFFECTIVE_DATE"
  echo ""
fi

# ── Step 4: Write org-config.yaml ─────────────────────────────────────────────

cat > "$CONFIG" <<EOF
# Agentic Development Framework — Organization Configuration
#
# This file is the single source of truth for org-specific values.
# Re-run setup.sh after editing to substitute values throughout the framework.

# Full legal name of your organization
org_name: "$ORG_NAME"

# Short display name (used in headings and prose)
org_short_name: "$ORG_SHORT_NAME"

# Uppercase slug used as prefix for all project IDs (e.g. ACME → ACME-001-my-project)
# Keep it short (2-6 characters), uppercase, no spaces or special characters
org_slug: "$ORG_SLUG"

# Lowercase version of org_slug — used in branch names (e.g. acme-001-my-project)
# Auto-derived from org_slug — usually no need to edit manually
org_slug_lower: "$ORG_SLUG_LOWER"

# GitHub organization or username where all repos live (auto-detected from origin)
github_org: "$GITHUB_ORG"

# Name of this central workspace repository (auto-detected from origin)
workspace_repo: "$WORKSPACE_REPO"

# Default branch name for this workspace repo
default_branch: "$DEFAULT_BRANCH"

# Default base branch for code repositories (used by seed script)
default_code_branch: "$DEFAULT_CODE_BRANCH"

# Policy Owner details (current holder of all policy roles at launch)
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

# ── Step 5: Substitute placeholders throughout files ─────────────────────────

header "Substituting placeholders"

# Use perl for portable in-place editing (BSD sed -i and GNU sed -i differ).
# Files: *.md, *.yaml, *.yml, CODEOWNERS — never org-config.yaml or setup.sh.
FILE_LIST=$(find "$REPO_ROOT" \
  -not -path "$REPO_ROOT/.git/*" \
  -not -name 'org-config.yaml' \
  -not -name 'setup.sh' \
  \( -name '*.md' -o -name '*.yaml' -o -name '*.yml' -o -name 'CODEOWNERS' \))

COUNT=0
while IFS= read -r FILE; do
  [[ -z "$FILE" ]] && continue
  perl -pi \
    -e "s|\\{\\{ORG_NAME\\}\\}|$ORG_NAME|g;" \
    -e "s|\\{\\{ORG_SHORT_NAME\\}\\}|$ORG_SHORT_NAME|g;" \
    -e "s|\\{\\{ORG_SLUG\\}\\}|$ORG_SLUG|g;" \
    -e "s|\\{\\{org_slug\\}\\}|$ORG_SLUG_LOWER|g;" \
    -e "s|\\{\\{GITHUB_ORG\\}\\}|$GITHUB_ORG|g;" \
    -e "s|\\{\\{WORKSPACE_REPO\\}\\}|$WORKSPACE_REPO|g;" \
    -e "s|\\{\\{DEFAULT_BRANCH\\}\\}|$DEFAULT_BRANCH|g;" \
    -e "s|\\{\\{DEFAULT_CODE_BRANCH\\}\\}|$DEFAULT_CODE_BRANCH|g;" \
    -e "s|\\{\\{POLICY_OWNER_EMAIL\\}\\}|$POLICY_OWNER_EMAIL|g;" \
    -e "s|\\{\\{POLICY_OWNER_GITHUB\\}\\}|$POLICY_OWNER_GITHUB|g;" \
    -e "s|\\{\\{LEGAL_OWNER_GITHUB\\}\\}|$LEGAL_OWNER_GITHUB|g;" \
    -e "s|\\{\\{INFRA_OWNER_GITHUB\\}\\}|$INFRA_OWNER_GITHUB|g;" \
    -e "s|\\{\\{SYSTEM_ARCH_OWNER_GITHUB\\}\\}|$SYSTEM_ARCH_OWNER_GITHUB|g;" \
    -e "s|\\{\\{DATA_ARCH_OWNER_GITHUB\\}\\}|$DATA_ARCH_OWNER_GITHUB|g;" \
    -e "s|\\{\\{POLICY_EFFECTIVE_DATE\\}\\}|$POLICY_EFFECTIVE_DATE|g;" \
    "$FILE"
  COUNT=$((COUNT + 1))
done <<< "$FILE_LIST"

ok "Placeholders substituted in $COUNT files"

# ── Verify GitHub identity & access ──────────────────────────────────────────
#
# Skipped when:
#   - --non-interactive   (CI / sync contexts where the auth might differ)
#   - SETUP_SKIP_GITHUB_VERIFY=1   (test escape hatch)
#
# Hard-stops on any unmet precondition with an actionable remediation.

if $NON_INTERACTIVE || [[ "${SETUP_SKIP_GITHUB_VERIFY:-}" == "1" ]]; then
  :  # skip — appropriate for re-runs / CI / tests
else
  header "Verifying GitHub access"

  # git user.email
  GIT_EMAIL=$(git config user.email 2>/dev/null || echo "")
  if [[ -z "$GIT_EMAIL" ]]; then
    err "git config user.email is not set"
    hard_stop "Set it: git config --global user.email 'you@example.com'"
  fi
  ok "git user.email:  $GIT_EMAIL"

  # gh user
  GH_USER=$(gh api user --jq .login 2>/dev/null || echo "")
  if [[ -z "$GH_USER" ]]; then
    hard_stop "Could not retrieve gh user. Run: gh auth login"
  fi
  ok "gh user:         $GH_USER"

  # Org / user read access for github_org
  if gh api "orgs/$GITHUB_ORG" &>/dev/null; then
    ok "Read access to org '$GITHUB_ORG'"
    GITHUB_ORG_TYPE="org"
  elif gh api "users/$GITHUB_ORG" &>/dev/null; then
    ok "'$GITHUB_ORG' is a user account (not an org) — accessible"
    GITHUB_ORG_TYPE="user"
  else
    err "Cannot read '$GITHUB_ORG' — not found, or no access"
    hard_stop "Verify github_org in org-config.yaml is correct, you are a member, and gh has 'read:org' scope:
    gh auth refresh -h github.com -s read:org"
  fi

  # Token scopes
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

  # Origin remote reachable (lightweight: ls-remote)
  if git ls-remote origin HEAD &>/dev/null; then
    ok "Origin remote accessible"
  else
    warn "Could not contact 'origin' remote — verify with: git remote -v"
  fi
fi

# ── Bootstrap the current user's preferences file ──────────────────────────
#
# Per-user preferences live at $AGENT_WORK_ROOT/preferences/<gh-login>.md.
# Copy the template here so the developer has a starting point. Never
# overwrite an existing file. Skip silently if no gh login is available.

AGENT_WORK_ROOT="${AGENT_WORK_ROOT:-$HOME/work}"
PREFS_LOGIN=$(gh api user --jq .login 2>/dev/null || echo "")
PREFS_TEMPLATE="$REPO_ROOT/knowledge/guidance/preferences-template.md"
if [[ -n "$PREFS_LOGIN" ]] && [[ -f "$PREFS_TEMPLATE" ]]; then
  PREFS_DIR="$AGENT_WORK_ROOT/preferences"
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
echo "  1. Review changes:    git diff"
echo "  2. Commit + push:     git add -A && git commit -m 'configure framework for $ORG_NAME' && git push origin $DEFAULT_BRANCH"
echo "  3. Edit preferences:  ${PREFS_FILE:-<AGENT_WORK_ROOT>/preferences/<your-gh-login>.md}"
echo "  4. Start using:       ./prj"
echo ""
