#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# LIVE SIGNAL ROUND-TRIP — `gov signal` between two svayam-e2e projects, sent by one identity and received by another
# (PRJ-121 intent 03, task L09, gadf#287; spec 03 §4 and its live tier; D5, I03.2).
#
#   bot A (TESTBED_BOT_PAT, the adopter)                 bot B (TESTBED_JOINER_PAT, the joiner)
#     gov project sig-a --seed   → project A               (board B: bot A grants bot B WRITER)
#     gov project sig-b --seed   → project B               gov work --project=<B> --no-launch
#     ask      A → B ───────────────────────────────────▶ gov signal list: "Incoming signals: ask from <A>"
#     gov signal list: the ask is gone from Outgoing ◀──── gov signal ack <ask> --answer …
#     depends  A → B (A's anchor blocked) ──────────────▶ seen incoming · ack --answer → closed
#     notice   A → B ───────────────────────────────────▶ seen incoming · ack → closed
#     handover A → B (an issue moves boards) · merge A into B (A's board closes)
#
# Runs in the CI `live` job after the joiner journey and before the adopter's finish phase, in the org the adopter's
# work phase governed (E2E_HANDOFF) and on bot B's machine the joiner journey left (E2E_JOINER_HOME).
#
# A PERSON SENDS (spec 03 Q6, ruling (b)): `gov signal` refuses without a terminal and confirms every send. This
# journey does not get round that — each sending command runs in a pseudo-terminal (`script`) and answers the
# confirmation "y", exactly as the person at the keyboard would. Listing needs no terminal.
#
# Required env (live):
#   E2E_HANDOFF        written by adopter-journey.sh E2E_PHASE=work (E2E_ORG, WS_REPO, RUN_ID, JOINER_LOGIN …)
#   GH_TOKEN           bot A's token (TESTBED_BOT_PAT)
#   E2E_JOINER_TOKEN   bot B's token (TESTBED_JOINER_PAT) · E2E_JOINER_LOGIN · E2E_JOINER_HOME (bot B's HOME)
# Optional:
#   --dry-run (or E2E_DRY_RUN=1)  HERMETIC: prints every gh / git / gov / script call instead of making it
#                                 (test/e2e/signal-journey-dry.test.ts)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=live-retry.sh
. "$HERE/live-retry.sh"

DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;; esac; done
[ "${E2E_DRY_RUN:-0}" = "1" ] && DRY=1

if [ "$DRY" = 1 ]; then
  E2E_ORG="${E2E_ORG:-svayam-e2e}"; WS_REPO="gov-e2e-dry-gov"; RUN_ID="dry"
  E2E_JOINER_LOGIN="${E2E_JOINER_LOGIN:-joiner-bot}"; E2E_JOINER_HOME="/dry/joiner-home"; B_TOKEN="(joiner token)"
else
  : "${E2E_HANDOFF:?set E2E_HANDOFF (written by adopter-journey.sh E2E_PHASE=work)}"
  : "${GH_TOKEN:?set GH_TOKEN (bot A, TESTBED_BOT_PAT)}"
  : "${E2E_JOINER_TOKEN:?set E2E_JOINER_TOKEN (bot B, TESTBED_JOINER_PAT)}"
  : "${E2E_JOINER_LOGIN:?set E2E_JOINER_LOGIN (TESTBED_JOINER_LOGIN)}"
  : "${E2E_JOINER_HOME:?set E2E_JOINER_HOME (the HOME of bot B, as the joiner journey left it)}"
  [ -f "$E2E_HANDOFF" ] || { echo "no handoff at $E2E_HANDOFF — the adopter's work phase did not run" >&2; exit 1; }
  # shellcheck disable=SC1090
  . "$E2E_HANDOFF"
  for v in E2E_ORG WS_REPO RUN_ID; do
    [ -n "${!v:-}" ] || { echo "the handoff has no $v — the adopter's work phase stopped early (see its log)" >&2; exit 1; }
  done
  [ -d "$E2E_JOINER_HOME/.gov" ] || { echo "bot B's HOME ($E2E_JOINER_HOME) has no ~/.gov — the joiner journey did not join" >&2; exit 1; }
  B_TOKEN="$E2E_JOINER_TOKEN"; unset E2E_JOINER_TOKEN
  E2E_JOINER_LOGIN="$(printf '%s' "$E2E_JOINER_LOGIN" | tr -d '[:space:]')"
fi
unset GOV_AGENT_SESSION   # a signal from an agent session is refused (Q6); this is a person's run

PASS=0; FAIL=0; BOARDS=()
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; FAIL=$((FAIL+1)); if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::signal journey: $*"; fi; exit 1; }
on_err() { local rc=$? line=$1 cmd=$2; [ "$rc" -eq 0 ] && return 0
  printf '  \033[31m✗ line %s exited %s: %s\033[0m\n' "$line" "$rc" "$cmd"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::signal journey: line $line exited $rc: $cmd"; fi; return 0; }
trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR
exec 3>&2
# xo <dry-answer> cmd… : run (stdout to the caller), or in a dry run print it and answer for it.
xo() { local d="$1"; shift; if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*" >&3; printf '%s\n' "$d"; return 0; fi; "$@"; }
# As bot B: its HOME (registry, git credentials) and its token — for this one command only.
asB() { HOME="$E2E_JOINER_HOME" GH_TOKEN="$B_TOKEN" "$@"; }
# A person confirming: the command in a pseudo-terminal, "y" typed at the prompt; carriage returns stripped.
# With a terminal, gov's context gate would ask "Proceed?" before the signal's own question; GOV_YES acknowledges that
# banner only (context-gate.ts) — the signal's confirmation (Q6) is still asked and answered. Never longer than 3 min:
# a question nobody answers would otherwise hang the job until its timeout (run 38482423935).
person() { printf 'y\n' | GOV_YES=1 timeout 180 script -qec "$(printf '%q ' "$@")" /dev/null | tr -d '\r'; return "${PIPESTATUS[1]}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) printf '%s\n' "$1" | tail -12 | sed 's/^/    /'; die "$3 — expected: $2" ;; esac; }
hasnt() { case "$1" in *"$2"*) printf '%s\n' "$1" | tail -12 | sed 's/^/    /'; die "$3 — did not expect: $2" ;; *) ok "$3" ;; esac; }
url_in() { printf '%s\n' "$1" | grep -oE 'https://github\.com/[^ )]+/issues/[0-9]+' | head -1; }

cleanup() {
  local rc=$?
  trap - ERR
  # The two boards are this journey's; their issues live in the adopter's gov repo, which its finish phase deletes.
  if [ "$DRY" != 1 ]; then
    for n in "${BOARDS[@]:+${BOARDS[@]}}"; do
      gh project delete "$n" --owner "$E2E_ORG" >/dev/null 2>&1 && echo "  deleted project #$n" || echo "  ! could not delete project #$n"
    done
  fi
  printf '\n\033[1m═══ signal-journey%s: %d passed, %s ═══\033[0m\n' "$([ "$DRY" = 1 ] && echo ' (DRY RUN)')" "$PASS" \
    "$([ "$rc" -eq 0 ] && echo ok || echo "FAILED (exit $rc)")"
  exit "$rc"
}
trap cleanup EXIT

# ── gov on PATH: the adopter journey installed it under bot A's HOME in an earlier step; a new step has a new PATH ──
if [ "$DRY" != 1 ]; then
  if ! npm config get prefix 2>/dev/null | grep -qF "$HOME"; then export NPM_CONFIG_PREFIX="$HOME/.npm-global"; export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"; fi
  command -v gov >/dev/null || { [ -n "${GOV_TARBALL:-}" ] && npm i -g "$GOV_TARBALL" >/dev/null 2>&1; } || true
  command -v gov >/dev/null || die "gov is not installed for bot A (set GOV_TARBALL)"
  cd "${RUNNER_TEMP:-/tmp}"   # GOVERNED context comes from the registry, never from the folder this runs in
fi

# ── 0. Two identities ────────────────────────────────────────────────────────────────────────────────────────────
step "Two identities"
A_ID="$(xo 1 gh api user --jq .id)"; B_ID="$(asB xo 2 gh api user --jq .id)"
[ -n "$A_ID" ] && [ -n "$B_ID" ] && [ "$A_ID" != "$B_ID" ] && ok "sender bot A (account id $A_ID) ≠ receiver bot B (account id $B_ID)" \
  || die "the sender and the receiver are not two accounts (ids '${A_ID:-?}' / '${B_ID:-?}')"
command -v script >/dev/null || [ "$DRY" = 1 ] || die "\`script\` (util-linux) is needed to give gov signal its terminal"

# ── 1. Two projects, both seeded by bot A; bot B joins B ─────────────────────────────────────────────────────────
seed_project() {   # <name> <dry board number> → sets P_URL P_NUM P_ID P_DIR
  local out rc=0 anchor
  out="$(xo "Handing to gov seed https://github.com/orgs/$E2E_ORG/projects/$2
  workspace: /dry/projects/PRJ-$2-$1" gov project "$1" --seed </dev/null 2>&1)" || rc=$?
  P_URL="$(printf '%s\n' "$out" | grep -oE "https://github\.com/orgs/$E2E_ORG/projects/[0-9]+" | head -1)"
  [ -n "$P_URL" ] || { printf '%s\n' "$out" | tail -12; die "gov project $1 did not print its board"; }
  P_NUM="${P_URL##*/}"; BOARDS+=("$P_NUM")   # deleted at the end even if seeding fails below
  if [ "$rc" -ne 0 ]; then
    # gov waited 90 s for GitHub's project index to list the new anchor and stopped, saying to run `gov seed` when it
    # does (run 38754541610: the index lagged past 90 s). Not a gov failure — do what gov said, within a bound: wait
    # up to 3 min more; then add the anchor once more (as 2a373bb does for the adopter's board) and wait again.
    case "$out" in *"does not list its anchor yet"*) ;; *) printf '%s\n' "$out" | tail -12; die "gov project $1 --seed failed" ;; esac
    anchor="$(printf '%s\n' "$out" | grep -oE "https://github\.com/$E2E_ORG/[^ ]+/issues/[0-9]+" | head -1)"
    [ -n "$anchor" ] || { printf '%s\n' "$out" | tail -12; die "gov project $1 named no anchor issue"; }
    printf '  · board #%s does not list its anchor yet (GitHub index lag) — waiting, then gov seed as gov said\n' "$P_NUM"
    if ! board_lists "$E2E_ORG" "$P_NUM" "$anchor" 180; then
      printf '  · still not listed after 3 min — re-adding %s once: %s\n' "$anchor" \
        "$(gh project item-add "$P_NUM" --owner "$E2E_ORG" --url "$anchor" --format json 2>&1 | head -c 200)"
      board_lists "$E2E_ORG" "$P_NUM" "$anchor" 180 \
        || die "board #$P_NUM never listed its anchor $anchor (~6 min after gov's own 90 s) — GitHub's project index, not gov"
    fi
    out="$(gov seed "$P_URL" </dev/null 2>&1)" || { printf '%s\n' "$out" | tail -12; die "gov seed $P_URL failed (after the board listed its anchor)"; }
  fi
  P_ID="PRJ-${P_NUM}-$1"
  P_DIR="$(printf '%s\n' "$out" | sed -n 's/^  workspace: //p' | head -1)"; P_DIR="${P_DIR/#\~/$HOME}"
  [ -n "$P_DIR" ] || die "gov project $1 --seed did not say where its workspace is"
  ok "$P_ID seeded (board #$P_NUM)"
}
step "gov project --seed × 2 (as bot A)"
seed_project "sig-a-$RUN_ID" 101; A_NUM="$P_NUM"; A_PID="$P_ID"; A_WS="$P_DIR/$WS_REPO"
seed_project "sig-b-$RUN_ID" 102; B_NUM="$P_NUM"; B_PID="$P_ID"

step "Bot B becomes a writer on $B_PID and joins it"
if [ "$DRY" = 1 ]; then printf '  + grant %s WRITER on board #%s (as bot A)\n' "$E2E_JOINER_LOGIN" "$B_NUM" >&3
else
  pid="$(gh project view "$B_NUM" --owner "$E2E_ORG" --format json --jq .id)"; uid="$(gh api "users/$E2E_JOINER_LOGIN" --jq .node_id)"
  gh api graphql -f p="$pid" -f u="$uid" -f query='mutation($p:ID!,$u:ID!){updateProjectV2Collaborators(input:{projectId:$p,collaborators:[{userId:$u,role:WRITER}]}){clientMutationId}}' >/dev/null \
    || die "could not make bot B a WRITER on board #$B_NUM"
fi
ok "bot B is a writer on board #$B_NUM"
WORK_OUT="$(asB xo "  ✓ '$B_PID' is ready at:  /dry/b/$B_PID" gov work --project="$B_PID" --no-launch </dev/null 2>&1)" \
  || { printf '%s\n' "$WORK_OUT" | tail -12; die "bot B could not open $B_PID"; }
B_WS="$(printf '%s\n' "$WORK_OUT" | sed -n "s/^  ✓ '[^']*' is ready at:  //p" | tail -1)/$WS_REPO"
ok "bot B has $B_PID open at ${B_WS%/*}"

inA() { if [ "$DRY" = 1 ]; then printf '  + (A in %s) %s\n' "$A_PID" "$*" >&3; return 0; fi; ( cd "$A_WS" && "$@" ); }
inB() { if [ "$DRY" = 1 ]; then printf '  + (B in %s) %s\n' "$B_PID" "$*" >&3; return 0; fi; ( cd "$B_WS" && asB "$@" ); }
# the receiver's/sender's manifest lines, as the session protocol shows them (gov signal list)
manifest_B() { if [ "$DRY" = 1 ]; then inB gov signal list; printf -- '- **Incoming signals:** %s from %s — %s (%s)\n' "$1" "$A_PID" "$2" "$3"; return 0; fi; inB gov signal list </dev/null 2>&1; }
manifest_A() { if [ "$DRY" = 1 ]; then inA gov signal list; printf -- '- **Outgoing signals:** none\n'; return 0; fi; inA gov signal list </dev/null 2>&1; }
sent_url() { if [ "$DRY" = 1 ]; then printf 'https://github.com/%s/%s/issues/%s\n' "$E2E_ORG" "$WS_REPO" "$1"; else url_in "$2"; fi; }
closed() { [ "$(xo CLOSED gh issue view "$1" --json state --jq .state 2>/dev/null)" = CLOSED ]; }

# ── 2. ask, depends, notice: sent by A, seen by B, closed by B, gone from A's outgoing ──────────────────────────────
n=10
for kind in ask depends notice; do
  n=$((n+1))
  step "$kind — $A_PID → $B_PID"
  title="e2e $kind $RUN_ID"
  OUT="$(inA person gov signal "$kind" --to "$B_PID" --title "$title" 2>&1)" || { printf '%s\n' "$OUT" | tail -12; die "gov signal $kind failed (as bot A)"; }
  URL="$(sent_url "$n" "$OUT")"; [ -n "$URL" ] || { printf '%s\n' "$OUT" | tail -12; die "gov signal $kind did not print the signal's url"; }
  ok "bot A sent the $kind: $URL"
  M="$(manifest_B "$kind" "$title" "$URL")"
  has "$M" "- **Incoming signals:** " "bot B's session manifest has its Incoming signals line"
  has "$M" "$kind from $A_PID — $title ($URL)" "…and it names this $kind from $A_PID"
  if [ "$kind" = notice ]; then ACK="$(inB person gov signal ack "$URL" 2>&1)" || { printf '%s\n' "$ACK" | tail -8; die "bot B could not ack the notice"; }
  else ACK="$(inB person gov signal ack "$URL" --answer "answered by bot B ($RUN_ID)" 2>&1)" || { printf '%s\n' "$ACK" | tail -8; die "bot B could not answer the $kind"; }
  fi
  closed "$URL" && ok "bot B closed it" || die "the $kind is still open after bot B's ack"
  hasnt "$(manifest_A)" "$URL" "bot A's Outgoing signals no longer list it — the round-trip is complete"
done

# ── 3. handover: an issue moves from A's board to B's ───────────────────────────────────────────────────────────────
step "handover — $A_PID → $B_PID"
ITEM="$(xo "https://github.com/$E2E_ORG/$WS_REPO/issues/20" gh issue create --repo "$E2E_ORG/$WS_REPO" --title "e2e handover item $RUN_ID" --body "moves from A to B")"
xo "" gh project item-add "$A_NUM" --owner "$E2E_ORG" --url "$ITEM" >/dev/null || die "could not put the handover item on board #$A_NUM"
OUT="$(inA person gov signal handover --to "$B_PID" --title "e2e handover $RUN_ID" --items "$ITEM" 2>&1)" || { printf '%s\n' "$OUT" | tail -12; die "gov signal handover failed"; }
has "${OUT:-moved $ITEM}" "moved $ITEM" "the item moved"
on_boards() { xo "$B_NUM" gh api graphql -f u="$1" -f query='query($u:URI!){resource(url:$u){... on Issue{projectItems(first:20){nodes{project{number}}}}}}' --jq '[.data.resource.projectItems.nodes[].project.number]|map(tostring)|join(" ")'; }
BS=" $(on_boards "$ITEM") "
case "$BS" in *" $B_NUM "*) ok "it is on $B_PID's board" ;; *) die "the handed-over item is not on board #$B_NUM (on:$BS)" ;; esac
case "$BS" in *" $A_NUM "*) die "the handed-over item is still on board #$A_NUM" ;; *) ok "and off $A_PID's" ;; esac

# ── 4. merge: A into B; A's board closes ─────────────────────────────────────────────────────────────────────────────
step "merge — $A_PID into $B_PID"
OUT="$(inA person gov signal merge --to "$B_PID" --title "e2e merge $RUN_ID" 2>&1)" || { printf '%s\n' "$OUT" | tail -12; die "gov signal merge failed"; }
[ "$(xo true gh project view "$A_NUM" --owner "$E2E_ORG" --format json --jq .closed)" = true ] && ok "$A_PID's board is closed" \
  || die "board #$A_NUM is still open after the merge"

[ "$FAIL" -eq 0 ]
