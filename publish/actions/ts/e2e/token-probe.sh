# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# shellcheck shell=bash disable=SC2034  # BOARD_ITEMS / BOARD_POLLS are read by the script that sources this
#
# Sourced by the live adopter journey (adopter-journey.sh); extends token-scopes.sh. PRJ-121 intent 05, Item 5, ruling Q6.
#
# On 2026-10-07 the journey added an issue to a fresh board and then saw 0 readable items for three minutes,
# reproducibly (run 37637404040). The suspicion: TESTBED_BOT_PAT can write the board but not read the new repo's issue —
# a fine-grained token limited to selected repositories never includes a repo created during the run, and GraphQL then
# returns the item with `content: null`. These functions tell that apart from GitHub's index latency.
#
#   token_kind HEADERS            classic (scopes: …) | fine-grained | app-installation | oauth | unknown — from the
#                                 prefix of $GH_TOKEN and the x-oauth-scopes header of `gh api -i user`. Never the token.
#   token_probe ORG REPO ISSUE PROJ
#                                 prints, one `probe:` line each, what the token is and which call fails: read the repo,
#                                 read the issue, read the board's items (content + fieldValues). Never fails the run.
#   board_poll ORG PROJ REPO      waits for a readable item on the board. Items present but content null/REDACTED →
#                                 dies AT ONCE ("token cannot read <repo> — <kind>"); no items → waits (index latency),
#                                 BOARD_POLL_MAX polls BOARD_POLL_SLEEP s apart (60 × 3 s = 3 min). Sets BOARD_ITEMS and
#                                 BOARD_POLLS on success.

_probe_say() { printf '  probe: %s\n' "$*"; if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::notice::token probe: $*"; fi; }
_probe_die() { printf '  \033[31m✗ %s\033[0m\n' "$*"; if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::adopter journey: $*"; fi; exit 1; }

token_kind() {
  local headers="${1:-}" scopes t="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if printf '%s\n' "$headers" | tr -d '\r' | grep -qi '^x-oauth-scopes:'; then
    scopes="$(printf '%s\n' "$headers" | tr -d '\r' | awk 'tolower($0) ~ /^x-oauth-scopes:/ { sub(/^[^:]*:[ \t]*/, ""); print; exit }')"
    echo "classic (scopes: ${scopes:-none})"; return 0
  fi
  case "$t" in
    github_pat_*) echo "fine-grained" ;;
    ghp_*)        echo "classic (scopes: none listed)" ;;
    ghs_*)        echo "app-installation" ;;
    gho_*|ghu_*)  echo "oauth" ;;
    *)            echo "unknown" ;;
  esac
}

_items_query() { printf 'query{organization(login:"%s"){projectV2(number:%s){items(first:50){nodes{type content{__typename ... on Issue{number repository{nameWithOwner}}} fieldValues(first:20){nodes{__typename}}}}}}}' "$1" "$2"; }

# Reads a GraphQL items response on stdin; prints "<total> <readable> <error or ->".
_items_count() {
  node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let j; try { j = JSON.parse(s); } catch { console.log("0 0 unparseable response: " + s.slice(0, 120).replace(/\s+/g, " ")); return; }
    if (j.errors && j.errors.length) { console.log("0 0 " + j.errors.map((e) => e.message).join("; ").replace(/\s+/g, " ")); return; }
    const nodes = j?.data?.organization?.projectV2?.items?.nodes;
    if (!Array.isArray(nodes)) { console.log("0 0 no items field in the response"); return; }
    const readable = nodes.filter((n) => n && n.content && n.type !== "REDACTED").length;
    console.log(`${nodes.length} ${readable} -`);
  });'
}

token_probe() {
  local org="$1" repo="$2" issue="$3" proj="$4" headers kind out
  headers="$(gh api -i user 2>/dev/null | sed -n '1,/^\r\{0,1\}$/p' || true)"
  kind="$(token_kind "$headers")"
  _probe_say "token kind: $kind; login: $(gh api user --jq .login 2>/dev/null || echo '?')"
  if out="$(gh api "repos/$repo" --jq '"visibility=\(.visibility) permissions=\(.permissions // {} | to_entries | map(select(.value)) | map(.key) | join(","))"' 2>&1)"; then
    _probe_say "read repo $repo: ok ($out)"
  else _probe_say "read repo $repo: FAILS — ${out%%$'\n'*}"; fi
  if out="$(gh api "repos/$repo/issues/$issue" --jq '"#\(.number) \(.state)"' 2>&1)"; then
    _probe_say "read issue $repo#$issue: ok ($out)"
  else _probe_say "read issue $repo#$issue: FAILS — ${out%%$'\n'*}"; fi
  out="$(gh api graphql -f query="$(_items_query "$org" "$proj")" 2>/dev/null | _items_count || true)"
  # shellcheck disable=SC2086
  set -- $out
  if [ "${3:--}" != "-" ]; then _probe_say "read board #$proj items: FAILS — ${out#* * }"
  else _probe_say "read board #$proj items: $1 item(s), $2 with readable content$([ "$1" -gt "$2" ] && echo " — $(( $1 - $2 )) with content null/REDACTED: the token cannot read the linked issue")"; fi
  return 0
}

board_poll() {
  local org="$1" proj="$2" repo="$3" max="${BOARD_POLL_MAX:-60}" pause="${BOARD_POLL_SLEEP:-3}" i out total readable err headers
  for i in $(seq 1 "$max"); do
    out="$(gh api graphql -f query="$(_items_query "$org" "$proj")" 2>/dev/null | _items_count || true)"
    total="${out%% *}"; out="${out#* }"; readable="${out%% *}"; err="${out#* }"
    if [ "$readable" -ge 1 ] 2>/dev/null; then BOARD_ITEMS="$readable"; BOARD_POLLS="$i"
      printf '  board shows %s linked item(s) on poll %s\n' "$readable" "$i"; return 0; fi
    if [ "$total" -ge 1 ] 2>/dev/null; then
      headers="$(gh api -i user 2>/dev/null | sed -n '1,/^\r\{0,1\}$/p' || true)"
      _probe_die "token cannot read $repo — $(token_kind "$headers"): the board has $total item(s) whose content is null (poll $i). Waiting cannot fix a permission gap; a fine-grained token must cover ALL repositories of $org (ruling Q6)."
    fi
    if [ "$err" != "-" ] && [ "$i" -eq "$max" ]; then _probe_die "board #$proj query failed: $err"; fi
    [ "$err" = "-" ] && err=""
    if [ "$i" -lt "$max" ]; then sleep "$pause"; fi
  done
  _probe_die "no item on the board after $max polls (~$((max * pause)) s) — GitHub has not indexed the issue${err:+ (last: $err)}; gov seed would fail"
}
