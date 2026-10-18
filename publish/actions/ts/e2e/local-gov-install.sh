#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# A LOCAL gov-install — the install site's real container, built from THIS worktree's site/ (site/Dockerfile, the
# same recipe `gov deploy gov-install` builds), run on a loopback port. The install-signup journey's stub mode runs
# its scripts-host checks against it (PRJ-121 intent 02 addendum, IS-E6; spec §7, IS-A16/IS-A17).
#
#   bash e2e/local-gov-install.sh up      → builds the image, starts it, waits for /healthz, prints:
#                                             url=http://127.0.0.1:<port>
#                                             name=<container name>
#   bash e2e/local-gov-install.sh down <name>
#
# The container serves every environment's build and picks one per request by Host (site/caddyfile.mjs), as the
# Caddy edge does: ask it for gov-uat.svayamtech.com with `-H 'Host: gov-uat.svayamtech.com'`.
#
# Needs: docker, and network to clone the public repository (the image build reads install.sh at pinned refs —
# see site/Dockerfile, "WHY THE BUILD CLONES"). Nothing is pushed or published; the image stays local.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"   # the repository root: site/Dockerfile's `build.context: repo`
IMAGE="${GOV_INSTALL_IMAGE:-gov-install-local:e2e}"

case "${1:-}" in
  up)
    command -v docker >/dev/null || { echo "docker is needed to build the local gov-install" >&2; exit 1; }
    [ -f "$ROOT/site/Dockerfile" ] || { echo "no site/Dockerfile under $ROOT" >&2; exit 1; }
    docker build --quiet -t "$IMAGE" -f "$ROOT/site/Dockerfile" "$ROOT" >&2
    name="gov-install-e2e-$$-$RANDOM"
    docker run -d --rm --name "$name" -p 127.0.0.1::4002 "$IMAGE" >/dev/null
    port="$(docker port "$name" 4002/tcp | head -1 | sed 's/.*://')"
    for _ in $(seq 1 30); do
      curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && { echo "url=http://127.0.0.1:$port"; echo "name=$name"; exit 0; }
      sleep 1
    done
    docker logs "$name" >&2 || true; docker rm -f "$name" >/dev/null 2>&1 || true
    echo "the local gov-install did not answer /healthz within 30 s" >&2; exit 1 ;;
  down)
    [ -n "${2:-}" ] || { echo "usage: $0 down <name>" >&2; exit 2; }
    docker rm -f "$2" >/dev/null 2>&1 || true ;;
  *) echo "usage: $0 up | down <name>" >&2; exit 2 ;;
esac
