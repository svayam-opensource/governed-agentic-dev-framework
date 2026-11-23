#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# fresh-adopt-guard.sh — the adopter-e2e `fresh-adoption` job's guard: can the timed fresh-adoption journey run, and
# if not, what does its absence mean? Its own file so a test runs it with the secret unset (test/e2e/fresh-adopt-gate.test.ts).
#
# The rule is live-guard.sh's (ruling Q2): strict on a dispatch, a PR into dev/main and a push to them; a visible skip
# elsewhere. ONE DIFFERENCE, ruled with Q64 A (2026-11-24): the journey lands BEFORE its secret exists — the Policy
# Owner sets FRESH_ADOPT_PAT after the merge — so on a strict run a missing value is reported INCOMPLETE (a warning, a
# summary line, exit 0) until the repository variable FRESH_ADOPT_REQUIRED is `true`. From then on it fails, like
# live-guard.sh. "incomplete" is the word green-streak.sh reads: such a run is never counted as green evidence.
#
# In (env): TOK ORG          — secret FRESH_ADOPT_PAT / var FRESH_ADOPT_ORG (only emptiness is read)
#           REQUIRED         — var FRESH_ADOPT_REQUIRED ("true" makes a missing value a failure on a strict run)
#           EVENT BASE_REF REF_NAME
# Out ($GITHUB_OUTPUT): run=true|false, strict=true|false. Exit 1 only when strict, required and something is missing.
set -euo pipefail

out() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >>"$GITHUB_OUTPUT"; fi; }
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >>"$GITHUB_STEP_SUMMARY"; fi; }

EVENT="${EVENT:-}"; BASE_REF="${BASE_REF:-}"; REF_NAME="${REF_NAME:-}"
long_lived() { [ "$1" = "dev" ] || [ "$1" = "main" ]; }
strict=true
case "$EVENT" in
  push)         long_lived "$REF_NAME" || strict=false ;;
  pull_request) long_lived "$BASE_REF" || strict=false ;;
  *)            strict=true ;;
esac
out "strict=$strict"

missing=""
[ -n "${TOK:-}" ] || missing="$missing secret:FRESH_ADOPT_PAT"
[ -n "${ORG:-}" ] || missing="$missing var:FRESH_ADOPT_ORG"

if [ -z "$missing" ]; then out "run=true"; exit 0; fi
out "run=false"
if [ "$strict" = true ] && [ "${REQUIRED:-}" = true ]; then
  echo "::error::fresh-adoption journey cannot run on ${EVENT:-this event}${BASE_REF:+ into $BASE_REF} — missing:$missing (FRESH_ADOPT_REQUIRED is true; see publish/actions/ts/e2e/README.md)."
  summary "**fresh adoption (timed): FAILED — missing:$missing**"
  exit 1
fi
if [ "$strict" = true ]; then
  echo "::warning::fresh-adoption journey: incomplete — missing:$missing. Not run, and not green evidence; once it is set, set the variable FRESH_ADOPT_REQUIRED=true so a missing value fails (Q64 A)."
  summary "**fresh adoption (timed): INCOMPLETE** — missing:$missing (not run; not green evidence)"
else
  echo "::notice::fresh-adoption journey skipped — missing:$missing. Allowed only off dev/main."
  summary "**fresh adoption (timed): SKIPPED** — missing:$missing (not green evidence)"
fi
exit 0
