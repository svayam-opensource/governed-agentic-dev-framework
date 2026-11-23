# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# shellcheck shell=bash disable=SC2034  # CAN_DELETE is read by the script that sources this
#
# Sourced by the live journeys (adopter-journey.sh, rule-model-journey.sh). Two promises:
#
#   scope_check HEADERS REPO…   at START: can this token delete the repos the journey will create? HEADERS is the output
#                               of `gh api -i user`. A classic token lists its scopes in x-oauth-scopes; without
#                               `delete_repo` the journey says, up front, which repos it will leak — and carries on.
#                               A fine-grained token (or an App's) has no such header: gov cannot tell, and says what
#                               permission it needs. Sets CAN_DELETE=yes|no|unknown. Never fails the run.
#   leak_report REPO…           at TEARDOWN: exactly the repos it could not delete; silent when there are none.
#
# The first live run (2026-10-07) left two repos in the sandbox: TESTBED_BOT_PAT had no `delete_repo`, and the only
# sign was a line in the teardown.

_gha_warning() { if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$*"; fi; printf '  \033[33m! %s\033[0m\n' "$*"; }

scope_check() {
  local headers="$1"; shift
  local scopes
  scopes="$(printf '%s\n' "$headers" | tr -d '\r' | awk 'tolower($0) ~ /^x-oauth-scopes:/ { sub(/^[^:]*:[ \t]*/, ""); print; exit }')"
  if printf '%s\n' "$headers" | tr -d '\r' | grep -qi '^x-oauth-scopes:'; then
    if printf '%s\n' "$scopes" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -qx 'delete_repo'; then
      CAN_DELETE=yes
    else
      CAN_DELETE=no
      _gha_warning "the token lacks the delete_repo scope (it has: ${scopes:-none}) — teardown will leak: $* — add delete_repo to the token, or delete them by hand"
    fi
  else
    CAN_DELETE=unknown
    _gha_warning "cannot read this token's scopes (fine-grained token or App: no x-oauth-scopes) — teardown needs Administration: read and write on the sandbox's repos, or it will leak: $*"
  fi
  return 0
}

leak_report() {
  [ "$#" -gt 0 ] || return 0
  _gha_warning "could not delete $# repo(s): $* — delete by hand (the token needs delete_repo)"
}

# The scopes a classic token carries, one per line (empty for a fine-grained token or an App: no header).
token_scopes() {
  printf '%s\n' "$1" | tr -d '\r' | awk 'tolower($0) ~ /^x-oauth-scopes:/ { sub(/^[^:]*:[ \t]*/, ""); print; exit }' \
    | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$' || true
}

# missing_scopes HEADERS — the scopes in FRESH_SCOPES the token lacks, each with a leading space; empty when none.
# A broader scope covers a narrower one (admin:org ⊇ read:org); a token with no scope header is not judged here.
FRESH_SCOPES=(repo workflow project read:org delete_repo)
missing_scopes() {
  local have want miss=""
  printf '%s\n' "$1" | tr -d '\r' | grep -qi '^x-oauth-scopes:' || return 0
  have="$(token_scopes "$1")"
  for want in "${FRESH_SCOPES[@]}"; do
    grep -qx "$want" <<<"$have" && continue
    [ "$want" = read:org ] && grep -qxE 'admin:org|write:org' <<<"$have" && continue
    miss="$miss $want"
  done
  printf '%s' "$miss"
}
