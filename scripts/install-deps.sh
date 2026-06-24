#!/usr/bin/env bash
# install-deps.sh
# Hard-gate tool check for the Agentic Development Framework.
#
# Verifies the local toolchain is ready:
#   Required: git, gh (authenticated), python3, pyyaml
#   Optional: yq  (python3+pyyaml covers all functionality)
#
# Auto-installs missing required tools (or hard-stops in --check mode).
#
# GitHub identity & access verification (which org / which user) lives
# in setup.sh, where the configured github_org is known. Run setup.sh
# next to configure your org; it will verify access against the values
# you provide.
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

# gh AUTHENTICATION is intentionally NOT checked here — install-deps is tools-only
# (v0.1.1). GitHub identity + access verification lives in setup.sh, where the configured
# github_org is known. Checking `gh auth status` here also broke non-interactive CI (no
# auth) and any fresh machine before `gh auth login`.

echo ""
ok "All required tools installed."
echo ""
echo "Next: bash setup.sh   (configure for your org and verify GitHub access)"
echo ""
