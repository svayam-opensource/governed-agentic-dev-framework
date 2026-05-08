#!/usr/bin/env bash
# install-deps.sh
# Installs all dependencies required by the {{ORG_SHORT_NAME}} Agentic Development Framework scripts.
#
# Dependencies:
#   - git    (version control — usually pre-installed)
#   - gh     (GitHub CLI — https://cli.github.com)
#   - yq     (YAML processor, mikefarah/yq v4 — https://github.com/mikefarah/yq)
#   - python3 (fallback YAML processor — usually pre-installed)
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
#   bash scripts/install-deps.sh          # install all missing deps
#   bash scripts/install-deps.sh --check  # check only, do not install

set -euo pipefail

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

# ── Colour output ─────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; }
warn() { echo -e "${YELLOW}  !${NC} $*"; }
info() { echo -e "${CYAN}  →${NC} $*"; }

# ── OS / distro detection ─────────────────────────────────────────────────────

detect_os() {
  OS=""
  DISTRO=""
  PKG_MGR=""

  case "$(uname -s)" in
    Darwin)
      OS="macos"
      ;;
    Linux)
      OS="linux"
      # WSL detection
      if grep -qi microsoft /proc/version 2>/dev/null; then
        warn "Running inside WSL — treating as Linux."
      fi
      # Distro detection
      if   command -v apt-get &>/dev/null; then PKG_MGR="apt"
      elif command -v dnf     &>/dev/null; then PKG_MGR="dnf"
      elif command -v yum     &>/dev/null; then PKG_MGR="yum"
      elif command -v pacman  &>/dev/null; then PKG_MGR="pacman"
      elif command -v apk     &>/dev/null; then PKG_MGR="apk"
      else
        PKG_MGR="unknown"
      fi
      ;;
    MINGW*|CYGWIN*|MSYS*)
      OS="windows-bash"
      warn "Git Bash / Cygwin detected."
      warn "These scripts are designed for Unix shells."
      warn "WSL (Windows Subsystem for Linux) is strongly recommended."
      warn "Attempting to continue — some features may not work correctly."
      PKG_MGR="winget"
      ;;
    *)
      OS="unknown"
      ;;
  esac
}

# ── Individual installers ─────────────────────────────────────────────────────

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

install_gh() {
  case "$OS-$PKG_MGR" in
    macos-*)
      install_brew
      brew install gh
      ;;
    linux-apt)
      # Official GitHub CLI apt repo
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
    linux-pacman)
      sudo pacman -S --noconfirm github-cli
      ;;
    linux-apk)
      # gh not in Alpine repos — use direct binary download
      install_gh_binary
      ;;
    linux-unknown)
      install_gh_binary
      ;;
    windows-bash-*)
      warn "Install GitHub CLI from https://cli.github.com or: winget install GitHub.cli"
      ;;
    *)
      warn "Could not auto-install gh — see https://cli.github.com"
      ;;
  esac
}

install_yq() {
  case "$OS-$PKG_MGR" in
    macos-*)
      install_brew
      brew install yq
      ;;
    linux-apt)
      # Try snap first, fall back to binary
      if command -v snap &>/dev/null; then
        sudo snap install yq
      else
        install_yq_binary
      fi
      ;;
    linux-dnf|linux-yum)
      install_yq_binary
      ;;
    linux-pacman)
      sudo pacman -S --noconfirm go-yq
      ;;
    linux-apk)
      install_yq_binary
      ;;
    linux-unknown)
      install_yq_binary
      ;;
    windows-bash-*)
      warn "Install yq from https://github.com/mikefarah/yq/releases or: winget install MikeFarah.yq"
      ;;
    *)
      install_yq_binary
      ;;
  esac
}

install_yq_binary() {
  # Direct binary download from GitHub releases (works on any Linux/macOS)
  info "Downloading yq binary from GitHub releases..."
  YQ_VERSION="v4.44.2"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH_TAG="amd64" ;;
    aarch64|arm64) ARCH_TAG="arm64" ;;
    *)       ARCH_TAG="amd64"; warn "Unknown arch $ARCH — trying amd64" ;;
  esac
  OS_TAG="linux"
  [[ "$OS" == "macos" ]] && OS_TAG="darwin"
  BINARY_URL="https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_${OS_TAG}_${ARCH_TAG}"
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
  curl -fsSL "$BINARY_URL" -o "$INSTALL_DIR/yq"
  chmod +x "$INSTALL_DIR/yq"
  # Ensure ~/.local/bin is in PATH
  if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    warn "Add $INSTALL_DIR to your PATH:"
    warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc  # or ~/.zshrc"
    export PATH="$INSTALL_DIR:$PATH"
  fi
}

install_pyyaml() {
  if python3 -c "import yaml" &>/dev/null; then
    return 0  # already installed
  fi
  info "Installing PyYAML..."
  case "$OS-$PKG_MGR" in
    macos-*)
      # Homebrew Python uses PEP 668 — --break-system-packages is the correct flag
      pip3 install --break-system-packages pyyaml \
        || { warn "pip3 failed — trying brew python3-yaml..."; brew install pyyaml 2>/dev/null || true; }
      ;;
    linux-apt)
      # Try distro package first (no pip needed), fall back to pip --user
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
    linux-pacman)
      sudo pacman -S --noconfirm python-yaml
      ;;
    linux-apk)
      sudo apk add --no-cache py3-yaml
      ;;
    *)
      pip3 install --user pyyaml \
        || warn "Could not install PyYAML — install manually: pip3 install --user pyyaml"
      ;;
  esac
}

install_gh_binary() {
  info "Downloading gh binary from GitHub releases..."
  GH_VERSION="2.49.2"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH_TAG="amd64" ;;
    aarch64|arm64) ARCH_TAG="arm64" ;;
    *)       ARCH_TAG="amd64" ;;
  esac
  BINARY_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH_TAG}.tar.gz"
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
  TMP=$(mktemp -d)
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

# ── Check / install each dependency ──────────────────────────────────────────

check_dep() {
  local name="$1" cmd="$2"
  if command -v "$cmd" &>/dev/null; then
    ok "$name  ($(command -v "$cmd"))"
    return 0
  else
    fail "$name  — not found"
    return 1
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

echo ""
echo "{{ORG_SHORT_NAME}} Agentic Development Framework — Dependency Check"
echo "========================================================"
detect_os
echo "  OS:          $OS"
echo "  Pkg manager: ${PKG_MGR:-n/a}"
echo ""

MISSING=()

echo "Checking dependencies..."
check_dep "git"     "git"     || MISSING+=("git")
check_dep "gh"      "gh"      || MISSING+=("gh")
check_dep "yq"      "yq"      || MISSING+=("yq")
check_dep "python3" "python3" || MISSING+=("python3")
# Check PyYAML separately — python3 can be present without it
if command -v python3 &>/dev/null; then
  if python3 -c "import yaml" &>/dev/null; then
    ok "pyyaml  (python3 module)"
  else
    fail "pyyaml  — not found (python3 module)"
    MISSING+=("pyyaml")
  fi
fi
echo ""

if [[ ${#MISSING[@]} -eq 0 ]]; then
  ok "All dependencies satisfied."
  echo ""
  # Verify gh is authenticated
  if ! gh auth status &>/dev/null; then
    warn "gh is installed but not authenticated."
    warn "Run: gh auth login"
  else
    ok "gh is authenticated."
  fi
  echo ""
  exit 0
fi

if $CHECK_ONLY; then
  echo "Missing: ${MISSING[*]}"
  echo "Run without --check to install."
  exit 1
fi

echo "Installing missing dependencies: ${MISSING[*]}"
echo ""

for dep in "${MISSING[@]}"; do
  info "Installing $dep..."
  case "$dep" in
    git)     install_git ;;
    gh)      install_gh ;;
    yq)      install_yq ;;
    pyyaml)  install_pyyaml ;;
    python3)
      case "$OS-$PKG_MGR" in
        macos-*)      install_brew; brew install python3 ;;
        linux-apt)    sudo apt-get install -y python3 ;;
        linux-dnf)    sudo dnf install -y python3 ;;
        linux-yum)    sudo yum install -y python3 ;;
        linux-pacman) sudo pacman -S --noconfirm python ;;
        linux-apk)    sudo apk add --no-cache python3 ;;
        *)            warn "Install python3 manually from https://python.org" ;;
      esac
      ;;
  esac
done

echo ""
echo "Verifying..."
ALL_OK=true
for dep in "${MISSING[@]}"; do
  if [[ "$dep" == "pyyaml" ]]; then
    if python3 -c "import yaml" &>/dev/null; then
      ok "pyyaml  (python3 module)"
    else
      fail "pyyaml  — still not found"; ALL_OK=false
    fi
  else
    check_dep "$dep" "$dep" || ALL_OK=false
  fi
done
echo ""

if $ALL_OK; then
  ok "All dependencies installed successfully."
  echo ""
  if ! gh auth status &>/dev/null; then
    warn "gh is not yet authenticated. Run: gh auth login"
  fi
else
  fail "Some dependencies could not be installed. See warnings above."
  exit 1
fi
