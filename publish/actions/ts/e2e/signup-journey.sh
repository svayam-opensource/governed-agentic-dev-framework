#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# INSTALL-SIGNUP JOURNEY — the front door behind gov-app signup, end to end (PRJ-121 intent 02 addendum, task IS-E6;
# spec addendum-install-signup.spec.md §9 live journey, §10 acceptance IS-A*).
#
#   scripts host   anonymous: install.sh · install.ps1 · /v/<ver>/ · versions.json → 200, text/plain, no 3xx;
#                  GET / → 302 to the portal's /install                                         IS-A16 IS-A17 IS-A12
#   /install       signed out: Sign in (returns to /install) · Register · "gov is open source (MIT)"   IS-A11 IS-A14
#   register       e2e admin (a GitHub org admin) registers svayam-e2e in uat → active, Free, admin   IS-A1 IS-A5
#                  a second registration is refused, naming no account                              IS-A4
#                  a non-admin's registration waits for an org admin; one left 7 days expires        IS-A2 IS-A3
#   install gov    the admin's /install equals versions.json; the commands fetch-then-run           IS-A12 IS-A13
#   members        invite B by email (IAM emails), D by GitHub login (rename-proof, impostor refused) IS-A6 IS-A7
#                  C (org member, not invited) links GitHub → Request to join → declined → approved  IS-A8 IS-A9
#                  remove a member → signed-out view; the last admin stays                          IS-A10
#   suspend        platform admin suspends → notice only, invites/joins/lease refused, scripts 200   IS-A19
#   environments   the uat account is absent from dev and prod; svayam-e2e registers in dev apart    IS-A20
#   unreachable    versions.json unreadable → the page shows no command                             IS-A15
#
# THREE MODES — one of them is required:
#   --dry-run  HERMETIC: prints every call instead of making it; assertions are listed, not evaluated.
#              (test/e2e/signup-journey-dry.test.ts)
#   --stub     the portal and IAM are e2e/stub/signup-portal.mjs (the spec's behaviour, from memory); the scripts
#              host is a REAL gov-install built from this worktree's site/ (e2e/local-gov-install.sh, Docker), or
#              E2E_GOV_INSTALL_URL if one is already running. E2E_GOV_INSTALL=fixture uses e2e/stub/gov-install-
#              fixture.mjs instead — no Docker, no network: how the unit test proves the journey's own assertions.
#   --live     svayam-e2e against uat: portal-uat, uat's IAM, the gov-uat GitHub App and plan P4's identities.
#              NOT RUNNABLE YET — it stops at its guard, SKIPPED, naming what it waits on (LIVE_WAITS_ON below).
#
# Which IS-A ids each mode proves:
#   stub  IS-A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14(the view's return-to) A15 A16 A17 A19 A20
#   live  the §9 subset — A1 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A16 A17 A18 A19 A20 — and, green end to end, IS-A22.
#         A2 A3 A15 and A20's dev registration stay stub-only: they need a second sandbox org, a test clock, a
#         broken scripts host, or a registration outside uat, none of which the live journey may make.
#   neither  IS-A14's real browser redirect (IS-E1's Playwright), IS-A18's winget, IS-A21 (a person, IS-E8).
#
# Env (stub):  E2E_GOV_INSTALL_URL (a running gov-install) · E2E_GOV_INSTALL=fixture · E2E_SKIPS_FILE · E2E_KEEP=1
#   E2E_FIXTURE_BREAK / E2E_PORTAL_BREAK: make the fixture or the stub portal serve one forbidden defect (unit tests)
# Env (live, once unblocked): E2E_ORG=svayam-e2e · E2E_PORTAL_API_{DEV,UAT,PROD} · E2E_SIGNUP_TOKEN_<IDENTITY>
#   (ADMIN, EMAIL_INVITEE, GH_INVITEE, ORG_MEMBER, OUTSIDER, IMPOSTOR, PLATFORM_ADMIN) — tokens are read from the
#   environment and handed to curl on stdin, never on a command line and never printed.
# shellcheck disable=SC2015,SC2016  # `a && b || die` is the house idiom; assertions are eval'd strings, expanded late
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

MODE=""
for a in "$@"; do case "$a" in --dry-run) MODE=dry ;; --stub) MODE=stub ;; --live) MODE=live ;; *) MODE=bad ;; esac; done
[ "${E2E_DRY_RUN:-0}" = 1 ] && MODE=dry
case "$MODE" in dry|stub|live) ;; *) echo "usage: $0 --dry-run | --stub | --live" >&2; exit 2 ;; esac
DRY=0; [ "$MODE" = dry ] && DRY=1
exec 3>&2   # the dry run's "+ call" lines

# WHAT THE LIVE JOURNEY WAITS ON (plan addendum-install-signup §2–§4). Each line is removed when it lands; the live
# mode runs only when this list is empty AND the live driver below has been written against PRJ-119's real API.
LIVE_WAITS_ON=(
  "PRJ-119 S-g (registration creates an account; account status) — svm-prj-work, not sent yet (plan P2)"
  "PRJ-119 S-h (verified GitHub org link completes registration; per-env App mapping) with S-b #438"
  "PRJ-119 S-i (invitations, join requests, membership) with S-c #439"
  "PRJ-119 S-k (account data per environment) and S-f #442 (Free plan)"
  "IS-E9 / plan P3: the gov-uat GitHub App, installed on svayam-e2e"
  "plan P4: the svayam-e2e identities (admin, email invitee, GitHub-login invitee, org member, outsider, platform admin) and their tokens as secrets"
  "910#282: portal-web served on portal-uat (parent E22); the IS-E1/E3/E4/E5 live halves"
  "a uat reset for the svayam-e2e account between runs (PRJ-119), so each run registers afresh"
)

PASS=0; SKIP=0; PIDS=(); CONTAINER=""
TMPD="$(mktemp -d)"
RUN_ID="${E2E_RUN_ID:-$(date +%s)-$((RANDOM % 1000))}"; [ "$DRY" = 1 ] && RUN_ID=dry
ORG_NAME="E2E Sandbox $RUN_ID"   # the account's display name: no refusal or join answer may ever contain it

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::signup journey: $*"; fi; exit 1; }
# A SKIP IS NOT A PASS (ruling Q2): named in the log, as an annotation, and in $E2E_SKIPS_FILE for live-verdict.sh.
skip() { printf '  \033[33m⤼ SKIPPED: %s\033[0m\n' "$*"; SKIP=$((SKIP+1))
  if [ -n "${E2E_SKIPS_FILE:-}" ]; then printf 'signup\t%s\n' "$*" >>"$E2E_SKIPS_FILE"; fi
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::signup journey: skipped $* — the journey is incomplete"; fi
  return 0; }
on_err() { local rc=$? line=$1 cmd=$2; [ "$rc" -eq 0 ] && return 0
  printf '  \033[31m✗ line %s exited %s: %s\033[0m\n' "$line" "$rc" "$cmd"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::signup journey: line $line exited $rc: $cmd"; fi; return 0; }
trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR
# An assertion: the dry run lists it; stub and live evaluate it, and on a miss show the last answer.
expect() { local msg="$1"; shift; if [ "$DRY" = 1 ]; then printf '  ◇ would assert: %s\n' "$msg"; PASS=$((PASS+1)); return 0; fi
  if "$@"; then ok "$msg"; else printf '    last answer: %s %s\n' "${ST:-}" "$(printf '%s' "${BD:-}" | head -c 400)"; die "$msg"; fi; }
# the stub's test clock (stub only): move every environment's time forward N days
x_clock() { api - - POST /_stub/clock "{\"days\":$1}"; }
# stub-only steps are not run live; that is said, not hidden (the live journey's coverage is the list above)
stub_only() { [ "$MODE" = live ] && { printf '  · stub only: %s\n' "$*"; return 1; }; return 0; }

# j JSON EXPR — a field of a JSON document (EXPR is JavaScript over `o`); "" in a dry run.
j() { [ "$DRY" = 1 ] && return 0
  node -e 'let o;try{o=JSON.parse(process.argv[1])}catch{o={}};let v;try{v=(new Function("o","return ("+process.argv[2]+")"))(o)}catch{v=undefined};process.stdout.write(v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):String(v))' "$1" "$2"; }
jid() { if [ "$DRY" = 1 ]; then printf '<%s>' "$2"; else j "$1" "o.$2"; fi; }
has()  { case "$BD" in *"$1"*) return 0 ;; *) return 1 ;; esac; }
lacks() { local s; for s in "$@"; do case "$BD" in *"$s"*) return 1 ;; esac; done; return 0; }
is() { test "$(j "$BD" "$1")" = "$2"; }
st() { test "$ST" = "$1"; }

# ── the journey port: api WHO ENV METHOD PATH [JSON] → ST, BD ─────────────────────────────────────────────────────
# WHO is a P4 identity or "-" (anonymous). ENV is dev|uat|prod, or "-" for identity-wide calls (/api/me/…, /_stub/…).
API_ROOT=""
api_base() { if [ "$2" = "-" ]; then printf '%s' "$API_ROOT"; elif [ "$MODE" = live ]; then local v; v="E2E_PORTAL_API_$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')"; printf '%s' "${!v:?set $v}"; else printf '%s/%s/api' "$API_ROOT" "$2"; fi; }
token_of() { if [ "$MODE" = live ]; then local v; v="E2E_SIGNUP_TOKEN_$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')"; printf '%s' "${!v:-}"; else printf 'stub:%s' "$1"; fi; }
api() {
  local who="$1" env="$2" method="$3" path="$4" data="${5:-}" url
  url="$(api_base "$who" "$env")$path"
  if [ "$DRY" = 1 ]; then printf '  + curl -X %s %s%s   (as %s)\n' "$method" "${url#"$API_ROOT"}" "${data:+ -d $data}" "$who" >&3; ST=200; BD="{}"; return 0; fi
  local args=(-sS --max-time 20 -X "$method" -o "$TMPD/body" -w '%{http_code}' -H 'content-type: application/json')
  [ -n "$data" ] && args+=(--data-raw "$data")
  if [ "$who" = "-" ]; then ST="$(curl "${args[@]}" "$url" || echo 000)"
  else ST="$(printf 'Authorization: Bearer %s\n' "$(token_of "$who")" | curl "${args[@]}" -H @- "$url" || echo 000)"; fi
  BD="$(cat "$TMPD/body" 2>/dev/null || true)"
}

cleanup() {
  local rc=$?
  trap - ERR
  for p in "${PIDS[@]:+${PIDS[@]}}"; do kill "$p" 2>/dev/null || true; done
  if [ -n "$CONTAINER" ] && [ "${E2E_KEEP:-0}" != 1 ]; then bash "$HERE/local-gov-install.sh" down "$CONTAINER"; fi
  rm -rf "$TMPD"
  printf '\n\033[1m═══ signup-journey (%s): %d passed, %d skipped, %s ═══\033[0m\n' "$( [ "$DRY" = 1 ] && echo 'DRY RUN' || echo "$MODE")" "$PASS" "$SKIP" \
    "$(if [ "$rc" -ne 0 ]; then echo "FAILED (exit $rc)"; elif [ "$SKIP" -gt 0 ]; then echo INCOMPLETE; else echo ok; fi)"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# start_server NAME CMD… → PORT (waits for its "listening <port>" line)
start_server() { local name="$1" out="$TMPD/$1.out"; shift
  "$@" >"$out" 2>"$TMPD/$name.err" & PIDS+=("$!")
  for _ in $(seq 1 50); do PORT="$(sed -n 's/^listening //p' "$out" | head -1)"; [ -n "$PORT" ] && return 0; sleep 0.1; done
  cat "$TMPD/$name.err" >&2; die "$name did not start"; }

# shellcheck source=scripts-host.sh
. "$HERE/scripts-host.sh"

# ── 0. where this run points ──────────────────────────────────────────────────────────────────────────────────────
step "Mode: $MODE"
GI_URL=""
case "$MODE" in
  live)
    # The sandbox only: never Svayamtech, never prod accounts (spec §9). Checked before anything else.
    [ "${E2E_ORG:-svayam-e2e}" = svayam-e2e ] || die "the live signup journey runs only in svayam-e2e (E2E_ORG=$E2E_ORG)"
    if [ "${#LIVE_WAITS_ON[@]}" -gt 0 ]; then
      echo "  The live install-signup journey (IS-E6, IS-A22) cannot run yet. It waits on:"
      for w in "${LIVE_WAITS_ON[@]}"; do echo "    - $w"; done
      skip "live install-signup journey (IS-A22) — waiting on ${#LIVE_WAITS_ON[@]} prerequisites (PRJ-119 S-g/S-h/S-i/S-k, P3, P4, 910#282); see the log"
      exit 0
    fi
    # TODO(IS-E6 live half): once LIVE_WAITS_ON is empty, write the live driver here — map api()'s calls onto
    # PRJ-119's published endpoints (the stub's shapes are proposals), verify a registration through the gov-uat
    # App install, and reset the svayam-e2e uat account first. Until then nothing below runs live.
    die "the live driver is not written yet (signup-journey.sh, TODO IS-E6 live half)" ;;
  dry)
    API_ROOT="http://stub-portal"; GI_URL="http://127.0.0.1:4002" ;;
  stub)
    if [ -n "${E2E_GOV_INSTALL_URL:-}" ]; then GI_URL="$E2E_GOV_INSTALL_URL"; echo "  gov-install: $GI_URL (already running)"
    elif [ "${E2E_GOV_INSTALL:-}" = fixture ]; then
      start_server gov-install-fixture node "$HERE/stub/gov-install-fixture.mjs" ${E2E_FIXTURE_BREAK:+--break "$E2E_FIXTURE_BREAK"}
      GI_URL="http://127.0.0.1:$PORT"; echo "  gov-install: the FIXTURE at $GI_URL (not site/ — the journey's own assertions are what this tests)"
    else
      out="$(bash "$HERE/local-gov-install.sh" up)" || die "could not build and start a local gov-install from site/ (Docker)"
      GI_URL="$(printf '%s\n' "$out" | sed -n 's/^url=//p')"; CONTAINER="$(printf '%s\n' "$out" | sed -n 's/^name=//p')"
      echo "  gov-install: a local container built from this worktree's site/ at $GI_URL ($CONTAINER)"
    fi
    start_server signup-portal node "$HERE/stub/signup-portal.mjs" ${E2E_PORTAL_BREAK:+--break "$E2E_PORTAL_BREAK"} --gov-install "dev=$GI_URL" --gov-install "uat=$GI_URL" --gov-install "prod=$GI_URL"
    API_ROOT="http://127.0.0.1:$PORT"; echo "  portal + IAM: the stub at $API_ROOT" ;;
esac

# ── 1. the scripts host, per environment (IS-A16, IS-A17, IS-A12's scripts half) ──────────────────────────────────
for e in dev uat prod; do
  [ "$MODE" = live ] && [ "$e" != uat ] && continue   # live is uat only (§9); IS-E7 checks dev and prod after cutover
  step "Scripts host — $(dn gov "$e"), anonymous, no redirects followed"
  scripts_host_checks "$e" "$GI_URL"
done
# shellcheck disable=SC2034  # read inside the eval'd IS-A12 assertion below
VJ="${VJ_uat:-}"

# ── 2. /install, signed out (IS-A11, IS-A14) ─────────────────────────────────────────────────────────────────────
step "/install signed out (portal-uat)"
api - uat GET /install
expect "IS-A11 · signed out: Sign in and Register your organisation are offered" eval 'st 200 && is o.view signed-out && is "o.actions.join()" sign-in,register'
expect "IS-A11 · signed out: \"gov is open source (MIT)\" links the public repository" \
  eval 'is o.openSource.text "gov is open source (MIT)" && is o.openSource.url https://github.com/svayam-opensource/governed-agentic-dev-framework'
expect "IS-A11 · signed out: no command, version or scripts host in the page" lacks install.sh install.ps1 "$(dn gov uat)" versioned '"pkg"' curl winget
expect "IS-A14 · sign-in started from /install returns to /install" is o.signIn.returnTo /install

# ── 3. registration (IS-A1, IS-A5, IS-A4) ─────────────────────────────────────────────────────────────────────────
step "e2e admin registers svayam-e2e in uat (a GitHub org admin)"
api admin uat POST /registrations "{\"githubOrg\":\"svayam-e2e\",\"displayName\":\"$ORG_NAME\"}"
REG="$(jid "$BD" id)"
expect "IS-A1 · the registration is pending until the GitHub org is verified, through uat's App (gov-uat)" eval 'st 201 && is o.state pending && is o.app gov-uat'
if [ "$MODE" = live ]; then : # TODO(IS-E6 live half): the org admin installs gov-uat on svayam-e2e (S-h); poll the registration
else api admin uat POST "/registrations/$REG/verify"; fi
api admin uat GET "/registrations/$REG"
expect "IS-A1 · verified in one sitting by the admin: the registration is active" is o.state active
api admin uat GET /account
ACCT="$(jid "$BD" id)"
expect "IS-A1 · the account is active on the Free plan of governance, the registrant ACCOUNT_ADMIN, no Svayam step" \
  eval 'st 200 && is o.status active && is o.plan free && is o.product governance && is o.role ACCOUNT_ADMIN'
expect "IS-A5 · the account's GitHub org link is a numeric id, shown read-only" eval 'is "/^[0-9]+$/.test(String(o.githubOrgId))" true && is o.githubOrgLinked read-only'

step "Install gov, as the admin (IS-A12, IS-A13)"
api admin uat GET /install
GH="$(dn gov uat)"
expect "IS-A12 · /install shows uat's scripts host, ref, package and pins — equal to its /versions.json" \
  eval 'is o.view install && is o.scriptsHost "$(j "$VJ" o.host)" && is o.ref "$(j "$VJ" o.ref)" && is o.pkg "$(j "$VJ" o.pkg)" && is "JSON.stringify(o.versioned)" "$(j "$VJ" "JSON.stringify(o.versioned)")"'
expect "IS-A13 · macOS/Linux: fetch to a file, then run — never piped" is o.commands.unix "curl -fsSL https://$GH/install.sh -o install.sh && bash install.sh"
expect "IS-A13 · the CI form pipes with GOV_YES=1; Windows is winget; install.ps1 is linked" \
  eval 'is o.commands.ci "curl -fsSL https://$GH/install.sh | GOV_YES=1 bash" && is o.commands.windows "winget install Svayam.Gov" && is o.commands.ps1 "https://$GH/install.ps1"'
expect "IS-A13 · every command's URL is one the scripts-host step fetched with no login (200, no redirect)" true

step "svayam-e2e registered again in uat (IS-A4)"
api admin uat POST /registrations "{\"githubOrg\":\"svayam-e2e\",\"displayName\":\"Another $RUN_ID\"}"
expect "IS-A4 · refused: \"already registered\", and Request to join offered" eval 'st 409 && is o.error already-registered && is o.offer request-to-join'
expect "IS-A4 · the refusal names neither the account nor its admins" lacks "$ORG_NAME" "\"$ACCT\"" e2e-admin admin@e2e.test

if stub_only "IS-A2/IS-A3 need a second sandbox org and a test clock"; then
  step "A registrant who is not a GitHub org admin (IS-A2), and one left 7 days (IS-A3)"
  api registrant uat POST /registrations '{"githubOrg":"svayam-e2e-pending","displayName":"Pending Org"}'
  REG2="$(jid "$BD" id)"
  expect "IS-A2 · pending, with a link to send to a GitHub org admin" eval 'st 201 && is o.state pending && is o.canVerify false && has /register/verify/'
  api registrant uat GET /install
  expect "IS-A2 · before verification /install shows the signed-out view" is o.view signed-out
  api admin uat POST "/registrations/$REG2/verify"
  api registrant uat GET /account
  expect "IS-A2 · an org admin verifies from the link; only then does the account exist, the registrant its admin" eval 'st 200 && is o.role ACCOUNT_ADMIN'
  api registrant prod POST /registrations '{"githubOrg":"svayam-e2e-pending","displayName":"Pending Org"}'
  REG3="$(jid "$BD" id)"
  x_clock 8
  api registrant prod GET "/registrations/$REG3"
  expect "IS-A3 · a registration not verified within 7 days expires" is o.state expired
  api registrant prod POST /registrations '{"githubOrg":"svayam-e2e-pending","displayName":"Pending Org"}'
  expect "IS-A3 · restarting works" eval 'st 201 && is o.state pending'
fi

# ── 4. invitations (IS-A6, IS-A7) ─────────────────────────────────────────────────────────────────────────────────
step "Members → invite B by email (IS-A6)"
api admin uat POST /invitations '{"email":"invitee@e2e.test"}'
INV_B="$(jid "$BD" id)"
expect "IS-A6 · the admin invites by email; IAM sends the email (the portal sends nothing)" eval 'st 201 && is o.emailed true'
if stub_only "the outbox is the stub's"; then
  api - - GET /_stub/outbox
  expect "IS-A6 · the invitation email went to invitee@e2e.test" is "o.some(m=>m.kind==='invitation'&&m.to==='invitee@e2e.test')" true
fi
api email-invitee uat GET /install
expect "IS-A6 · before accepting, B has no Install gov" is o.view signed-out
api email-invitee uat POST "/invitations/$INV_B/accept"
expect "IS-A6 · B accepts within 7 days and becomes a member" eval 'st 200 && is o.state accepted'
api email-invitee uat GET /install
expect "IS-A6 · B sees Install gov with uat's versions" eval 'is o.view install && is o.scriptsHost "$GH"'

api admin uat POST /invitations '{"email":"outsider@e2e.test"}'; INV_R="$(jid "$BD" id)"
api admin uat DELETE "/invitations/$INV_R"
api outsider uat POST "/invitations/$INV_R/accept"
expect "IS-A6 · a revoked invitation is refused with a plain reason" eval 'st 410 && is o.error revoked && has withdrawn'
if stub_only "expiry needs the stub's test clock"; then
  api admin uat POST /invitations '{"email":"impostor@e2e.test"}'; INV_X="$(jid "$BD" id)"
  x_clock 8
  api impostor uat POST "/invitations/$INV_X/accept"
  expect "IS-A6 · an expired invitation is refused with a plain reason" eval 'st 410 && is o.error expired && has expired'
fi

step "Members → invite D by GitHub login (IS-A7)"
api admin uat POST /invitations '{"githubLogin":"e2e-contractor"}'
INV_D="$(jid "$BD" id)"
expect "IS-A7 · held against GitHub's numeric user id; no email; a copyable link" eval 'st 201 && is o.kind github && is "Number.isInteger(o.ghId)" true && is o.emailed false && has "invitation="'
api impostor uat POST "/invitations/$INV_D/accept"
expect "IS-A7 · a person whose verified login differs cannot accept it" eval 'st 403 && is o.error login-mismatch'
api gh-invitee uat GET /install
expect "IS-A7 · D, not yet linked, is first asked to link a GitHub login" is o.offer link-github
D_LOGIN=e2e-contractor
if stub_only "a GitHub rename is the stub's"; then
  api - - POST /_stub/github-rename '{"from":"e2e-contractor","to":"e2e-contractor-renamed"}'; D_LOGIN=e2e-contractor-renamed
fi
api gh-invitee - POST /api/me/github-link "{\"login\":\"$D_LOGIN\"}"
api gh-invitee uat GET /install
expect "IS-A7 · once linked (after a rename of the login), D sees the invitation with Accept" eval 'is o.offer accept && is "o.invitations[0].id" "$INV_D"'
api gh-invitee uat POST "/invitations/$INV_D/accept"
api gh-invitee uat GET /install
expect "IS-A7 · D accepts and sees Install gov — the rename did not break the invitation" is o.view install

# ── 5. join requests (IS-A8, IS-A9) ──────────────────────────────────────────────────────────────────────────────
step "C, a svayam-e2e member who was not invited (IS-A8)"
api org-member uat GET /install
expect "IS-A8 · C has no Install gov; with no linked login C is offered \"Link your GitHub login\"" eval 'is o.view signed-out && is o.offer link-github'
api org-member uat GET /account
expect "IS-A8 · C has no access to the account pages" st 404
api org-member - POST /api/me/github-link '{"login":"e2e-member"}'
api org-member uat GET /join-requests/eligibility
expect "IS-A8 · linked, C may ask to join — and is not told which account" eval 'is o.eligible true && lacks "$ORG_NAME" e2e-admin admin@e2e.test'
api org-member uat GET /install
expect "IS-A8 · /install offers Request to join" is o.offer request-to-join
api outsider uat GET /join-requests/eligibility
expect "IS-A8 · a person outside the GitHub org is not offered it" is o.eligible false
api outsider uat GET /install
expect "IS-A8 · …and is told to ask an admin or register" is o.offer ask-admin-or-register

step "C → Request to join; admins decline, then approve (IS-A9)"
api org-member uat POST /join-requests
JR1="$(jid "$BD" id)"
expect "IS-A9 · \"Request sent\", naming no account and no admin" eval 'st 201 && has "Request sent" && lacks "$ORG_NAME" e2e-admin admin@e2e.test'
api org-member uat POST /join-requests
expect "IS-A9 · one open request per person per account" eval 'st 409 && is o.error already-open'
if stub_only "the outbox is the stub's"; then
  api - - GET /_stub/outbox
  expect "IS-A9 · the account's admins are emailed" is "o.some(m=>m.kind==='join-request'&&m.to==='admin@e2e.test')" true
fi
api admin uat GET /join-requests
expect "IS-A9 · the request appears on the Members page" is "o.some(r=>r.id==='$JR1'&&r.state==='pending')" true
api admin uat POST "/join-requests/$JR1/decline"
api org-member uat GET /join-requests/mine
expect "IS-A9 · declined: \"Your request was not approved\", naming nothing" eval 'is o.state declined && is o.message "Your request was not approved" && lacks "$ORG_NAME" e2e-admin'
api org-member uat POST /join-requests
JR2="$(jid "$BD" id)"
api admin uat POST "/join-requests/$JR2/approve"
api org-member uat GET /install
expect "IS-A9 · approved: C sees Install gov" is o.view install
api org-member uat GET /account
expect "IS-A9 · …as a member, never an admin" is o.role MEMBER

# ── 6. removal and the last admin (IS-A10) ───────────────────────────────────────────────────────────────────────
step "Remove a member; keep the last admin (IS-A10)"
api admin uat DELETE /members/e2e-member
api org-member uat GET /install
expect "IS-A10 · a removed member's next page load is the signed-out view" eval 'is o.view signed-out && lacks scriptsHost'
api admin uat PUT /members/e2e-admin/role '{"admin":false}'
expect "IS-A10 · the last admin cannot be demoted" eval 'st 409 && is o.error last-admin'
api admin uat DELETE /members/e2e-admin
expect "IS-A10 · …or removed" eval 'st 409 && is o.error last-admin'

# ── 7. suspension (IS-A19) ────────────────────────────────────────────────────────────────────────────────────────
step "Platform admin suspends the account (IS-A19)"
api platform-admin uat POST "/admin/accounts/$ACCT/status" '{"status":"suspended"}'
expect "IS-A19 · a reason is required" st 400
api platform-admin uat POST "/admin/accounts/$ACCT/status" "{\"status\":\"suspended\",\"reason\":\"e2e $RUN_ID\"}"
expect "IS-A19 · suspended, with the reason and who set it" eval 'st 200 && is o.status suspended && is "o.history.at(-1).by" platform-admin'
api email-invitee uat GET /install
expect "IS-A19 · B sees only the suspended notice — no doors, no command" eval 'is o.view suspended && lacks install.sh curl winget'
api admin uat POST /invitations '{"email":"late@e2e.test"}'
expect "IS-A19 · invitations cannot be sent" eval 'st 423 && is o.error suspended'
api org-member uat POST /join-requests
expect "IS-A19 · join requests cannot be sent" eval 'st 423 && is o.error suspended'
api email-invitee uat POST /lease
expect "IS-A19 · an evidence lease is refused with reason \"suspended\"" eval 'st 403 && is o.reason suspended'
sh_get "$GI_URL" "$GH" /install.sh
expect "IS-A19 · the scripts still answer 200, anonymously" test "$SH_STATUS" = 200
api platform-admin uat POST "/admin/accounts/$ACCT/status" "{\"status\":\"active\",\"reason\":\"e2e $RUN_ID done\"}"
api email-invitee uat GET /install
expect "IS-A19 · reinstating restores Install gov" is o.view install
api email-invitee uat POST /lease
expect "IS-A19 · …and the lease" st 200

# ── 8. environments (IS-A20) ─────────────────────────────────────────────────────────────────────────────────────
step "The uat account does not exist in dev or prod (IS-A20)"
for e in dev prod; do
  api admin "$e" GET /install
  expect "IS-A20 · $e: the same identity signs in and sees no account (no-account view)" eval 'is o.view signed-out && is o.variant no-account'
  api admin "$e" GET /account
  expect "IS-A20 · $e: the uat account cannot be seen" st 404
  api admin "$e" POST /lease
  expect "IS-A20 · $e: …or leased against" eval 'st 403 && is o.reason no-account'
done
if stub_only "the live journey registers only in uat"; then
  api admin dev POST /registrations "{\"githubOrg\":\"svayam-e2e\",\"displayName\":\"$ORG_NAME dev\"}"
  REGD="$(jid "$BD" id)"
  expect "IS-A20 · svayam-e2e can be registered separately in dev (not refused)" eval 'st 201 && is o.app gov-dev'
  api admin dev POST "/registrations/$REGD/verify"
  api admin dev GET /account
  expect "IS-A20 · …as a separate dev account" eval 'st 200 && test "$(j "$BD" o.id)" != "$ACCT"'
fi

# ── 9. versions.json unreachable (IS-A15) ────────────────────────────────────────────────────────────────────────
if stub_only "IS-A15 needs a scripts host that does not answer"; then
  step "versions.json unreachable (IS-A15)"
  api - - POST /_stub/gov-install '{"env":"uat","url":"http://127.0.0.1:9"}'
  api email-invitee uat GET /install
  expect "IS-A15 · the page says install details are unavailable and shows no command" eval 'is o.unavailable true && lacks curl install.sh winget'
  api - - POST /_stub/gov-install "{\"env\":\"uat\",\"url\":\"$GI_URL\"}"
fi
