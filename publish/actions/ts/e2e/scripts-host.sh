# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# shellcheck shell=bash disable=SC2016  # assertions are eval'd strings, expanded when evaluated
#
# Sourced by signup-journey.sh. THE SCRIPTS-HOST CHECKS (spec addendum-install-signup §7, IS-A16, IS-A17, and the
# scripts' half of IS-A12) — every request ANONYMOUS and with redirects NOT followed, because a redirect on a script
# path could hand HTML to a shell, which is the failure gov-install exists to prevent.
#
#   scripts_host_checks ENV BASE    BASE is the host's origin (https://gov-uat.svayamtech.com), or a LOCAL gov-install
#                                   container (http://127.0.0.1:<port>), which is asked for that env's host by `Host:`
#                                   the way the Caddy edge asks it. Sets VJ_<env> to the versions.json it read.
#
# IS-E7 re-runs the same checks against the three real hosts after each cutover (plan §5 IS-E7).
#
# Needs from the sourcing script: DRY, fd 3, `expect NAME CMD…`, `j JSON EXPR`, and $TMPD (a scratch directory).

dn() { if [ "$2" = prod ]; then printf '%s.svayamtech.com' "$1"; else printf '%s-%s.svayamtech.com' "$1" "$2"; fi; }

# sh_get BASE HOST PATH → SH_STATUS SH_TYPE SH_LOC SH_ACAO, the body in $TMPD/sh-body. No credentials, no -L.
sh_get() {
  local base="$1" host="$2" path="$3" hdr=() h="$TMPD/sh-head"
  case "$base" in http://127.0.0.1*|http://localhost*) hdr=(-H "Host: $host") ;; esac
  if [ "$DRY" = 1 ]; then
    printf '  + curl -sS --max-redirs 0 -D - %s%s%s   (anonymous)\n' "$base" "$path" "${hdr[*]:+  [${hdr[*]}]}" >&3
    SH_STATUS=200; SH_TYPE=; SH_LOC=; SH_ACAO=; : >"$TMPD/sh-body"; return 0
  fi
  SH_STATUS="$(curl -sS --max-redirs 0 --max-time 20 "${hdr[@]+"${hdr[@]}"}" -D "$h" -o "$TMPD/sh-body" -w '%{http_code}' "$base$path" || echo 000)"
  SH_TYPE="$(sh_hv "$h" content-type)"; SH_LOC="$(sh_hv "$h" location)"; SH_ACAO="$(sh_hv "$h" access-control-allow-origin)"
  # what a failed assertion shows as its "last answer" (read by the sourcing script's expect)
  # shellcheck disable=SC2034
  ST="$SH_STATUS"
  # shellcheck disable=SC2034
  BD="$path → location: ${SH_LOC:--} · content-type: ${SH_TYPE:--} · access-control-allow-origin: ${SH_ACAO:--} · $(head -c 80 "$TMPD/sh-body" | tr '\n' ' ')"
}
# sh_hv HEADERS-FILE NAME → the header's last value (names compared lower-case)
sh_hv() { tr -d '\r' <"$1" | awk -v k="$2" 'tolower($0) ~ "^"k":" { sub(/^[^:]*:[ \t]*/, ""); v=$0 } END{ print v }'; }
no_html() { ! head -c 512 "$TMPD/sh-body" | grep -qiE '^[[:space:]]*<|<!doctype|<html'; }
is_text() { case "$SH_TYPE" in text/plain*) return 0 ;; *) return 1 ;; esac; }
# the value a script pins: GOV_PKG="${GOV_PKG:-<value>}"
pin_of() { sed -n "s/^$1=\"\\\${$1:-\\(.*\\)}\"\$/\\1/p" "$TMPD/sh-body" | head -1; }

scripts_host_checks() {
  local env="$1" base="$2" host portal vj pkg reg ver p
  host="$(dn gov "$env")"; portal="https://$(dn portal "$env")"

  for p in / /index.html; do
    sh_get "$base" "$host" "$p"
    expect "IS-A16 · $env: GET $p on $host → 302 to $portal/install" \
      test "$SH_STATUS $SH_LOC" = "302 $portal/install"
  done

  sh_get "$base" "$host" /install.sh
  expect "IS-A17 · $env: /install.sh is 200 with no redirect, text/plain, a shebang first and no HTML" \
    eval 'test "$SH_STATUS" = 200 && is_text && test "$(head -c 2 "$TMPD/sh-body")" = "#!" && no_html'
  pkg="$(pin_of GOV_PKG)"; reg="$(pin_of GOV_REGISTRY)"

  sh_get "$base" "$host" /install.ps1
  expect "IS-A17 · $env: /install.ps1 is 200 with no redirect, text/plain and no HTML" \
    eval 'test "$SH_STATUS" = 200 && is_text && no_html'

  sh_get "$base" "$host" /versions.json
  vj="$(cat "$TMPD/sh-body")"; printf -v "VJ_$env" '%s' "$vj"
  expect "IS-A17 · $env: /versions.json is 200 with no redirect, application/json" \
    eval 'test "$SH_STATUS" = 200 && case "$SH_TYPE" in application/json*) true ;; *) false ;; esac'
  expect "§7.2 · $env: /versions.json is readable cross-origin by $portal only (Access-Control-Allow-Origin)" \
    test "$SH_ACAO" = "$portal"
  expect "IS-A12 · $env: versions.json names this env and host" \
    test "$(j "$vj" 'o.env')|$(j "$vj" 'o.host')" = "$env|$host"
  expect "IS-A12 · $env: versions.json's pkg and registry equal the pins baked into the served install.sh" \
    test "$(j "$vj" 'o.pkg')|$(j "$vj" 'o.registry')" = "$pkg|$reg"

  for ver in $(j "$vj" '(o.versioned||[]).map(v=>v.version).join(" ")'); do
    sh_get "$base" "$host" "/v/$ver/install.sh"
    expect "IS-A17 · $env: /v/$ver/install.sh is 200, text/plain, a shebang first, pinned to gov@$ver" \
      eval 'test "$SH_STATUS" = 200 && is_text && test "$(head -c 2 "$TMPD/sh-body")" = "#!" && no_html && test "$(pin_of GOV_PKG)" = "@svayam-opensource/gov@$ver"'
    sh_get "$base" "$host" "/v/$ver/install.ps1"
    expect "IS-A17 · $env: /v/$ver/install.ps1 is 200, text/plain, no HTML" \
      eval 'test "$SH_STATUS" = 200 && is_text && no_html'
  done
  [ "$DRY" = 1 ] && printf '  + … and /v/<ver>/install.sh, /v/<ver>/install.ps1 for every version versions.json lists\n' >&3

  sh_get "$base" "$host" /no-such-page.html
  expect "IS-A17 · $env: an unknown path is a 404 — no fallback page" test "$SH_STATUS" = 404
}
