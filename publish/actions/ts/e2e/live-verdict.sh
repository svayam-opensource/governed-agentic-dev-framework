#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# live-verdict.sh — the adopter-e2e `live` job's last step: ONE verdict per journey, at the job's end.
#
# On 2026-10-07 the rule-model journey's closing "31 passed, ok" banner was the last thing a FAILED job said. This step
# names each journey's outcome (log + run summary) and fails the job when any did not succeed. Since PRJ-121 intent 05
# (ruling Q2) it also lists every SKIPPED ASSERTION by name: a journey that passed with a skipped assertion is
# `incomplete`, which fails a strict run (dispatch, PRs into dev/main) and is a visible warning elsewhere.
#
# In (env): ADOPTER RULEMODEL — the steps' outcomes (success|failure|cancelled|skipped|"")
#           JOURNEYS          — instead of those two: "<journey>:<outcome> …" (the live job: adopter, joiner,
#                               adopter-close, rule-model; the bridge job: "bridge:<outcome>"). The outcome
#                               `unconfigured` means the guard found no secrets for that journey: an error on a strict
#                               run (ruling Q2), a visible warning on a feature-branch push.
#           STRICT            — live-guard.sh's strict output
#           E2E_SKIPS_FILE    — lines "<journey>\t<assertion>" appended by the journeys' skip() (may be absent)
set -uo pipefail

SKIPS="${E2E_SKIPS_FILE:-}"
STRICT="${STRICT:-true}"
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi; }
skipped_for() { [ -n "$SKIPS" ] && [ -f "$SKIPS" ] && awk -F'\t' -v j="$1" '$1==j { sub(/^[^\t]*\t/, ""); print }' "$SKIPS"; return 0; }

bad=0
summary "### Live journeys"
summary "| journey | outcome | skipped assertions |"
summary "|---|---|---|"
# shellcheck disable=SC2086  # JOURNEYS is a space-separated list of name:outcome words
for j in ${JOURNEYS:-"adopter:${ADOPTER:-}" "rule-model:${RULEMODEL:-}"}; do
  name="${j%%:*}"; outcome="${j#*:}"
  skipped="$(skipped_for "$name")"
  verdict="${outcome:-not run}"
  [ "$verdict" = success ] && [ -n "$skipped" ] && verdict=incomplete
  label="$name"; [ "$name" = adopter ] && label="adopter (seed → task → merge → close)"
  [ "$name" = joiner ] && label="joiner (second identity: join → work → task → merge)"
  [ "$name" = adopter-close ] && label="adopter close + teardown (after the joiner)"
  [ "$name" = bridge ] && label="bridge rehearsal (reset → upgrade --pr → propose → build → protect → install → doctor → journey)"
  list="$(printf '%s' "$skipped" | awk 'NF { printf "%sskipped: %s", (n++ ? "<br>" : ""), $0 }')"
  summary "| $label | $verdict | ${list:-—} |"
  case "$verdict" in
    success) echo "✓ $name journey: success" ;;
    incomplete)
      while IFS= read -r s; do
        [ -n "$s" ] || continue
        if [ "$STRICT" = true ]; then echo "::error::$name journey: incomplete — skipped $s"
        else echo "::warning::$name journey: incomplete — skipped $s (allowed on a feature-branch push only)"; fi
      done <<<"$skipped"
      [ "$STRICT" = true ] && bad=1 ;;
    unconfigured)
      if [ "$STRICT" = true ]; then echo "::error::$name journey: not run — its secrets are not configured (a skipped journey is not green here, ruling Q2)"; bad=1
      else echo "::warning::$name journey: skipped — its secrets are not configured (allowed on a feature-branch push only)"; fi ;;
    *) echo "::error::$name journey: $verdict"; bad=1 ;;
  esac
done
exit "$bad"
