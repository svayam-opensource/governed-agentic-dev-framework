# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# shellcheck shell=bash
#
# Sourced by fresh-adoption-journey.sh — the home page's promise, measured (Q62 A, Q64 A):
#
#   "Watch gov stop your first change until someone else approves it, in under 10 minutes."
#
#   timing_report BUDGET name=secs …   prints one line per phase and the total of the TIMED phases, writes the same as a
#                                      table to $GITHUB_STEP_SUMMARY, and returns 1 when the total exceeds BUDGET.
#                                      A phase named `install` (or `*-untimed`) is reported, never counted: installing
#                                      gov is not the path the promise describes.
# Pure apart from its output; test/e2e/fresh-timing.test.ts drives it.

timing_report() {
  local budget="$1"; shift
  local total=0 kv name secs counted rows=""
  for kv in "$@"; do
    name="${kv%%=*}"; secs="${kv#*=}"
    [[ "$secs" =~ ^[0-9]+$ ]] || { echo "timing_report: '$kv' is not name=<whole seconds>" >&2; return 2; }
    counted=yes
    case "$name" in install|*-untimed) counted=no ;; esac
    [ "$counted" = yes ] && total=$((total + secs))
    printf '  ⏱  %-34s %5ss%s\n' "$name" "$secs" "$([ "$counted" = yes ] || echo '   (not counted)')"
    rows="$rows| $name | $secs s | $([ "$counted" = yes ] && echo yes || echo no) |"$'\n'
  done
  local verdict="within budget"
  [ "$total" -le "$budget" ] || verdict="OVER BUDGET"
  printf '  ⏱  %-34s %5ss   (budget %ss — %s)\n' "TOTAL (setup → stop)" "$total" "$budget" "$verdict"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Fresh adoption — time to the first stop"
      echo
      echo "| phase | wall clock | counted |"
      echo "|---|---|---|"
      printf '%s' "$rows"
      echo "| **total** | **$total s** | budget $budget s — $verdict |"
    } >>"$GITHUB_STEP_SUMMARY"
  fi
  # shellcheck disable=SC2034  # read by the script that sources this
  TIMING_TOTAL="$total"
  [ "$total" -le "$budget" ]
}
