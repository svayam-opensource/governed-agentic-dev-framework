# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# shellcheck shell=bash
#
# Sourced by rule-model-journey.sh. WHAT A CHECK FOUND, READ FROM ITS CHECK RUN'S ANNOTATIONS.
#
# In GitHub Actions `gov check run` prints each finding as a workflow command (`::error title=<GOV-ID>,file=…::…`),
# which GitHub stores as an annotation on the job's check run. The journey reads those through the API — never the
# job's log: twice (2026-10-07) the log download came back EMPTY after minutes of polling, and an assertion over it
# failed although the check itself had correctly failed.
#
#   check_annotations REPO CHECK_ID     one line per annotation: `<level> <path>:<line> <message>`, the message's
#                                       newlines folded to spaces so one finding is one line
#   expect_annotation NAME PATTERN REPO CHECK_ID
#                                       an assertion (the sourcing script's `expect`): some annotation matches the
#                                       extended regex PATTERN. Annotations can lag the check's completion too, so it
#                                       polls (ANNOTATION_WAIT_SECS, default 90; every ANNOTATION_POLL_SECS, default 10).
#                                       On a miss it prints every annotation it DID find, so the failure explains itself.
#
# Needs from the sourcing script: DRY (1 = print the call, make none, list the assertion), fd 3 for the dry run's
# "+ call" lines, and `expect NAME CMD…`.

check_annotations() {
  gh api "repos/$1/check-runs/$2/annotations?per_page=100" \
    --jq '.[] | "\(.annotation_level) \(.path):\(.start_line) \(.message | gsub("\r?\n"; " "))"'
}

expect_annotation() {
  local name="$1" pattern="$2" repo="$3" id="$4" t0=$SECONDS found=""
  if [ "${DRY:-0}" = 1 ]; then
    printf '  + poll gh api repos/%s/check-runs/%s/annotations until one matches /%s/\n' "$repo" "$id" "$pattern" >&3
    expect "$name" true; return
  fi
  while :; do
    found="$(check_annotations "$repo" "$id" 2>/dev/null || true)"
    if [ -n "$found" ] && printf '%s\n' "$found" | grep -Eq -- "$pattern"; then expect "$name" true; return; fi
    [ $((SECONDS - t0)) -ge "${ANNOTATION_WAIT_SECS:-90}" ] && break
    [ -n "${DEADLINE:-}" ] && [ "$SECONDS" -ge "$DEADLINE" ] && break
    sleep "${ANNOTATION_POLL_SECS:-10}"
  done
  if [ -n "$found" ]; then
    { echo "  annotations on check run $id (none matched /$pattern/):"; printf '%s\n' "$found" | sed 's/^/    /'; } >&2
  else
    echo "  annotations on check run $id: none" >&2
  fi
  expect "$name" false
}
