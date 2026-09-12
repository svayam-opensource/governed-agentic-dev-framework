#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# THE TIER THAT NEEDS A REAL MACHINE.
#
# `journey.sh` doubles everything outside gov and runs anywhere. Three things cannot be
# doubled, because they are facts about a machine rather than about gov:
#
#   · a BARE target — no Node, no git, no gh, no package repository for the GitHub CLI.
#     Every defect #186 closed was invisible from a developer's laptop, where all four have
#     been true for months.
#   · a PRIVATE Node install, and what is reachable after gov exits. #209 (`bob: command not
#     found`, seconds after Bob advised `bob --resume`) cannot reproduce where node is the
#     machine's own — which is every developer's machine.
#   · a RETRY after a failed run. The leftovers are real files in real places.
#
# So: throwaway containers, one per image, and inside each one the real `install.sh` driven
# by `expect`. Nothing is stubbed here except the vendor download, which is the one thing
# that would otherwise need an account.
#
#   bash e2e/os-tier.sh                      every image
#   bash e2e/os-tier.sh rocky                 one
#   OS_TIER_FRAGMENT=92 bash e2e/os-tier.sh   one scenario, every image
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TS_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$TS_DIR/../../.." && pwd)"
FILTER="${1:-}"

BOLD=$'\033[1m'; GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
[ -t 1 ] && [ -z "${NO_COLOR:-}" ] || { BOLD=""; GRN=""; RED=""; DIM=""; RST=""; }

# The images an adopter actually arrives on, with ONLY what the harness itself needs —
# `expect` to answer, and the archive tools to unpack Node. Deliberately NOT git: a machine
# that already has it is not the machine scenario 90 is named after, and installing it made
# `doctor --fix` plan four steps where an adopter sees five.
#
# The images an adopter actually arrives on. Two package managers, two `gh` situations:
# Fedora carries the GitHub CLI in its own repositories and Rocky does not — the difference
# that produced three of the nine defects in #186.
IMAGES=(
  # curl is deliberately absent from these two: Rocky and Fedora ship `curl-minimal`,
  # which PROVIDES /usr/bin/curl and CONFLICTS with `curl`. Asking for it fails the whole
  # transaction — on the very image an adopter is most likely to be on.
  # Xvfb IS PART OF THE FIXTURE, NOT PART OF THE PRODUCT (#221). `98-desktop-hint.sh` needs a
  # REAL X server to prove gov changes its mind about a desktop — an env var it set itself would
  # only prove the variable is readable. gov never installs this and never needs it; the
  # fragment says plainly when an image cannot supply it rather than skipping quietly.
  "rocky|rockylinux:9|dnf install -y -q sudo expect tar xz which findutils procps-ng xorg-x11-server-Xvfb"
  "fedora|fedora:latest|dnf install -y -q sudo expect tar xz which findutils procps-ng xorg-x11-server-Xvfb"
  # DEBIAN_FRONTEND=noninteractive, AND IT IS LOAD-BEARING. Xvfb pulls in tzdata, whose postinst
  # opens a debconf timezone prompt on ubuntu:24.04 — with nothing on the other end. Image prep
  # sat on that question for an hour and reported neither a pass nor a failure, which is how a
  # fixture dependency became a phantom test outcome. TZ makes the answer deterministic instead
  # of leaving it to whatever debconf would have defaulted to.
  "debian|debian:stable-slim|apt-get update -qq && DEBIAN_FRONTEND=noninteractive TZ=UTC apt-get install -y -qq sudo expect curl ca-certificates xz-utils procps xvfb"
  "ubuntu|ubuntu:24.04|apt-get update -qq && DEBIAN_FRONTEND=noninteractive TZ=UTC apt-get install -y -qq sudo expect curl ca-certificates xz-utils procps xvfb"
)

command -v docker >/dev/null || { echo "os-tier.sh needs docker"; exit 2; }

# THE EXACT ARTEFACT AN ADOPTER RECEIVES, not the working tree. `install.sh` installs a
# package; testing anything else tests a different thing that happens to share a source tree.
TARBALL="$(ls -t "$TS_DIR"/svayam-opensource-gov-*.tgz 2>/dev/null | head -1)"
if [ -z "$TARBALL" ]; then
  echo "${DIM}packing gov first…${RST}"
  ( cd "$TS_DIR" && npm run build >/dev/null 2>&1 && npm pack >/dev/null 2>&1 )
  TARBALL="$(ls -t "$TS_DIR"/svayam-opensource-gov-*.tgz | head -1)"
fi
[ -n "$TARBALL" ] || { echo "could not pack gov"; exit 2; }
echo "${DIM}artefact: $(basename "$TARBALL")${RST}"

# ── the Node cache ────────────────────────────────────────────────────────────
# ONE DOWNLOAD PER MACHINE, NOT SIX PER IMAGE.
#
# THE ROOT CAUSE. gov's private Node lives INSIDE the directory the harness wipes:
# install.sh sets NODE_DIR="$GOV_HOME/node", and `reset_machine` deletes
# ~/.local/share/gov before every fragment. So one directory holds three things with
# completely different lifetimes and costs — the gov client (small, and the thing under
# test), the Node runtime (50 MB, off the network, NOT under test in most scenarios), and
# the agent binaries a vendor installs into node/bin. `reset_machine` could only say "all
# or nothing", because there was nothing finer to say. It was written for scenario 90,
# which genuinely needs a bare machine; the other five inherited it.
#
# Six scenarios per image × four images = 24 downloads of the same 50 MB archive in one
# run, and nodejs.org rate-limits: a full run hit "could not reach nodejs.org" four times
# and no single run of the tier could pass.
#
# So the archive is fetched ONCE, here, and mounted read-only into every container.
# Scenarios pass it to install.sh as GOV_NODE_TARBALL — the same seam an adopter on an
# air-gapped or proxied network uses, so this is exercising a real path rather than a test
# hook. It persists between runs, so a second run costs nothing.
#
# SCENARIO 90 DELIBERATELY DOES NOT USE IT. It is the one whose job is "install.sh from
# nothing", and that includes the listing fetch, the download and their retries. If every
# scenario read from cache, the network path would have no coverage at all — and it is the
# path that just grew retry logic.
NODE_MAJOR=24
NODE_CACHE_DIR="${GOV_OS_TIER_CACHE:-$HOME/.cache/gov-os-tier}"
# The containers are Linux on this host's architecture, which is not necessarily this
# host's platform — a Mac fetches linux-arm64, not darwin-arm64.
case "$(uname -m)" in
  arm64|aarch64) NODE_PLAT="linux-arm64" ;;
  x86_64|amd64)  NODE_PLAT="linux-x64" ;;
  *) echo "os-tier.sh: unknown architecture $(uname -m)"; exit 2 ;;
esac
NODE_CACHE="$NODE_CACHE_DIR/node-$NODE_MAJOR-$NODE_PLAT.tar.gz"
if [ ! -s "$NODE_CACHE" ]; then
  mkdir -p "$NODE_CACHE_DIR"
  echo "${DIM}caching Node $NODE_MAJOR ($NODE_PLAT) once for every image…${RST}"
  NODE_LISTING="https://nodejs.org/dist/latest-v$NODE_MAJOR.x/"
  NODE_FILE="$(curl -fsSL --retry 4 --retry-delay 2 --retry-all-errors "$NODE_LISTING" \
    | grep -o "node-v$NODE_MAJOR\.[0-9.]*-$NODE_PLAT\.tar\.gz" | head -1)"
  [ -n "$NODE_FILE" ] || { echo "could not find a Node $NODE_MAJOR build for $NODE_PLAT"; exit 2; }
  # A PARTIAL FILE MUST NOT BECOME THE CACHE. Download beside it and rename only on success,
  # or an interrupted run poisons every later one with an archive that cannot unpack.
  curl -fSL --retry 4 --retry-delay 2 --retry-all-errors "$NODE_LISTING$NODE_FILE" -o "$NODE_CACHE.part" \
    || { rm -f "$NODE_CACHE.part"; echo "could not download $NODE_FILE"; exit 2; }
  tar -tzf "$NODE_CACHE.part" >/dev/null 2>&1 \
    || { rm -f "$NODE_CACHE.part"; echo "the downloaded archive does not unpack"; exit 2; }
  mv "$NODE_CACHE.part" "$NODE_CACHE"
  echo "${DIM}cached $NODE_FILE${RST}"
else
  echo "${DIM}Node cache: $(basename "$NODE_CACHE") (reused)${RST}"
fi

FAILED=0
for entry in "${IMAGES[@]}"; do
  IFS='|' read -r label image deps <<< "$entry"
  [ -n "$FILTER" ] && [[ "$label" != *"$FILTER"* ]] && continue
  printf '\n%s══ %s (%s) ══%s\n' "$BOLD" "$label" "$image" "$RST"
  if docker run --rm \
      -v "$REPO:/src:ro" \
      -v "$TARBALL:/tmp/gov.tgz:ro" \
      -v "$NODE_CACHE:/tmp/node.tar.gz:ro" \
      -e "OS_TIER_DEPS=$deps" \
      -e "OS_TIER_LABEL=$label" \
      -e "OS_TIER_FRAGMENT=${OS_TIER_FRAGMENT:-}" \
      -t "$image" bash /src/publish/actions/ts/e2e/os-inside.sh; then
    printf '%s✓ %s%s\n' "$GRN" "$label" "$RST"
  else
    printf '%s✗ %s%s\n' "$RED" "$label" "$RST"
    FAILED=$((FAILED+1))
  fi
done

printf '\n%s%s%s\n' "$BOLD" "$([ "$FAILED" -eq 0 ] && echo "every image passed" || echo "$FAILED image(s) failed")" "$RST"
[ "$FAILED" -eq 0 ]
