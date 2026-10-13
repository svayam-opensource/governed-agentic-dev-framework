#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# LIVE JOINER JOURNEY — a SECOND identity joins the adopter's governed org and lands a change in its project
# (PRJ-121 intent 05, Item 4 — task T15; Policy Owner rulings I05.5, Q2, Q5).
#
#   adopter-journey.sh E2E_PHASE=work (bot A)        joiner-journey.sh (bot B — THIS script)
#     governed org repo, project board, code repo ──▶  its own HOME; the same packed gov
#     issue #2 for bot B; bot B granted write on       login = TESTBED_JOINER_LOGIN, and NOT bot A's
#     both repos and the board                          gov setup --join <org>/<gov-repo>     (no terminal)
#     handoff: $E2E_HANDOFF                             gov work --project=<PRJ> --no-launch  (open the project)
#   adopter-journey.sh E2E_PHASE=finish ◀── after ──    gov task #2 → commit → gov merge #2
#     close the project, tear everything down           assert: #2 closed BY bot B, board Status Done
#
# The joiner drives gov through flags only (ruling Q5): a prompt reached here is a defect, so every gov call runs with
# stdin from /dev/null and fails rather than waits. The pty scenarios 40/45/47 stay hermetic.
#
# Required env (live):
#   E2E_HANDOFF        the file the adopter's work phase wrote (E2E_ORG, WS_REPO, CODE_REPO, PROJ_NUM, PROJ_URL, PID,
#                      JOINER_ISSUE_URL, ADOPTER_LOGIN …)
#   GH_TOKEN           bot B's token (TESTBED_JOINER_PAT: classic, repo/project/read:org). Never printed.
#   E2E_JOINER_LOGIN   bot B's login (TESTBED_JOINER_LOGIN); the token must authenticate as exactly this account
#   GOV_TARBALL        the packed gov under test (the same .tgz the adopter journey installed)
# Optional:
#   E2E_JOINER_HOME    bot B's HOME (default: a fresh temp dir) — bot A's ~/.gov, ~/.gitconfig and gh login are not
#                      bot B's, so the joiner never shares them
#   --dry-run (or E2E_DRY_RUN=1)  HERMETIC: prints every gh / git / gov / npm call instead of making it
#                      (test/e2e/joiner-journey-dry.test.ts)
set -euo pipefail

DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;; esac; done
[ "${E2E_DRY_RUN:-0}" = "1" ] && DRY=1

if [ "$DRY" = 1 ]; then
  # A synthetic handoff: the names a real one carries, so the walk reads the same.
  E2E_ORG="${E2E_ORG:-svayam-e2e}"; WS_REPO="gov-e2e-dry-gov"; CODE_REPO="gov-e2e-dry-svc"; PROJ_NUM=0
  PID="PRJ-0-gov-e2e-dry"
  JOINER_ISSUE_URL="https://github.com/$E2E_ORG/$CODE_REPO/issues/2"; ADOPTER_LOGIN="adopter-bot"
  E2E_JOINER_LOGIN="${E2E_JOINER_LOGIN:-joiner-bot}"; GOV_TARBALL="${GOV_TARBALL:-/dry/gov.tgz}"
else
  : "${E2E_HANDOFF:?set E2E_HANDOFF (written by adopter-journey.sh E2E_PHASE=work)}"
  : "${GH_TOKEN:?set GH_TOKEN (the joiner token, TESTBED_JOINER_PAT)}"
  : "${E2E_JOINER_LOGIN:?set E2E_JOINER_LOGIN (TESTBED_JOINER_LOGIN)}"
  E2E_JOINER_LOGIN="$(printf '%s' "$E2E_JOINER_LOGIN" | tr -d '[:space:]')"   # a pasted secret's trailing newline
  : "${GOV_TARBALL:?set GOV_TARBALL}"
  [ -f "$E2E_HANDOFF" ] || { echo "no handoff at $E2E_HANDOFF — the adopter's work phase did not run" >&2; exit 1; }
  # shellcheck disable=SC1090
  . "$E2E_HANDOFF"
  for v in E2E_ORG WS_REPO CODE_REPO PROJ_NUM PID JOINER_ISSUE_URL ADOPTER_LOGIN; do
    [ -n "${!v:-}" ] || { echo "the handoff has no $v — the adopter's work phase stopped before the joiner's share (see its log)" >&2; exit 1; }
  done
fi

PASS=0; FAIL=0; LOGIN=""; JOINER_ID=""
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; FAIL=$((FAIL+1)); if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::joiner journey: $*"; fi; exit 1; }
on_err() { local rc=$? line=$1 cmd=$2; [ "$rc" -eq 0 ] && return 0
  printf '  \033[31m✗ line %s exited %s: %s\033[0m\n' "$line" "$rc" "$cmd"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::joiner journey: line $line exited $rc: $cmd"; fi; return 0; }
trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR
# In a dry run every outside call is printed and its stand-in answer returned; live, it runs.
#   xo <dry-answer> cmd…     run, stdout captured by the caller
# The dry-run trace goes to fd 3 (the terminal's stderr), so a caller's 2>/dev/null or 2>&1 never hides or captures it.
exec 3>&2
x()  { if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*" >&3; return 0; fi; "$@"; }
xo() { local d="$1"; shift; if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*" >&3; printf '%s\n' "$d"; return 0; fi; "$@"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) printf '%s\n' "$1" | tail -12 | sed 's/^/    /'; die "$3 — expected: $2" ;; esac; }

JHOME="${E2E_JOINER_HOME:-}"
cleanup() {
  local rc=$?
  trap - ERR
  # The joiner creates nothing on GitHub (the adopter's finish phase deletes the repos and the board); only its HOME.
  if [ "$DRY" != 1 ] && [ -z "${E2E_JOINER_HOME:-}" ] && [ -n "$JHOME" ]; then rm -rf "$JHOME"; fi
  printf '\n\033[1m═══ joiner-journey%s: %d passed, %s%s ═══\033[0m\n' "$([ "$DRY" = 1 ] && echo ' (DRY RUN)')" "$PASS" \
    "$([ "$rc" -eq 0 ] && echo ok || echo "FAILED (exit $rc)")" "${LOGIN:+ — as $LOGIN${JOINER_ID:+ (account id $JOINER_ID)}}"
  exit "$rc"
}
trap cleanup EXIT

# ── 0. A machine of bot B's own: HOME, gov, git identity ────────────────────────────────────────────────────────
step "Bootstrap — bot B's own HOME, the packed gov"
if [ "$DRY" = 1 ]; then JHOME="${JHOME:-/dry/joiner-home}"; else JHOME="${JHOME:-$(mktemp -d)}"; mkdir -p "$JHOME"; export HOME="$JHOME"; fi
export NPM_CONFIG_PREFIX="$JHOME/.npm-global"; export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
[ "$DRY" = 1 ] || mkdir -p "$NPM_CONFIG_PREFIX/bin"
x npm i -g "$GOV_TARBALL" >/dev/null 2>&1 || die "npm i -g the packed gov failed"
[ "$DRY" = 1 ] || command -v gov >/dev/null || die "gov not on PATH after install"
ok "gov installed in bot B's HOME ($(xo '?' gov --version 2>/dev/null || echo '?'))"

# ── 1. WHO IS THIS? A second identity, or the test proves nothing ───────────────────────────────────────────────
step "Identity — the joiner is a second account"
LOGIN="$(xo "$E2E_JOINER_LOGIN" gh api user --jq .login 2>/dev/null)" || die "the joiner token does not authenticate (TESTBED_JOINER_PAT)"
[ -n "$LOGIN" ] || die "the joiner token does not authenticate (TESTBED_JOINER_PAT)"
[ "$LOGIN" = "$E2E_JOINER_LOGIN" ] && ok "joiner token authenticates as $LOGIN (= TESTBED_JOINER_LOGIN)" \
  || die "the joiner token authenticates as '$LOGIN', not TESTBED_JOINER_LOGIN '$E2E_JOINER_LOGIN'"
if [ "$LOGIN" = "$ADOPTER_LOGIN" ]; then
  die "the joiner and the adopter are the SAME account ($LOGIN) — TESTBED_JOINER_PAT must belong to a second svayam-e2e member, or this journey proves nothing"
fi
# The login is a repository SECRET, so Actions masks it (***) in this log. The numeric account ids are not secrets, and
# they are what proves two different accounts to someone reading the log.
JOINER_ID="$(xo 2 gh api user --jq .id 2>/dev/null || true)"; ADOPTER_ID="$(xo 1 gh api "users/$ADOPTER_LOGIN" --jq .id 2>/dev/null || true)"
[ -n "$JOINER_ID" ] && [ "$JOINER_ID" != "$ADOPTER_ID" ] || die "the joiner's account id (${JOINER_ID:-?}) is not distinct from the adopter's (${ADOPTER_ID:-?})"
ok "and is not the adopter ($ADOPTER_LOGIN): account id $JOINER_ID ≠ $ADOPTER_ID"
x git config --global user.email "${LOGIN}@users.noreply.github.com"
x git config --global user.name "$LOGIN (joiner e2e)"
x git config --global init.defaultBranch main
x gh auth setup-git >/dev/null 2>&1 || true
ok "git identity + credential helper for $LOGIN"

# ── 2. JOIN the org — the machine path (ruling Q5) ───────────────────────────────────────────────────────────────
step "gov setup --join $E2E_ORG/$WS_REPO"
JOIN_OUT="$(xo "Joining $E2E_ORG." gov setup --join "$E2E_ORG/$WS_REPO" </dev/null 2>&1)" || { printf '%s\n' "$JOIN_OUT" | tail -12; die "gov setup --join failed"; }
has "$JOIN_OUT" "Joining $E2E_ORG." "joined the adopter's governed org, asking nothing"
has "$(xo "$E2E_ORG" gov org list 2>&1)" "$E2E_ORG" "the org is registered on bot B's machine"

# ── 3. The issue is on the board, as bot B sees it ───────────────────────────────────────────────────────────────
step "Issue #${JOINER_ISSUE_URL##*/} on board #$PROJ_NUM, read with bot B's token"
board_status() { gh api graphql -f u="$JOINER_ISSUE_URL" -f query='query($u:URI!){resource(url:$u){... on Issue{projectItems(first:20){nodes{project{number} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}' \
  --jq ".data.resource.projectItems.nodes[]|select(.project.number==$PROJ_NUM)|(.fieldValueByName.name // \"(no status)\")"; }
if [ "$DRY" = 1 ]; then printf '  + poll the issue'"'"'s projectItems until board #%s is listed (≤ 3 min)\n' "$PROJ_NUM" >&3; seen=1
else
  seen=0
  for _ in $(seq 1 60); do
    [ -n "$(board_status 2>/dev/null || true)" ] && { seen=1; break; }
    sleep 3
  done
fi
[ "$seen" = 1 ] && ok "bot B can read issue #${JOINER_ISSUE_URL##*/} on board #$PROJ_NUM" \
  || die "bot B cannot see issue #${JOINER_ISSUE_URL##*/} on board #$PROJ_NUM after 3 min — the board grant did not take, or the token lacks the project scope"
assert_status() { local s
  if [ "$DRY" = 1 ]; then printf '  + read the board Status of #%s\n' "${JOINER_ISSUE_URL##*/}" >&3; ok "board Status would be '$1' after $2"; return 0; fi
  s="$(board_status 2>&1)" || s="(read failed: $s)"
  [ "$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" ] && ok "board Status is '$s' after $2" \
    || { printf '%s\n' "$3" | grep 'board:' | sed 's/^/    /'; die "board Status after $2 is '${s:-none}', expected '$1'"; }; }

# ── 4. OPEN the adopter's project — gov work, no launch ──────────────────────────────────────────────────────────
step "gov work --project=$PID --no-launch"
WORK_OUT="$(xo "  ✓ '$PID' is ready at:  /dry/projects/$PID" gov work --project="$PID" --no-launch </dev/null 2>&1)" \
  || { printf '%s\n' "$WORK_OUT" | tail -12; die "gov work --project=$PID --no-launch failed"; }
has "$WORK_OUT" "is ready at:" "the project is open on bot B's machine"
PWR="$(printf '%s\n' "$WORK_OUT" | sed -n "s/^  ✓ '[^']*' is ready at:  //p" | tail -1)"
[ -n "$PWR" ] || die "gov work did not say where the project is"
if [ "$DRY" != 1 ]; then
  { [ -e "$PWR/$WS_REPO/.git" ] && [ -e "$PWR/$CODE_REPO/.git" ]; } || die "the project at $PWR lacks $WS_REPO or $CODE_REPO"
fi
ok "joined $PID at $PWR — gov repo + $CODE_REPO on the project branch"

# ── 5. task → commit → merge, as bot B ───────────────────────────────────────────────────────────────────────────
step "gov task #${JOINER_ISSUE_URL##*/} (as $LOGIN)"
[ "$DRY" = 1 ] || cd "$PWR/$WS_REPO"
TASK_OUT="$(xo "opened ISSUE-${JOINER_ISSUE_URL##*/}" gov task "$JOINER_ISSUE_URL" </dev/null 2>&1)" || { printf '%s\n' "$TASK_OUT" | tail -12; die "gov task failed"; }
has "$TASK_OUT" "ISSUE-" "task opened a sub-branch"
assert_status "In progress" "gov task" "$TASK_OUT"

if [ "$DRY" = 1 ]; then printf '  + commit E2E-joiner.md on the task sub-branch in %s/%s\n' "$PWR" "$CODE_REPO" >&3
else
  echo "joiner change by $LOGIN" >> "$PWR/$CODE_REPO/E2E-joiner.md"
  ( cd "$PWR/$CODE_REPO" && git add -- E2E-joiner.md && git commit -qm "e2e: the joiner's change (closes #${JOINER_ISSUE_URL##*/})" )
fi
ok "committed the joiner's work file on the task sub-branch"

step "gov merge #${JOINER_ISSUE_URL##*/} (as $LOGIN)"
MERGE_OUT="$(xo "merged" gov merge "$JOINER_ISSUE_URL" </dev/null 2>&1)" || { printf '%s\n' "$MERGE_OUT" | tail -12; die "gov merge failed"; }
[ "$(xo CLOSED gh issue view "$JOINER_ISSUE_URL" --json state --jq .state 2>/dev/null)" = "CLOSED" ] && ok "merge closed issue #${JOINER_ISSUE_URL##*/}" \
  || die "issue #${JOINER_ISSUE_URL##*/} not closed after gov merge"
CLOSER="$(xo "$LOGIN" gh api "repos/$E2E_ORG/$CODE_REPO/issues/${JOINER_ISSUE_URL##*/}" --jq '.closed_by.login // ""' 2>/dev/null || true)"
[ "$CLOSER" = "$LOGIN" ] && ok "closed by $LOGIN — the second identity, not the adopter" \
  || die "issue #${JOINER_ISSUE_URL##*/} was closed by '${CLOSER:-unknown}', not the joiner $LOGIN"
assert_status "Done" "gov merge" "$MERGE_OUT"

[ "$FAIL" -eq 0 ]   # the banner is printed by the EXIT trap
