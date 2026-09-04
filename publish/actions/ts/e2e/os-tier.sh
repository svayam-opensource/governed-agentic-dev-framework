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

# The images an adopter actually arrives on. Two package managers, two `gh` situations:
# Fedora carries the GitHub CLI in its own repositories and Rocky does not — the difference
# that produced three of the nine defects in #186.
IMAGES=(
  # curl is deliberately absent from these two: Rocky and Fedora ship `curl-minimal`,
  # which PROVIDES /usr/bin/curl and CONFLICTS with `curl`. Asking for it fails the whole
  # transaction — on the very image an adopter is most likely to be on.
  "rocky|rockylinux:9|dnf install -y -q sudo expect git tar xz which findutils procps-ng"
  "fedora|fedora:latest|dnf install -y -q sudo expect git tar xz which findutils procps-ng"
  "debian|debian:stable-slim|apt-get update -qq && apt-get install -y -qq sudo expect git curl ca-certificates xz-utils procps"
  "ubuntu|ubuntu:24.04|apt-get update -qq && apt-get install -y -qq sudo expect git curl ca-certificates xz-utils procps"
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

FAILED=0
for entry in "${IMAGES[@]}"; do
  IFS='|' read -r label image deps <<< "$entry"
  [ -n "$FILTER" ] && [[ "$label" != *"$FILTER"* ]] && continue
  printf '\n%s══ %s (%s) ══%s\n' "$BOLD" "$label" "$image" "$RST"
  if docker run --rm \
      -v "$REPO:/src:ro" \
      -v "$TARBALL:/tmp/gov.tgz:ro" \
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
