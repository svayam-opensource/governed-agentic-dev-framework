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

# Run something slow with a spinner, so silence never looks like a hang.
#
# A tester watched `npm install -g` for half a minute with nothing on screen and
# wondered whether to press Ctrl-C. Silence is indistinguishable from a stall, and
# a person who cannot tell the difference will eventually guess wrong — the one
# outcome an installer must not invite. Output is captured and shown only on
# failure, so the spinner is not fighting a wall of npm text.
spin() {
  local msg="$1"; shift
  local log; log="$(mktemp)"
  local rc=0
  if [ ! -t 1 ]; then                       # no terminal: no animation, just say it
    printf '  %s… ' "$msg"
    # `|| rc=$?` matters under `set -e`: a bare failing command would end the whole
    # script HERE, silently, with the log still unread — the reader sees the prompt
    # come back and nothing else.
    "$@" >"$log" 2>&1 || rc=$?
    if [ $rc -eq 0 ]; then printf 'done\n'; rm -f "$log"; return 0; fi
    printf 'failed\n'; cat "$log" >&2; rm -f "$log"; return $rc
  fi
  "$@" >"$log" 2>&1 &
  local pid=$! i=0 t0 secs
  t0=$(date +%s)
  local frames='|/-\'
  while kill -0 "$pid" 2>/dev/null; do
    secs=$(( $(date +%s) - t0 ))
    # The elapsed seconds are the point, not the spinner. A spinner says "a program
    # is running"; a rising count says "it has been running for 12 seconds, and this
    # is normal" — which is what a person weighing Ctrl-C actually needs to know.
    printf '\r  %s %s (%ss) ' "${frames:i++%4:1}" "$msg" "$secs"
    sleep 0.2
  done
  wait "$pid" || rc=$?
  secs=$(( $(date +%s) - t0 ))
  if [ $rc -eq 0 ]; then
    printf '\r  %s✓%s %s (%ss)%s\n' "$GRN" "$RST" "$msg" "$secs" "                    "; rm -f "$log"; return 0
  fi
  printf '\r  %s✗%s %s%s\n' "$RED" "$RST" "$msg" "                    "; cat "$log" >&2; rm -f "$log"; return $rc
}

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

# Is this directory ALREADY on the running shell's PATH?
on_path() { case ":$PATH:" in *":$1:"*) return 0 ;; *) return 1 ;; esac; }

# A child process cannot change its parent shell's PATH — that is an operating
# system rule, not an oversight, and it is why every installer ends by telling you
# to open a new terminal.
#
# But it can put the command somewhere the parent shell is ALREADY looking.
# ~/.local/bin is on PATH by default on Fedora, RHEL, Rocky and most Debian
# derivatives. When it is, a symlink there means `gov` works in the shell you are
# standing in, with nothing to source and nothing to reopen.
link_into_path() {
  local target="$1" dir="$HOME/.local/bin"
  on_path "$dir" || return 1
  mkdir -p "$dir" || return 1
  ln -sf "$target" "$dir/gov" || return 1
  IMMEDIATELY_USABLE=1
  ok "linked into $(tilde "$dir"), which is already on your PATH"
  return 0
}

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

  step "Installing Node $NODE_MAJOR for $plat"
  local listing file url tmp
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  spin "asking nodejs.org which version is current" \
    bash -c "curl -fsSL 'https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/' -o '$tmp/listing.html'" \
    || die "could not reach nodejs.org — check your network or proxy"
  listing="$(cat "$tmp/listing.html")"
  # .tar.gz, not .tar.xz: minimal RHEL and Debian images ship tar without the xz
  # helper binary, and the failure is an opaque "xz: Cannot exec". gzip is built
  # into every tar that can run here. The extra few megabytes are worth it.
  file="$(printf '%s' "$listing" | grep -o "node-v${NODE_MAJOR}\.[0-9.]*-${plat}\.tar\.gz" | head -1)"
  [ -n "$file" ] || die "no Node $NODE_MAJOR build published for $plat"
  url="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$file"

  say "  downloading ${file} (about 50 MB)"
  curl -fSL --progress-bar "$url" -o "$tmp/node.tar.gz" || die "download failed: $url"

  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  spin "unpacking into $(tilde "$NODE_DIR")" \
    tar -xzf "$tmp/node.tar.gz" -C "$NODE_DIR" --strip-components=1 \
    || die "could not unpack the Node archive — see the error above"

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

  spin "downloading and installing gov (this takes a moment)" \
    npm install -g --silent "$GOV_PKG" \
    || die "npm could not install $GOV_PKG — the output above says why"
  ok "$(gov --version 2>/dev/null | head -1 || echo "gov installed")"

  # Prefer the shell the person is actually in over a shell they have to go and open.
  local gov_bin; gov_bin="$(command -v gov 2>/dev/null || true)"
  [ -n "$gov_bin" ] && link_into_path "$gov_bin" || true
}

# ── run ───────────────────────────────────────────────────────────────────────
PROFILE_TOUCHED=""
IMMEDIATELY_USABLE=0
PLATFORM="$(detect_platform)"

say ""
say "${B}gov installer${RST} — $PLATFORM"
say "${DIM}This takes a minute or two on a fresh machine. Each step reports as it finishes.${RST}"
say "${DIM}Nothing is installed system-wide, and sudo is never used.${RST}"
say ""

step "Checking what you already have"
install_node "$PLATFORM"
install_gov

say ""
say "${GRN}${B}gov is installed.${RST}"
say ""

# THE LAST WORD, printed where the reader actually is.
#
# This used to be said just after the install and before `gov doctor --fix`. On a
# machine that needed git, gh and a browser sign-in, that put it several screens
# and a few minutes above the prompt the person was left staring at — and the
# first thing they typed was `gov doctor`, which their shell had never heard of.
# A reminder that has scrolled away is not a reminder.
finish() {
  say ""
  if [ "$IMMEDIATELY_USABLE" = "1" ]; then
    say "${GRN}${B}gov is ready in this shell.${RST} Try: ${B}gov${RST}"
    say ""
    return
  fi
  if [ -n "$PROFILE_TOUCHED" ]; then
    say "${YEL}${B}One last thing.${RST} This shell was started before gov was installed,"
    say "so it does not know about it yet. Run:"
    say ""
    say "    ${B}source $(tilde "$PROFILE_TOUCHED")${RST}"
    say ""
    say "…or just open a new terminal. Then ${B}gov${RST} will work."
  else
    say "Run ${B}gov${RST} on its own to open the menu — start there if you are new."
  fi
  say ""
}

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
  finish
elif have_tty; then
  say "${B}One more step: the tools gov needs on this machine.${RST}"
  say "${DIM}You will be shown each command and asked before anything runs.${RST}"
  say ""
  gov doctor --fix < /dev/tty || true

  # AND KEEP GOING. The environment being ready is not what anyone came for — it is
  # the toll on the way to setting their organization up. Stopping here, with a
  # green report and a different command to discover, is the same "last mile handed
  # back" the report-only ending already was, one step further along.
  #
  # Any gov command triggers the first-run flow; `list` is the least surprising one
  # to be holding when it does.
  say ""
  say "${B}Next: your organization.${RST}"
  say "${DIM}gov will ask whether you are adopting the framework or joining an existing setup.${RST}"
  say "${DIM}There is an option for 'I am not sure' — it only explains, and changes nothing.${RST}"
  say ""
  printf '  Continue now? [Y/n] '
  read -r go < /dev/tty || go=""
  case "$go" in
    [nN]|[nN][oO])
      say ""
      say "Stopped here. When you are ready, run: ${B}gov${RST}"
      ;;
    *)
      say ""
      gov list < /dev/tty || true
      ;;
  esac
  finish
  exit 0
else
  step "gov doctor"
  gov doctor || true
  say ""
  say "No terminal here, so nothing was changed. To finish setting this machine up:"
  say "  ${B}gov doctor --fix${RST}"
  finish
fi
