#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# THE INSTALL AN ADOPTER GETS AUDITS CLEAN (PRJ-121 intent 05, Item 11 / T12).
#
# `npm audit --omit=dev` in this directory checks OUR lockfile. An adopter never sees our lockfile: a
# packed package does not ship one, so `npm i -g @svayam-opensource/gov` resolves every dependency
# afresh. This packs gov, installs the tarball into an empty consumer project the way npm resolves it
# for an adopter (production dependencies only, no lockfile of ours), and audits THAT tree.
#
# Why a consumer project and not `npm i -g`: `npm audit` refuses a global tree (it needs a lockfile),
# so the global install cannot be audited directly. The resolution is the same — fresh, from the
# package's own ranges — which is the thing being proven.
#
# NETWORK: yes (it resolves from the registry). That is why it is NOT in the hermetic adopter-smoke.
#
#   bash e2e/packed-audit.sh        exit 0 = clean at moderate; non-zero = the advisory list is printed
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "▶ pack gov (prepack builds lib/)"
tarball="$(cd "$here" && npm pack --silent --pack-destination "$tmp" | tail -n 1)"
[ -f "$tmp/$tarball" ] || { echo "✗ npm pack produced no tarball" >&2; exit 1; }

echo "▶ install $tarball into an empty consumer project (production deps only)"
mkdir -p "$tmp/consumer"
cd "$tmp/consumer"
printf '{ "name": "packed-audit-consumer", "version": "0.0.0", "private": true }\n' > package.json
npm install --omit=dev --no-fund --no-audit "$tmp/$tarball" >/dev/null

echo "▶ moment in the installed tree"
npm ls moment --all || true

echo "▶ npm audit --omit=dev --audit-level=moderate"
npm audit --omit=dev --audit-level=moderate
echo "✓ the packed gov installs with no moderate-or-worse advisory"
