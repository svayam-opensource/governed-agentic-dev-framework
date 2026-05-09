#!/usr/bin/env bash
# install-deps.sh
# Hard-gate environment check for the Agentic Development Framework.
#
# Two phases:
#   Phase 1 — Tools: git, gh, python3, pyyaml are REQUIRED.
#             yq is OPTIONAL (python3+pyyaml covers all functionality).
#   Phase 2 — GitHub identity & access: only runs once org-config.yaml
#             is configured for a real org (not template defaults).
#
# Both phases must pass. The script exits non-zero on any unmet
# precondition — callers cannot proceed with a partial environment.
#
# Supported platforms:
#   - macOS       (via Homebrew)
#   - Ubuntu/Debian Linux  (via apt)
#   - RHEL/Fedora/CentOS   (via dnf/yum)
#   - Arch Linux   (via pacman)
#   - Alpine Linux (via apk)
#   - Windows/WSL  (treated as the underlying Linux distro)
#   - Git Bash/Cygwin on Windows (limited — WSL strongly recommended)
#
# Usage:
#   bash scripts/install-deps.sh           # install missing required deps, then verify
#   bash scripts/install-deps.sh --check   # check only, do not install

set -euo pipefail

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$REPO_ROOT/org-config.yaml"

# ── Output helpers ────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; DIM='\033[2m'; NC='\033[0m'
ok()        { echo -e "${GREEN}  ✓${NC} $*"; }
fail()      { echo -e "${RED}  ✗${NC} $*"; }
warn()      { echo -e "${YELLOW}  !${NC} $*"; }
info()      { echo -e "${CYAN}  →${NC} $*"; }
note()      { echo -e "${DIM}    $*${NC}"; }
hard_stop() { echo ""; echo -e "${RED}HARD STOP:${NC} $*" >&2; echo ""; exit 1; }

# ── OS / distro detection ─────────────────────────────────────────────────────

detect_os() {
  OS=""
  PKG_MGR=""
  case "$(uname -s)" in
    Darwin) OS="macos" ;;
    Linux)
      OS="linux"
      if grep -qi microsoft /proc/version 2>/dev/null; then
        warn "Running inside WSL — treating as Linux."
      fi
      if   command -v apt-get &>/dev/null; then PKG_MGR="apt"
      elif command -v dnf     &>/dev/null; then PKG_MGR="dnf"
      elif command -v yum     &>/dev/null; then PKG_MGR="yum"
      elif command -v pacman  &>/dev/null; then PKG_MGR="pacman"
      elif command -v apk     &>/dev/null; then PKG_MGR="apk"
      else PKG_MGR="unknown"
      fi
      ;;
    MINGW*|CYGWIN*|MSYS*)
      OS="windows-bash"
      warn "Git Bash / Cygwin detected — WSL is strongly recommended."
      PKG_MGR="winget"
      ;;
    *) OS="unknown" ;;
  esac
}

# ── Installers ────────────────────────────────────────────────────────────────

install_brew() {
  if ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
}

install_git() {
  case "$OS-$PKG_MGR" in
    macos-*)        install_brew; brew install git ;;
    linux-apt)      sudo apt-get install -y git ;;
    linux-dnf)      sudo dnf install -y git ;;
    linux-yum)      sudo yum install -y git ;;
    linux-pacman)   sudo pacman -S --noconfirm git ;;
    linux-apk)      sudo apk add --no-cache git ;;
    windows-bash-*) warn "Install Git for Windows from https://git-scm.com/download/win" ;;
    *)              warn "Could not auto-install git — install manually." ;;
  esac
}

install_gh_binary() {
  info "Downloading gh binary from GitHub releases..."
  local GH_VERSION="2.49.2"
  local ARCH=$(uname -m)
  local ARCH_TAG
  case "$ARCH" in
    x86_64)        ARCH_TAG="amd64" ;;
    aarch64|arm64) ARCH_TAG="arm64" ;;
    *)             ARCH_TAG="amd64" ;;
  esac
  local BINARY_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH_TAG}.tar.gz"
  local INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
  local TMP=$(mktemp -d)
  curl -fsSL "$BINARY_URL" | tar -xz -C "$TMP"
  cp "$TMP/gh_${GH_VERSION}_linux_${ARCH_TAG}/bin/gh" "$INSTALL_DIR/gh"
  chmod +x "$INSTALL_DIR/gh"
  rm -rf "$TMP"
  if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    warn "Add $INSTALL_DIR to your PATH:"
    warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc  # or ~/.zshrc"
    export PATH="$INSTALL_DIR:$PATH"
  fi
}

install_gh() {
  case "$OS-$PKG_MGR" in
    macos-*)
      install_brew; brew install gh
      ;;
    linux-apt)
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
      sudo apt-get update -q
      sudo apt-get install -y gh
      ;;
    linux-dnf)
      sudo dnf install -y 'dnf-command(config-manager)'
      sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
      sudo dnf install -y gh
      ;;
    linux-yum)
      sudo yum-config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
      sudo yum install -y gh
      ;;
    linux-pacman)   sudo pacman -S --noconfirm github-cli ;;
    linux-apk)      install_gh_binary ;;
    linux-unknown)  install_gh_binary ;;
    windows-bash-*) warn "Install GitHub CLI from https://cli.github.com or: winget install GitHub.cli" ;;
    *)              warn "Could not auto-install gh — see https://cli.github.com" ;;
  esac
}

install_python3() {
  case "$OS-$PKG_MGR" in
    macos-*)      install_brew; brew install python3 ;;
    linux-apt)    sudo apt-get install -y python3 python3-pip ;;
    linux-dnf)    sudo dnf install -y python3 python3-pip ;;
    linux-yum)    sudo yum install -y python3 python3-pip ;;
    linux-pacman) sudo pacman -S --noconfirm python python-pip ;;
    linux-apk)    sudo apk add --no-cache python3 py3-pip ;;
    *)            warn "Install python3 manually from https://python.org" ;;
  esac
}

install_pyyaml() {
  if python3 -c "import yaml" &>/dev/null; then
    return 0
  fi
  info "Installing PyYAML..."
  case "$OS-$PKG_MGR" in
    macos-*)
      pip3 install --break-system-packages pyyaml \
        || { warn "pip3 failed — trying brew pyyaml..."; brew install pyyaml 2>/dev/null || true; }
      ;;
    linux-apt)
      sudo apt-get install -y python3-yaml 2>/dev/null \
        || pip3 install --user pyyaml
      ;;
    linux-dnf)
      sudo dnf install -y python3-pyyaml 2>/dev/null \
        || pip3 install --user pyyaml
      ;;
    linux-yum)
      sudo yum install -y python3-pyyaml 2>/dev/null \
        || pip3 install --user pyyaml
      ;;
    linux-pacman) sudo pacman -S --noconfirm python-yaml ;;
    linux-apk)    sudo apk add --no-cache py3-yaml ;;
    *)
      pip3 install --user pyyaml \
        || warn "Could not install PyYAML — install manually: pip3 install --user pyyaml"
      ;;
  esac
}

# ── Phase 1: Required + optional tool checks ─────────────────────────────────

echo ""
echo "Agentic Development Framework — Environment Check"
echo "=================================================="
detect_os
echo "  OS:          $OS"
echo "  Pkg manager: ${PKG_MGR:-n/a}"
echo ""
echo "Tools:"

REQUIRED=(git gh python3)
MISSING_REQUIRED=()

for dep in "${REQUIRED[@]}"; do
  if command -v "$dep" &>/dev/null; then
    ok "$dep  ($(command -v "$dep"))"
  else
    fail "$dep  — required, not found"
    MISSING_REQUIRED+=("$dep")
  fi
done

# pyyaml as a python3 module
if command -v python3 &>/dev/null && python3 -c "import yaml" &>/dev/null; then
  ok "pyyaml  (python3 module)"
elif command -v python3 &>/dev/null; then
  fail "pyyaml  — required python3 module, not found"
  MISSING_REQUIRED+=("pyyaml")
fi

# yq is optional — python3 + pyyaml covers all functionality
if command -v yq &>/dev/null; then
  ok "yq      ($(command -v yq))  ${DIM}[optional]${NC}"
else
  info "yq      not installed  ${DIM}[optional — python3 + pyyaml covers all functionality]${NC}"
fi

echo ""

# Auto-install required if not in --check mode
if [[ ${#MISSING_REQUIRED[@]} -gt 0 ]]; then
  if $CHECK_ONLY; then
    hard_stop "Missing required: ${MISSING_REQUIRED[*]}. Run without --check to attempt auto-install."
  fi
  echo "Installing missing required tools: ${MISSING_REQUIRED[*]}"
  echo ""
  for dep in "${MISSING_REQUIRED[@]}"; do
    info "Installing $dep..."
    case "$dep" in
      git)     install_git ;;
      gh)      install_gh ;;
      python3) install_python3 ;;
      pyyaml)  install_pyyaml ;;
    esac
  done

  # Re-verify
  echo ""
  echo "Re-verifying..."
  ALL_OK=true
  for dep in "${MISSING_REQUIRED[@]}"; do
    if [[ "$dep" == "pyyaml" ]]; then
      if python3 -c "import yaml" &>/dev/null; then
        ok "pyyaml  (python3 module)"
      else
        fail "pyyaml  — still not installed"
        ALL_OK=false
      fi
    else
      if command -v "$dep" &>/dev/null; then
        ok "$dep  ($(command -v "$dep"))"
      else
        fail "$dep  — still not installed"
        ALL_OK=false
      fi
    fi
  done
  $ALL_OK || hard_stop "Required tools could not be installed. See warnings above; install manually then re-run."
  echo ""
fi

# ── gh authentication ─────────────────────────────────────────────────────────

echo "GitHub CLI auth:"
if ! gh auth status &>/dev/null; then
  fail "gh CLI is not authenticated"
  hard_stop "Run: gh auth login"
fi
ok "gh authenticated"

# ── Phase 2: GitHub identity & access (if org-config.yaml is configured) ─────

read_yaml() {
  local key="$1"
  if command -v yq &>/dev/null; then
    yq ".$key" "$CONFIG" 2>/dev/null | tr -d '"' | sed 's/^null$//'
  else
    python3 -c "import yaml; v = yaml.safe_load(open('$CONFIG')).get('$key', ''); print(v if v is not None else '')" 2>/dev/null
  fi
}

if [[ ! -f "$CONFIG" ]]; then
  hard_stop "org-config.yaml not found at $CONFIG"
fi

GITHUB_ORG=$(read_yaml github_org)

# Detect template-default state — skip Phase 2, point user at setup.sh
if [[ -z "$GITHUB_ORG" || "$GITHUB_ORG" == "your-github-org" ]]; then
  echo ""
  warn "org-config.yaml is at template defaults — Phase 2 (GitHub access) skipped."
  echo ""
  ok "Tools-only check passed."
  echo ""
  echo "Next: run setup.sh to configure for your org, then re-run this script"
  echo "to verify GitHub access."
  echo ""
  exit 0
fi

echo ""
echo "GitHub identity & access:"

# git user.email
GIT_EMAIL=$(git config user.email 2>/dev/null || echo "")
if [[ -z "$GIT_EMAIL" ]]; then
  fail "git config user.email is not set"
  hard_stop "Set it: git config --global user.email 'you@example.com'"
fi
ok "git user.email:  $GIT_EMAIL"

# gh user
GH_USER=$(gh api user --jq .login 2>/dev/null || echo "")
if [[ -z "$GH_USER" ]]; then
  hard_stop "Could not retrieve gh user. Run: gh auth login"
fi
ok "gh user:         $GH_USER"

# Org read access
if gh api "orgs/$GITHUB_ORG" &>/dev/null; then
  ok "Read access to org '$GITHUB_ORG'"
else
  # Maybe it's a personal account (gh users), not an org
  if gh api "users/$GITHUB_ORG" &>/dev/null; then
    ok "'$GITHUB_ORG' is a user account (not an org) — accessible"
  else
    fail "Cannot read '$GITHUB_ORG' — not found, or no access"
    hard_stop "Verify github_org in org-config.yaml is correct, you are a member, and gh has 'read:org' scope:
    gh auth refresh -h github.com -s read:org"
  fi
fi

# Token scopes
SCOPES=$(gh auth status 2>&1 | grep -i "Token scopes" | head -1 | sed -E 's/.*Token scopes:[[:space:]]*//' | tr -d "'\"" || echo "")
if [[ -n "$SCOPES" ]]; then
  ok "Token scopes:    $SCOPES"
  for required in "repo"; do
    if ! echo "$SCOPES" | grep -qw "$required"; then
      fail "Missing required scope: $required"
      hard_stop "Refresh: gh auth refresh -h github.com -s $required"
    fi
  done
  # read:org is needed for org membership reads — only enforce if github_org is an org (not a user)
  if gh api "orgs/$GITHUB_ORG" &>/dev/null; then
    if ! echo "$SCOPES" | grep -qw "read:org"; then
      warn "Scope 'read:org' not detected — some org operations may fail"
      note "Refresh: gh auth refresh -h github.com -s read:org"
    fi
  fi
else
  warn "Could not determine token scopes — assuming sufficient"
fi

# Push access to workspace repo (lightweight: ls-remote)
WORKSPACE_REPO=$(read_yaml workspace_repo)
if [[ -n "$WORKSPACE_REPO" && "$WORKSPACE_REPO" != "000-org-prj" ]]; then
  if cd "$REPO_ROOT" && git ls-remote origin HEAD &>/dev/null; then
    ok "Origin remote accessible"
  else
    warn "Could not contact 'origin' remote — verify it's set and you have access"
    note "Check: git remote -v"
  fi
fi

echo ""
ok "Environment ready."
echo ""
