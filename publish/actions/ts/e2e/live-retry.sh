# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# shellcheck shell=bash
#
# Bounded retries for the live journeys, for GitHub's OWN failures only — never for ours (sourced; no side effects).
# Each says what it saw, retries a fixed number of times, and fails with GitHub's own words.
#
#   push_retry <dir> <branch>            git push -u origin <branch>; 3 tries on a server-side failure
#                                        (adopter-e2e run 38754541610: `! [remote rejected] e2e/policy -> e2e/policy
#                                        (failed)` on a fresh repo — the same push seconds later succeeds).
#   board_lists <org> <board#> <url> <secs> [pause]
#                                        0 once board #n lists the item <url> (GitHub's project index is eventually
#                                        consistent: run 38754541610 waited > 90 s for a new board's anchor).

# The same patterns gov's own push retries on (src/lifecycle/vcs.ts TRANSIENT_PUSH). Ours (non-fast-forward, protected
# branch, permission) never match, so they fail at once.
LIVE_TRANSIENT_PUSH='fatal error in commit_refs|remote rejected\][^\n]*\(fail(ure|ed)\)|internal server error|returned error: 5[0-9][0-9]|HTTP 5[0-9][0-9]|RPC failed|early EOF|Connection reset|Could not resolve host|unexpected disconnect'

push_retry() { local dir="$1" branch="$2" i err
  for i in 1 2 3; do
    if err="$(git -C "$dir" push -q -u origin "$branch" 2>&1)"; then return 0; fi
    if ! printf '%s' "$err" | grep -qiE "$LIVE_TRANSIENT_PUSH" || [ "$i" -eq 3 ]; then
      printf '  ! git push %s failed (try %s/3): %s\n' "$branch" "$i" "$(printf '%s' "$err" | tr '\n' ' ' | head -c 300)" >&2
      return 1
    fi
    printf '  · git push %s: GitHub refused it on its side (try %s/3) — again in %ss\n' "$branch" "$i" "$((i * ${LIVE_RETRY_PAUSE:-5}))" >&2
    sleep "$((i * ${LIVE_RETRY_PAUSE:-5}))"
  done; }

board_lists() { local org="$1" n="$2" url="$3" secs="$4" pause="${5:-10}" t0=$SECONDS urls
  while :; do
    urls="$(gh project item-list "$n" --owner "$org" --format json --limit 200 --jq '.items[].content.url' 2>/dev/null || true)"
    printf '%s\n' "$urls" | grep -qxF "$url" && return 0
    [ $((SECONDS - t0)) -ge "$secs" ] && return 1
    sleep "$pause"
  done; }
