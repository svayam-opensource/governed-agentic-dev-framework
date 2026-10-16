#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Start mitmdump for the evidence journey (SANDBOX ONLY — svayam-e2e) and print the environment that routes the
# tools under test through it. Usage:  eval "$(bash setup-proxy.sh start flows.jsonl)"  …journey…  bash setup-proxy.sh stop
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
state="${TMPDIR:-/tmp}/gov-egress"
case "${1:-}" in
  start)
    flows="${2:?flows.jsonl}"; mkdir -p "$state"; : > "$flows"
    command -v mitmdump >/dev/null || { echo "echo 'mitmdump (mitmproxy) is not installed' >&2; false"; exit 0; }
    mitmdump -q --listen-port 8899 -s "$here/svayam_egress.py" --set "egress_out=$flows" --set confdir="$state/ca" >"$state/mitm.log" 2>&1 &
    echo $! > "$state/pid"; sleep 3
    ca="$state/ca/mitmproxy-ca-cert.pem"
    cat <<ENV
export HTTPS_PROXY=http://127.0.0.1:8899 HTTP_PROXY=http://127.0.0.1:8899
export NODE_EXTRA_CA_CERTS=$ca GIT_SSL_CAINFO=$ca npm_config_cafile=$ca npm_config_proxy=http://127.0.0.1:8899 npm_config_https_proxy=http://127.0.0.1:8899
ENV
    ;;
  stop) [ -f "$state/pid" ] && kill "$(cat "$state/pid")" 2>/dev/null || true; rm -rf "$state" ;;
  *) echo "usage: setup-proxy.sh start <flows.jsonl> | stop" >&2; exit 2 ;;
esac
