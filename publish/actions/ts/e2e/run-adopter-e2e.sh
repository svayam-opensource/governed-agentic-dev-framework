#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# HOST orchestrator for the adopter-journey e2e. Packs the LOCAL gov build (so we
# test the exact artifact about to be published), spins a FRESH container off the
# gyan image (clean slate every run), and executes the in-container journey
# against real GitHub. Run on publish / when content or actions change.
#
# Usage:  E2E_ORG=<your-throwaway-org> GH_TOKEN=<token> ./run-adopter-e2e.sh
# Env:    E2E_IMAGE (default gyan-e2e-img:latest) · E2E_KEEP=1 to skip teardown
set -euo pipefail
: "${E2E_ORG:?set E2E_ORG (a throwaway GitHub org you own)}"
: "${GH_TOKEN:?set GH_TOKEN (scopes: repo, project, read:org)}"
IMAGE="${E2E_IMAGE:-gyan-e2e-img:latest}"
HERE="$(cd "$(dirname "$0")" && pwd)"          # publish/actions/ts/e2e
TS_DIR="$(cd "$HERE/.." && pwd)"               # publish/actions/ts
CONTENT_DIR="$(cd "$TS_DIR/../../content" && pwd)" # publish/content

echo "▶ build + pack the local gov ($TS_DIR)"
( cd "$TS_DIR" && npm run build >/dev/null && npm pack --silent >/dev/null )
TARBALL="$(cd "$TS_DIR" && ls -t svayam-opensource-gov-*.tgz | head -1)"
[ -n "$TARBALL" ] || { echo "npm pack produced no tarball"; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp "$TS_DIR/$TARBALL" "$WORK/gov.tgz"
cp "$HERE/adopter-journey.sh" "$WORK/journey.sh"
cp -R "$CONTENT_DIR" "$WORK/content"

echo "▶ run the journey in a FRESH $IMAGE container (clean slate)"
docker run --rm \
  -e E2E_ORG="$E2E_ORG" -e GH_TOKEN -e E2E_KEEP="${E2E_KEEP:-0}" -e E2E_RUN_ID="$(date +%s)" \
  -e GOV_TARBALL=/e2e/gov.tgz -e CONTENT_DIR=/e2e/content \
  -v "$WORK":/e2e:ro \
  --entrypoint bash "$IMAGE" -lc 'cp -R /e2e /tmp/e2e && chmod +x /tmp/e2e/journey.sh && GOV_TARBALL=/tmp/e2e/gov.tgz CONTENT_DIR=/tmp/e2e/content /tmp/e2e/journey.sh'
