#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# gov bootstrap installer — macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/svayam-opensource/governed-agentic-dev-framework/main/install.sh | bash
#
# WHY THIS EXISTS. `gov` runs on Node 24, so it cannot install Node 24 — the whole
# class of first-run failure happens before `gov` exists to help. Three of them,
# all reported by real adopters on their first command (#186):
#
#   1. `npm WARN EBADENGINE` on Node 16 — a warning, not a gate. npm installs
#      anyway and `gov` fails later, far from the cause.
#   2. `EACCES … mkdir '/usr/local/lib/node_modules'` — the global npm prefix is
#      a system directory the user cannot write.
#   3. On RHEL 9, `dnf install nodejs` refuses: the distro's Node 16 is a module
#      stream that `npm` depends on, so the two cannot coexist.
#
# All three vanish under one decision: DO NOT TOUCH THE SYSTEM. Node is fetched
# from nodejs.org as a tarball and unpacked under the user's home directory. No
# package manager, no sudo, no conflict with whatever the distro shipped.
#
# DEPENDENCIES ARE DELIBERATELY curl + tar. A version manager (fnm, nvm) would be
# the idiomatic choice, but fnm's own installer needs `unzip`, which minimal RHEL
# and Debian images do not have — reintroducing exactly the "install this first"
# problem this script exists to remove. `curl` and `tar` are present everywhere
# this script can plausibly run.

set -euo pipefail

NODE_MAJOR=24
# Overridable so a pre-release build can be tested through the SAME path an adopter
# takes, rather than through a different one that proves less: GOV_PKG=/path/to.tgz
# or GOV_PKG='@svayam-opensource/gov@next'.
GOV_PKG="${GOV_PKG:-@svayam-opensource/gov}"
GOV_HOME="${GOV_INSTALL_DIR:-$HOME/.local/share/gov}"
NODE_DIR="$GOV_HOME/node"

# ── output ────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
else
  B=""; DIM=""; GRN=""; YEL=""; RED=""; RST=""
fi
# Display a path with $HOME shortened to ~. Written as a function because
# "${p/#$HOME/\~}" keeps the backslash in bash and prints a literal \~.
tilde() { case "$1" in "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;; *) printf '%s' "$1" ;; esac; }
say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$B" "$RST" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
skip() { printf '  %s·%s %s %s(already present)%s\n' "$DIM" "$RST" "$*" "$DIM" "$RST"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

# ── platform ──────────────────────────────────────────────────────────────────
detect_platform() {
  local os arch
  case "$(uname -s)" in
    Linux)  os=linux ;;
    Darwin) os=darwin ;;
    *) die "unsupported operating system: $(uname -s). On Windows, use install.ps1 in PowerShell." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)  arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) die "unsupported CPU architecture: $(uname -m). Node 24 is published for x64 and arm64 only." ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

need() { command -v "$1" >/dev/null 2>&1; }

# Node's own major version, or 0 when absent/unreadable.
node_major() {
  need node || { echo 0; return; }
  node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0
}

# ── the shell profile we append PATH to ───────────────────────────────────────
profile_file() {
  case "$(basename "${SHELL:-/bin/bash}")" in
    zsh)  printf '%s/.zshrc'  "$HOME" ;;
    bash) if [ "$(uname -s)" = "Darwin" ]; then printf '%s/.bash_profile' "$HOME"; else printf '%s/.bashrc' "$HOME"; fi ;;
    *)    printf '%s/.profile' "$HOME" ;;
  esac
}

MARKER="# added by the gov installer"

add_to_path() {
  local dir="$1" prof; prof="$(profile_file)"
  touch "$prof"
  if grep -Fq "$dir" "$prof" 2>/dev/null; then
    skip "PATH entry in $(tilde "$prof")"
  else
    { printf '\n%s\n' "$MARKER"; printf 'export PATH="%s:$PATH"\n' "$dir"; } >> "$prof"
    ok "added to PATH in $(tilde "$prof")"
  fi
  PROFILE_TOUCHED="$prof"
}

# ── steps ─────────────────────────────────────────────────────────────────────
install_node() {
  local plat="$1" have; have="$(node_major)"

  if [ "$have" -ge "$NODE_MAJOR" ] 2>/dev/null; then
    skip "Node $(node -v)"
    return
  fi
  if [ -x "$NODE_DIR/bin/node" ]; then
    local mine; mine="$("$NODE_DIR/bin/node" -v 2>/dev/null || echo "")"
    if [ -n "$mine" ]; then
      skip "Node $mine (installed here previously)"
      export PATH="$NODE_DIR/bin:$PATH"
      return
    fi
  fi

  if [ "$have" -gt 0 ]; then
    warn "Node v$have is installed and too old — leaving it alone and installing Node $NODE_MAJOR alongside it"
  fi

  need curl || die "curl is required to download Node. Install curl, then re-run this script."
  need tar  || die "tar is required to unpack Node. Install tar, then re-run this script."

  step "Downloading Node $NODE_MAJOR for $plat"
  local listing file url tmp
  listing="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/" || die "could not reach nodejs.org — check your network or proxy")"
  # .tar.gz, not .tar.xz: minimal RHEL and Debian images ship tar without the xz
  # helper binary, and the failure is an opaque "xz: Cannot exec". gzip is built
  # into every tar that can run here. The extra few megabytes are worth it.
  file="$(printf '%s' "$listing" | grep -o "node-v${NODE_MAJOR}\.[0-9.]*-${plat}\.tar\.gz" | head -1)"
  [ -n "$file" ] || die "no Node $NODE_MAJOR build published for $plat"
  url="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$file"

  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  curl -fSL --progress-bar "$url" -o "$tmp/node.tar.gz" || die "download failed: $url"

  step "Unpacking into $(tilde "$NODE_DIR")"
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  tar -xzf "$tmp/node.tar.gz" -C "$NODE_DIR" --strip-components=1 \
    || die "could not unpack the Node archive — see the tar error above"

  export PATH="$NODE_DIR/bin:$PATH"
  add_to_path "$NODE_DIR/bin"
  ok "Node $("$NODE_DIR/bin/node" -v)"
}

install_gov() {
  step "Installing $GOV_PKG"
  need npm || die "npm did not come with Node — the install is incomplete. Remove $(tilde "$NODE_DIR") and re-run."

  # If we are using a Node we did NOT install, its global prefix may be a system
  # directory — the EACCES failure. Redirect the prefix to a user-owned folder
  # rather than escalating with sudo (npm's own advice: a root-owned global tree
  # causes worse problems later).
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    local prefix; prefix="$(npm config get prefix 2>/dev/null || echo "")"
    if [ -n "$prefix" ] && [ ! -w "$prefix" ]; then
      warn "npm's global folder ($prefix) is not writable by you — switching to ~/.npm-global"
      mkdir -p "$HOME/.npm-global"
      npm config set prefix "$HOME/.npm-global"
      export PATH="$HOME/.npm-global/bin:$PATH"
      add_to_path "$HOME/.npm-global/bin"
    fi
  fi

  npm install -g --silent "$GOV_PKG" || die "npm could not install $GOV_PKG — the output above says why"
  ok "$(gov --version 2>/dev/null | head -1 || echo "gov installed")"
}

# ── run ───────────────────────────────────────────────────────────────────────
PROFILE_TOUCHED=""
PLATFORM="$(detect_platform)"

say ""
say "${B}gov installer${RST} — $PLATFORM"
say "${DIM}Nothing is installed system-wide, and sudo is never used.${RST}"
say ""

step "Checking what you already have"
install_node "$PLATFORM"
install_gov

say ""
say "${GRN}${B}Done.${RST}"
if [ -n "$PROFILE_TOUCHED" ]; then
  say ""
  say "${YEL}Open a new terminal${RST} (or run: ${B}source $(tilde "$PROFILE_TOUCHED")${RST})"
  say "so that ${B}gov${RST} is on your PATH."
fi
say ""
say "When you are set up, ${B}gov${RST} on its own opens the menu — start there if you are new."
say ""

# Is there a terminal we can ASK on? Testing `-e /dev/tty` is not enough: inside a
# container without a controlling terminal the path exists and opening it still
# fails with "No such device or address". Open it and see.
have_tty() { (exec 3</dev/tty) 2>/dev/null; }

# HAND OVER, and do not stop at a report.
#
# The installer's job is "get this machine ready", and Node plus gov is only part
# of that: git, the GitHub CLI and a signed-in token are the rest. Ending at a
# report that says what is still wrong, and a command the reader must copy, puts
# the last mile back on the person who ran a one-line installer precisely to avoid
# it (#186).
#
# So it runs `gov doctor --fix`, which shows each command and waits for consent —
# nothing is installed behind anyone's back.
#
# THE TERMINAL IS THE CATCH. Under `curl … | bash` this script's stdin IS the
# pipe, so a prompt would read the rest of the script instead of the user. When a
# real terminal exists we hand it to doctor explicitly with `< /dev/tty`; when it
# does not — CI, a provisioning script — we report and name the command, because
# consent cannot be given by something that is not there.
if ! need gov; then
  exit 0
fi

if [ "${GOV_NO_FIX:-}" = "1" ]; then
  step "gov doctor"
  gov doctor || true
elif have_tty; then
  say "${B}One more step: the tools gov needs on this machine.${RST}"
  say "${DIM}You will be shown each command and asked before anything runs.${RST}"
  say ""
  gov doctor --fix < /dev/tty || true
else
  step "gov doctor"
  gov doctor || true
  say ""
  say "No terminal here, so nothing was changed. To finish setting this machine up:"
  say "  ${B}gov doctor --fix${RST}"
fi
