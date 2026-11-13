#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# gov upgrade — macOS and Linux. Brings gov (the client) AND your organization's governance repository up to the
# release this site serves, in one go (PRJ-121 F55, Policy Owner ruling A, 2026-11-12):
#
#   curl -fsSL https://gov.svayamtech.com/upgrade.sh -o upgrade.sh && bash upgrade.sh
#
# 1. The client: this site's own install.sh, which installs (or updates) gov to the version the site pins — the same
#    installer as a first install, on the same private Node, asking before it installs anything.
# 2. The governance repository: `gov upgrade` shows what the new release changes, then — if you agree —
#    `gov upgrade --pr` opens it as a pull request for you to review. Nothing is merged for you.
#
# Run it anywhere. If gov finds no governance repository from here, the client is still upgraded and you are told
# where to run `gov upgrade --pr`. From gov 2 on, `gov self-update` updates the client without this script.
#
#   GOV_YES=1               answer yes to every question (scripts; CI)
#   GOV_UPGRADE_NO_PR=1     stop after showing the governance changes; open no pull request
#   GOV_SITE_URL            the site to upgrade from (pinned by the site that serves this script)
set -euo pipefail

GOV_SITE_URL="${GOV_SITE_URL:-https://gov.svayamtech.com}"

if [ -t 1 ]; then B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; RST=$'\033[0m'; else B=""; DIM=""; RED=""; RST=""; fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s\n' "$B" "$RST" "$*"; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }
have_tty() { (exec 3</dev/tty) 2>/dev/null; }
# Asks on the terminal, never stdin (under `curl … | bash` stdin is this script). No terminal and no GOV_YES = no.
confirm() {
  if [ "${GOV_YES:-}" = "1" ]; then return 0; fi
  have_tty || return 1
  printf '  %s [y/N] : ' "$1" > /dev/tty
  local ans=""; read -r ans < /dev/tty || ans=""
  case "$ans" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

say "${B}gov upgrade${RST} — from ${GOV_SITE_URL}"
say "${DIM}1. gov, the client: updated to the version this site serves (it asks before installing anything).${RST}"
say "${DIM}2. your governance repository: the changes shown first, then a pull request if you agree.${RST}"

# ── 1. the client, through this site's own installer ─────────────────────────────────────────────────────────────
step "1. gov, the client"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL --connect-timeout 20 --max-time 120 "${GOV_SITE_URL%/}/install.sh" -o "$tmp/install.sh" || die "could not download ${GOV_SITE_URL%/}/install.sh"
# A shell must receive a script, never a web page (the same rule the site build enforces).
[ "$(head -c 2 "$tmp/install.sh")" = "#!" ] || die "${GOV_SITE_URL%/}/install.sh is not a script — nothing was changed"
# GOV_NO_FIX=1: the installer updates gov and reports, without starting the first-run flow; this script goes on.
GOV_NO_FIX=1 bash "$tmp/install.sh" || die "the installer stopped — gov was not upgraded (its output above says why)"

# The installer links gov into ~/.local/bin; a shell that started before it may not have that on its PATH yet.
export PATH="$HOME/.local/bin:$PATH"
command -v gov >/dev/null 2>&1 || die "gov is not on PATH after installing — open a new terminal and run: gov upgrade --pr"
say "  gov is now $(gov --version 2>/dev/null | head -1)"

# ── 2. the governance repository ───────────────────────────────────────────────────────────────────────────────
step "2. your governance repository"
if ! gov upgrade; then
  say ""
  say "No governance repository could be upgraded from here — the client is upgraded."
  say "From your organization's governance repository, run: ${B}gov upgrade --pr${RST}"
  exit 0
fi
if [ "${GOV_UPGRADE_NO_PR:-}" = "1" ]; then
  say ""; say "Stopped before the pull request (GOV_UPGRADE_NO_PR=1). To open it: ${B}gov upgrade --pr${RST}"; exit 0
fi
say ""
if confirm "Open these changes as a pull request now?"; then
  gov upgrade --pr
  say ""; say "${B}Done.${RST} Review and merge the pull request; gov is upgraded."
else
  say ""; say "No pull request opened. When you are ready, from your governance repository: ${B}gov upgrade --pr${RST}"
fi
