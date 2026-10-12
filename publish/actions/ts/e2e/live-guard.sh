#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# live-guard.sh — the adopter-e2e `live` job's first step: can the live journeys run, and if not, may they skip?
# Run by .github/workflows/adopter-e2e.yml; its own file so a test can run it with the secrets unset
# (test/e2e/live-gate.test.ts) — the repository's real secrets are never touched to prove it.
#
# Policy Owner ruling Q2 (2026-10-12): a skipped live journey or assertion FAILS the run on a manual dispatch, on PRs
# into dev/main and on pushes to them; it may skip — visibly — only on a feature-branch push or a PR between feature
# branches. Until then a missing TESTBED_BOT_PAT set run=false and the job succeeded: a live tier that never ran
# read green.
#
# In (env): TOK ORG APP_ID APP_KEY GEMINI REAL_MODEL  — the secret/variable values (only emptiness is read)
#           EVENT BASE_REF REF_NAME                    — github.event_name / github.base_ref / github.ref_name
# Out ($GITHUB_OUTPUT): run=true|false, strict=true|false. Exit 1 when strict and something is missing.
set -euo pipefail

out() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >>"$GITHUB_OUTPUT"; fi; }
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >>"$GITHUB_STEP_SUMMARY"; fi; }

EVENT="${EVENT:-}"; BASE_REF="${BASE_REF:-}"; REF_NAME="${REF_NAME:-}"
long_lived() { [ "$1" = "dev" ] || [ "$1" = "main" ]; }
strict=true
case "$EVENT" in
  push)         long_lived "$REF_NAME" || strict=false ;;
  pull_request) long_lived "$BASE_REF" || strict=false ;;
  *)            strict=true ;;   # workflow_dispatch, and anything not listed: the gate is on
esac
out "strict=$strict"

missing=""
[ -n "${TOK:-}" ] || missing="$missing secret:TESTBED_BOT_PAT"
[ -n "${ORG:-}" ] || missing="$missing var:TESTBED_SANDBOX_ORG"
if [ "${REAL_MODEL:-false}" = "true" ] && [ -z "${GEMINI:-}" ]; then missing="$missing secret:GEMINI_API_KEY(real_model)"; fi
# The sandbox App enables the rule-model journey's assertion (f). Without it (f) is skipped, and a skipped assertion
# fails a strict run anyway — so a strict run names it here, before half an hour in the sandbox.
app_missing=""
[ -n "${APP_ID:-}" ] || app_missing="$app_missing secret:GOV_E2E_APP_CLIENT_ID"
[ -n "${APP_KEY:-}" ] || app_missing="$app_missing secret:GOV_E2E_APP_PRIVATE_KEY"

if [ "$strict" = true ]; then
  all="$missing$app_missing"
  if [ -n "$all" ]; then
    out "run=false"
    echo "::error::live journeys cannot run on ${EVENT:-this event}${BASE_REF:+ into $BASE_REF} — missing:$all (see publish/actions/ts/e2e/README.md). A skipped live tier is not green here (ruling Q2)."
    summary "**live journeys: FAILED — missing:$all**"
    exit 1
  fi
  out "run=true"; exit 0
fi

if [ -n "$missing" ]; then
  out "run=false"
  echo "::notice::live journeys skipped — missing:$missing (see publish/actions/ts/e2e/README.md). Allowed only on a feature-branch push."
  summary "**live journeys: SKIPPED** — missing:$missing (feature-branch push; this run is not green evidence)"
  exit 0
fi
out "run=true"
if [ -n "$app_missing" ]; then
  echo "::notice::sandbox App secrets missing:$app_missing — the rule-model journey will skip assertion (f) and report itself incomplete."
fi
exit 0
