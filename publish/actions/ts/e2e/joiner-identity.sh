#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# joiner-identity.sh — the live job's check, before anything is created, that the joiner is a usable SECOND identity
# (PRJ-121 intent 05, Item 4 — T15). Seconds, not the adopter journey's minutes, to learn the joiner cannot run.
#
#   the joiner token authenticates            (TESTBED_JOINER_PAT)
#   as TESTBED_JOINER_LOGIN                   (whitespace stripped; GitHub logins are case-insensitive) — a
#                                             mismatch is a loud WARNING naming the fix, not a stop: the TOKEN
#                                             decides who the joiner is (its login is the step's `login` output,
#                                             which every later step uses), the secret only declares it
#   which is NOT the adopter bot              (TESTBED_BOT_PAT's account) — fail loudly if it is
#   and an ACTIVE member of the sandbox org   (read by the adopter bot, the org's owner)
#
# Neither token is ever printed. The login is a secret, so Actions masks it; the numeric account ids are printed
# instead, and a login that names no account is described by its SHAPE (a→letter, 9→digit), never its value.
#
# In (env): JOINER_TOKEN JOINER_LOGIN ADOPTER_TOKEN E2E_ORG · Out ($GITHUB_OUTPUT): login=<the token's login>
set -uo pipefail
fail() { echo "::error::joiner identity: $*"; printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; }
: "${E2E_ORG:?}"
[ -n "${JOINER_TOKEN:-}" ] || fail "TESTBED_JOINER_PAT is empty"
[ -n "${ADOPTER_TOKEN:-}" ] || fail "TESTBED_BOT_PAT is empty"
want="$(printf '%s' "${JOINER_LOGIN:-}" | tr -d '[:space:]')"
[ -n "$want" ] || fail "TESTBED_JOINER_LOGIN is empty"
shape() { printf '%s' "$1" | sed 's/[a-z]/a/g; s/[A-Z]/A/g; s/[0-9]/9/g'; }

# `gh api --jq` prints an error BODY on stdout when the call fails — read the value only from a call that succeeded.
j_login="$(GH_TOKEN="$JOINER_TOKEN" gh api user --jq .login 2>/dev/null)" || j_login=""
j_id="$(GH_TOKEN="$JOINER_TOKEN" gh api user --jq .id 2>/dev/null)" || j_id=""
[ -n "$j_login" ] && [[ "$j_id" =~ ^[0-9]+$ ]] || fail "TESTBED_JOINER_PAT does not authenticate (expired, revoked, or not a token)"
ok "the joiner token authenticates (account id $j_id)"

a_login="$(GH_TOKEN="$ADOPTER_TOKEN" gh api user --jq .login 2>/dev/null)" || a_login=""
a_id="$(GH_TOKEN="$ADOPTER_TOKEN" gh api user --jq .id 2>/dev/null)" || a_id=""
[ "$j_id" != "$a_id" ] || fail "TESTBED_JOINER_PAT belongs to the adopter bot itself (account id $a_id) — it must be a SECOND svayam-e2e account"
ok "and is not the adopter bot (${a_login:-?}, account id ${a_id:-?})"

lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
warn() { echo "::warning::joiner identity: $*"; printf '  \033[33m⚠ %s\033[0m\n' "$*"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "**joiner identity — fix for the Policy Owner:** $*" >>"$GITHUB_STEP_SUMMARY"; fi; }
if [ "$(lc "$want")" != "$(lc "$j_login")" ]; then
  named_id="$(GH_TOKEN="$ADOPTER_TOKEN" gh api "users/$want" --jq .id 2>/dev/null)" || named_id=""
  if [[ "$named_id" =~ ^[0-9]+$ ]]; then
    fail "TESTBED_JOINER_LOGIN names account id $named_id, but TESTBED_JOINER_PAT is account id $j_id — the two secrets are for different accounts"
  fi
  warn "TESTBED_JOINER_LOGIN names no GitHub account (${#want} characters, shaped '$(shape "$want")') — set it to the token's own login, $j_login. The journeys use the token's login."
else
  ok "TESTBED_JOINER_LOGIN is the token's account ($j_login)"
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "login=$j_login" >>"$GITHUB_OUTPUT"; fi

m="$(GH_TOKEN="$ADOPTER_TOKEN" gh api "orgs/$E2E_ORG/memberships/$j_login" --jq '.state + " " + .role' 2>/dev/null)" || m=""
case "$m" in
  "active "*) ok "account id $j_id is an active $E2E_ORG member (${m#active })" ;;
  "pending "*) fail "account id $j_id was invited to $E2E_ORG but has not accepted — accept the invitation as that account" ;;
  *) fail "account id $j_id is not a member of $E2E_ORG — invite it (the joiner must be an org member)" ;;
esac
