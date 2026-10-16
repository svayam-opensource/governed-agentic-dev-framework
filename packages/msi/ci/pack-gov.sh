#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# pack-gov.sh <version|""> <out-dir> — the gov package the MSI carries, packed from this checkout: npm ci, build,
# npm pack (the exact artifact npm would publish). With a version, the package is stamped with it first
# (gov-cicd's dev builds are e.g. 1.2.3-dev.gabc1234), so `gov --version` reports what the MSI is named.
# Prints two lines: the tarball's path, then the version it carries.
set -euo pipefail
VERSION="${1:-}"; OUT="$2"
TS="$(cd "$(dirname "$0")/../../../publish/actions/ts" && pwd)"
mkdir -p "$OUT"
cd "$TS"
npm ci --no-audit --no-fund >&2
if [ -n "$VERSION" ]; then npm version "$VERSION" --no-git-tag-version --allow-same-version >&2; fi
TGZ="$(npm pack --silent --pack-destination "$OUT" | tail -1)"
echo "$OUT/$TGZ"
node -p 'require("./package.json").version'
