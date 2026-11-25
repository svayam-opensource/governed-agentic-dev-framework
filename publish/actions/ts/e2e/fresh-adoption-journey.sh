#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# THE FRESH-ADOPTION JOURNEY, TIMED (Policy Owner rulings Q62 A and Q64 A, 2026-11-24).
#
# The home page promises: "Watch gov stop your first change until someone else approves it, in under 10 minutes."
# This measures the machine part of that path on real GitHub, in an org kept UNADOPTED for it (FRESH_ADOPT_ORG,
# svayam-e2e-3 — never Svayamtech, never svayam-e2e: an org is adopted once, and svayam-e2e is adopted many times over).
#
#   preflight   the org is unadopted: no repository with org-config.yaml at HEAD, no open project — else fail, naming them
#   install     npm i -g the packed gov into a HOME of its own                      (reported, not counted)
#   setup       `gov` on a machine that has never run it, in a pty, answering the first-run interview as an adopter
#               (e2e/fresh-adoption.conv): the governance repo, the setup commit with the approval check, and the
#               practice project "Make the policy ours" — board, anchor (anchor, practice), task, project branch —
#               made by setup itself, without a question
#   practice    the agent's part, scripted as the task issue tells the agent: gov work → gov task → the two title-page
#               edits → gov rules propose → commit → gov merge → gov close, which opens the pull request
#   stop        PR open → approver-check reports failure on it: gov has stopped the change
#   total       setup + practice + stop, against E2E_BUDGET_SECS (default 600): over budget fails the run
#   teardown    every repository and project it created, so the org is unadopted again (also `… teardown`, always())
#
# ONE TEST CONCESSION, said where it is made: the sandbox org's Actions spending limit is $0 and the repository setup
# creates is private, so a workflow asking for GitHub's `ubuntu-latest` is never given a runner. The scripted edit
# also points the practice PR's workflows at the sandbox's runner (E2E_RUNS_ON). A pull_request run uses the
# workflow as the PR has it, so the check that stops the PR is the shipped one, on another machine. An adopter on
# GitHub's hosted runners makes no such edit.
#
# Required env:
#   E2E_ORG       the unadopted sandbox org (FRESH_ADOPT_ORG)
#   GH_TOKEN      classic token of an OWNER of E2E_ORG: repo, workflow, project, read:org, delete_repo (FRESH_ADOPT_PAT)
#   GOV_TARBALL   the packed gov under test (npm pack)
# Optional:
#   E2E_BUDGET_SECS        the promise, in seconds (default 600)
#   E2E_STOP_DEADLINE_SECS how long to wait for the approval check (default 900)
#   E2E_RUNS_ON            the runner the practice PR's workflows ask for (default [self-hosted, svayam-e2e-3])
#   E2E_LEDGER             file recording what was created, for the `teardown` mode (default: in the run's HOME)
#   E2E_KEEP=1             leave everything for inspection
#
#   bash e2e/fresh-adoption-journey.sh            the journey
#   bash e2e/fresh-adoption-journey.sh teardown   delete what E2E_LEDGER lists (the workflow's always() step)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=token-scopes.sh
. "$HERE/token-scopes.sh"
# shellcheck source=fresh-timing.sh
. "$HERE/fresh-timing.sh"

MODE="${1:-run}"
case "$MODE" in run|teardown) ;; *) echo "usage: fresh-adoption-journey.sh [run|teardown]" >&2; exit 2 ;; esac
: "${E2E_ORG:?set E2E_ORG (FRESH_ADOPT_ORG)}"; : "${GH_TOKEN:?set GH_TOKEN (FRESH_ADOPT_PAT)}"
BUDGET="${E2E_BUDGET_SECS:-600}"
STOP_DEADLINE="${E2E_STOP_DEADLINE_SECS:-900}"
RUNS_ON="${E2E_RUNS_ON:-[self-hosted, svayam-e2e-3]}"
PRACTICE_TITLE="Make the policy ours"
# WHAT THE SANDBOX RUNNER MUST HAVE ON ITS SERVICE'S PATH (E2E_RUNS_ON). The journey runs on GitHub's runner and cannot
# probe that machine before the PR, so a missing one is named afterwards, from the check's own log (exit 127):
#   approver-check.yml  bash awk sed tr grep sort gh      (gh --jq reads the reviews; the 2026-11-24 exit 127 was a
#                                                          missing jq, fixed by F153 A: the check no longer calls jq)
#   gov-checks.yml      git (checkout) · node + npm (setup-node, npm install -g the gov CLI) · gh (gov check run)
RUNNER_TOOLS="bash awk sed tr grep sort gh git node npm"
TASK_TITLE="Put our name on the policy"

PASS=0
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
warn() { printf '  \033[33m! %s\033[0m\n' "$*"; if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::fresh-adoption journey: $*"; fi; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::fresh-adoption journey: $*"; fi; exit 1; }
on_err() { local rc=$? line=$1 cmd=$2; [ "$rc" -eq 0 ] && return 0
  printf '  \033[31m✗ line %s exited %s: %s\033[0m\n' "$line" "$rc" "$cmd"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::fresh-adoption journey: line $line exited $rc: $cmd"; fi; return 0; }
trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR
now() { date +%s; }

# ── what this run created, one shell-quoted line per fact, appended AS it becomes true ──────────────────────────────
LEDGER="${E2E_LEDGER:-}"
ledger() { [ -n "$LEDGER" ] || return 0; local k; for k in "$@"; do printf '%s=%q\n' "$k" "${!k}" >>"$LEDGER"; done; }

# Every repository named in the ledger, and every project in the org created since the run began (the preflight saw
# none open; a new one is this run's — setup's practice board). Reports exactly what it could not delete.
teardown() {
  local rc=$?
  trap - ERR
  if [ "${E2E_KEEP:-0}" = 1 ]; then echo "E2E_KEEP=1 — leaving ${REPO:-?} and the board"; else
    step "Teardown — return $E2E_ORG to unadopted"
    local leaked=() err n
    if [ -n "${REPO:-}" ]; then
      if ! gh api "repos/$E2E_ORG/$REPO" --silent 2>/dev/null; then echo "  $E2E_ORG/$REPO does not exist (nothing to delete)"
      elif err="$(gh repo delete "$E2E_ORG/$REPO" --yes 2>&1 >/dev/null)"; then echo "  deleted $E2E_ORG/$REPO"
      else leaked+=("$E2E_ORG/$REPO"); echo "  ! could not delete $E2E_ORG/$REPO: ${err%%$'\n'*}"; fi
    fi
    if [ -n "${START_ISO:-}" ]; then
      for n in $(org_projects | awk -F'\t' -v s="$START_ISO" '$3 >= s { print $1 }'); do
        gh project delete "$n" --owner "$E2E_ORG" >/dev/null 2>&1 && echo "  deleted project #$n" || leaked+=("project #$n")
      done
    fi
    leak_report "${leaked[@]:+${leaked[@]}}"
    # Recorded, so the workflow's always() teardown step does not try again; a leak leaves it for that step to retry.
    if [ "${#leaked[@]}" -eq 0 ]; then TORN_DOWN=1; ledger TORN_DOWN; fi
    if [ -n "${RUN_HOME:-}" ] && [ -d "$RUN_HOME" ] && [ "$MODE" = run ]; then rm -rf "$RUN_HOME"; fi
  fi
  printf '\n\033[1m═══ fresh-adoption-journey%s: %d passed, %s ═══\033[0m\n' "$([ "$MODE" = teardown ] && echo ' (teardown)')" "$PASS" \
    "$([ "$rc" -eq 0 ] && echo ok || echo "FAILED (exit $rc)")"
  exit "$rc"
}

# number<TAB>title<TAB>createdAt<TAB>closed, every project the org owns.
org_projects() {
  gh api graphql -f o="$E2E_ORG" -f query='query($o:String!){organization(login:$o){projectsV2(first:100){nodes{number title createdAt closed}}}}' \
    --jq '.data.organization.projectsV2.nodes[] | "\(.number)\t\(.title)\t\(.createdAt)\t\(.closed)"'
}

if [ "$MODE" = teardown ]; then
  [ -n "$LEDGER" ] && [ -f "$LEDGER" ] || { echo "  no ledger at ${LEDGER:-<unset>} — the journey created nothing to tear down"; exit 0; }
  # shellcheck disable=SC1090
  . "$LEDGER"
  [ "${TORN_DOWN:-0}" = 1 ] && { echo "  the journey already tore down what it created"; exit 0; }
  trap teardown EXIT
  exit 0
fi

# ── preflight: the org is UNADOPTED, or nothing here measures a fresh adoption ──────────────────────────────────────
step "Preflight — is $E2E_ORG unadopted?"
LOGIN="$(gh api user --jq .login 2>/dev/null)" || die "GH_TOKEN does not authenticate (FRESH_ADOPT_PAT)"
ok "authenticated as $LOGIN"
# THE SCOPES, BEFORE ANY CALL THAT NEEDS THEM. The first dispatch (2026-11-24) died on the projects query with a bare
# "line … exited 1": the token had no `project` scope, and GitHub said so only on stderr. Named here instead.
HEADERS="$(gh api -i user 2>/dev/null || true)"
MISSING="$(missing_scopes "$HEADERS")"
[ -z "$MISSING" ] && ok "the token has the scopes it needs: ${FRESH_SCOPES[*]}" \
  || die "FRESH_ADOPT_PAT lacks the scope(s):$MISSING (it has: $(token_scopes "$HEADERS" | tr '\n' ' ')) — a classic token needs ${FRESH_SCOPES[*]}"
ROLE="$(gh api "orgs/$E2E_ORG/memberships/$LOGIN" --jq '"\(.state) \(.role)"' 2>/dev/null)" || ROLE="none"
[ "$ROLE" = "active admin" ] && ok "$LOGIN is an owner of $E2E_ORG" \
  || die "$LOGIN must be an active OWNER of $E2E_ORG to adopt it (membership: $ROLE) — accept the org invitation as that account"
# THE PROBE GOV ITSELF RUNS (setup/create.ts, findExistingGovernanceRepo): any repository with org-config.yaml at HEAD.
PROBE="$(gh api graphql -f org="$E2E_ORG" -f query='query($org:String!){organization(login:$org){repositories(first:100){pageInfo{hasNextPage} nodes{nameWithOwner object(expression:"HEAD:org-config.yaml"){__typename}}}}}' \
  --jq '(.data.organization.repositories.nodes[] | select(.object != null) | .nameWithOwner), (if .data.organization.repositories.pageInfo.hasNextPage then "…and more than 100 repositories (gov would refuse: it cannot see them all)" else empty end)')" \
  || die "could not read $E2E_ORG's repositories"
[ -z "$PROBE" ] || die "$E2E_ORG is already adopted — gov would make this run a JOINER. Leftovers: $(printf '%s' "$PROBE" | tr '\n' ' ')— delete them (a failed teardown?) before the next run"
OPEN_BOARDS="$(org_projects | awk -F'\t' '$4 == "false" { printf "#%s \"%s\"  ", $1, $2 }')"
[ -z "$OPEN_BOARDS" ] || die "$E2E_ORG has open projects: $OPEN_BOARDS— setup would REUSE an open \"$PRACTICE_TITLE\"; delete them before the next run"
ok "no governance repository and no open project in $E2E_ORG"
scope_check "$(gh api -i user 2>/dev/null || true)" "$E2E_ORG/<this run's governance repo>"
[ "$CAN_DELETE" != no ] || die "the token lacks delete_repo — this run would leave $E2E_ORG adopted, and the next one could not start"

RUN_ID="${E2E_RUN_ID:-$(date +%s)}"
# FIXED, NOT PER RUN (F158): setup names every new organization's governance repository gov_repo and no longer asks.
# The preflight above refuses an org that is already adopted, and the teardown deletes it, so one name is enough.
REPO="gov_repo"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_HOME="$(mktemp -d)"
if [ -z "$LEDGER" ]; then LEDGER="$RUN_HOME/ledger.env"; fi
: >"$LEDGER"
ledger REPO START_ISO
trap 'exit 143' TERM INT          # a cancelled job still runs the EXIT trap — and so the teardown
trap teardown EXIT

# ── install (reported, not counted) ─────────────────────────────────────────────────────────────────────────────────
step "Install — the packed gov, into a machine that has never run it"
T_INSTALL0=$(now)
: "${GOV_TARBALL:?set GOV_TARBALL}"
command -v expect >/dev/null || die "the first-run interview is driven in a pty: install expect (apt-get install expect)"
export HOME="$RUN_HOME/home"; mkdir -p "$HOME"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"; export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"; mkdir -p "$NPM_CONFIG_PREFIX/bin"
npm i -g "$GOV_TARBALL" >/dev/null 2>&1 || die "npm i -g $GOV_TARBALL failed"
command -v gov >/dev/null || die "gov not on PATH after install"
# The numbered form of every choice (F158): the conversation types numbers, so it must meet prompts and not the arrow
# picker, on a laptop as on a CI runner (where `CI` would turn the arrows off anyway).
export GOV_PLAIN_PROMPTS=1
[ ! -e "$HOME/.gov" ] || die "this HOME already has ~/.gov — not a first run"
EMAIL="${LOGIN}@users.noreply.github.com"
git config --global user.email "$EMAIL"; git config --global user.name "$LOGIN (fresh adoption e2e)"
git config --global init.defaultBranch main
gh auth setup-git >/dev/null 2>&1 || true
T_INSTALL=$(( $(now) - T_INSTALL0 ))
ok "gov $(gov --version 2>/dev/null || echo '?') installed, git identity set (${T_INSTALL}s, not counted)"

# ── setup: the first-run interview, as an adopter ──────────────────────────────────────────────────────────────────
step "Setup — \`gov\`, the first-run interview (adopter, soft, no agents), in a pty"
CONV="$RUN_HOME/fresh-adoption.conv"; TRANSCRIPT="$RUN_HOME/setup.transcript"
sed -e "s|@ORG@|$E2E_ORG|" -e "s|@SLUG@|FRESH|" "$HERE/fresh-adoption.conv" >"$CONV"
T0=$(now)
DRIVE_RC=0; expect "$HERE/pty/drive.exp" "$TRANSCRIPT" "$CONV" -- gov 2>"$RUN_HOME/drive.err" || DRIVE_RC=$?
T1=$(now)
PLAIN="$RUN_HOME/setup.txt"; perl -pe 's/\e\[[0-9;]*[a-zA-Z]//g; s/\r//g' "$TRANSCRIPT" >"$PLAIN"
# The transcript outlives the run's HOME: the workflow uploads E2E_ARTIFACTS, so a failure can be read afterwards.
if [ -n "${E2E_ARTIFACTS:-}" ]; then mkdir -p "$E2E_ARTIFACTS"; cp "$PLAIN" "$E2E_ARTIFACTS/setup-transcript.txt" 2>/dev/null || true; fi
if [ "$DRIVE_RC" -ne 0 ]; then
  sed 's/^/    /' "$RUN_HOME/drive.err"; echo "  --- the last of the interview ---"; tail -40 "$PLAIN" | sed 's/^/    /'
  die "the first-run interview did not finish (drive.exp exited $DRIVE_RC)"
fi
grep -qF "is already governed" "$PLAIN" && die "gov found $E2E_ORG already governed and offered the joiner path"
grep -qF "Your practice project" "$PLAIN" || { tail -40 "$PLAIN" | sed 's/^/    /'; die "setup did not report the practice project"; }
gh api "repos/$E2E_ORG/$REPO" --silent 2>/dev/null && ok "setup created $E2E_ORG/$REPO" || die "setup did not create $E2E_ORG/$REPO"
gh api "repos/$E2E_ORG/$REPO/contents/.github/workflows/approver-check.yml" --silent 2>/dev/null \
  && ok "the setup commit carries the approval check" || die "the default branch has no .github/workflows/approver-check.yml"
SETUP_BOARD="$(sed -n "s|^  Board:   https://github.com/orgs/$E2E_ORG/projects/\([0-9][0-9]*\)$|\1|p" "$PLAIN" | head -1)"
# Polled: GitHub's project list can lag a board just made. On a miss, what the org holds and what setup SAID about it.
PROJ_NUM=""; BOARDS=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  BOARDS="$(org_projects 2>&1 || true)"
  # `gov seed` renames the board to "PRJ-<n> · <title>" (lifecycle/seed.ts) — the first dispatch looked for the bare
  # title and missed it. The number setup printed ("Board: …/projects/<n>") is the one; the title, either form, confirms.
  PROJ_NUM="$(printf '%s\n' "$BOARDS" | awk -F'\t' -v t="$PRACTICE_TITLE" -v n="$SETUP_BOARD" \
    '$4 == "false" && ($2 == t || $2 ~ ("^PRJ-" $1 " · " t "$")) && (n == "" || $1 == n) { print $1 }' | head -1)"
  [ -n "$PROJ_NUM" ] && break
  sleep 5
done
if [ -z "$PROJ_NUM" ]; then
  echo "  the org's projects (number, title, created, closed):"; printf '%s\n' "${BOARDS:-<none>}" | sed 's/^/    /'
  echo "  what setup said about the practice project:"; sed -n '/practice project/,/^$/p' "$PLAIN" | head -20 | sed 's/^/    /'
  die "no open \"$PRACTICE_TITLE\" board in $E2E_ORG after setup (polled 60s)"
fi
ok "practice board #$PROJ_NUM \"$PRACTICE_TITLE\""
ledger PROJ_NUM
ANCHOR="$(gh api "repos/$E2E_ORG/$REPO/issues?state=open&labels=anchor,practice" --jq '.[0].html_url // empty' 2>/dev/null || true)"
[ -n "$ANCHOR" ] && ok "anchor labelled anchor + practice: $ANCHOR" || die "no open issue labelled anchor,practice in $E2E_ORG/$REPO"
TASK_JSON="$(gh api "repos/$E2E_ORG/$REPO/issues?state=open&per_page=50" --jq "[.[] | select(.title == \"$TASK_TITLE\")][0] // empty")"
TASK_URL="$(printf '%s' "$TASK_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).html_url||"")}catch{}})')"
[ -n "$TASK_URL" ] && ok "practice task: $TASK_URL" || die "no open \"$TASK_TITLE\" issue in $E2E_ORG/$REPO"
TASK_BODY="$(printf '%s' "$TASK_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).body||"")}catch{}})')"
grep -qF "Seeded:  the project branch exists" "$PLAIN" && ok "setup seeded the practice project's branch" \
  || warn "setup did not report the practice project seeded — gov work will seed it (counted in the practice phase)"

# ── practice: what the task tells the agent to do, scripted ────────────────────────────────────────────────────────
PID="PRJ-${PROJ_NUM}-make-the-policy-ours"
step "Practice — gov work → task → the change → propose → merge → close ($PID)"
WORK_OUT="$(gov work --project="$PID" --no-launch </dev/null 2>&1)" || { printf '%s\n' "$WORK_OUT" | tail -15; die "gov work --project=$PID --no-launch failed"; }
PWR="$(printf '%s\n' "$WORK_OUT" | sed -n "s/^  ✓ '[^']*' is ready at:  //p" | tail -1)"
[ -n "$PWR" ] && [ -e "$PWR/$REPO/.git" ] || { printf '%s\n' "$WORK_OUT" | tail -15; die "gov work did not open $REPO under the project (${PWR:-no path printed})"; }
cd "$PWR/$REPO"
ok "project open at $PWR, on $(git rev-parse --abbrev-ref HEAD)"
TASK_OUT="$(gov task "$TASK_URL" </dev/null 2>&1)" || { printf '%s\n' "$TASK_OUT" | tail -15; die "gov task failed"; }
ok "task sub-branch $(git rev-parse --abbrev-ref HEAD)"
# The two edits, read from the task text — the values the agent is told to write.
NEW_TITLE="$(printf '%s\n' "$TASK_BODY" | sed -n 's/^- `title:` becomes `"\(.*\)"`$/\1/p' | head -1)"
NEW_BY="$(printf '%s\n' "$TASK_BODY" | sed -n 's/^- `approved_by:` becomes `"\(.*\)"`$/\1/p' | head -1)"
[ -n "$NEW_TITLE" ] && [ -n "$NEW_BY" ] || die "the task text no longer says what title: and approved_by: become"
POLICY="policies/policy-document.yaml"
T="$NEW_TITLE" B="$NEW_BY" perl -0pi -e 's/^(  title:[ \t]*).*$/$1"$ENV{T}"/m; s/^(  approved_by:[ \t]*).*$/$1"$ENV{B}"/m' "$POLICY"
grep -qF "  title: \"$NEW_TITLE\"" "$POLICY" && grep -qF "  approved_by: \"$NEW_BY\"" "$POLICY" \
  && ok "title_page: title \"$NEW_TITLE\", approved_by \"$NEW_BY\"" || die "the title-page edit did not apply to $POLICY"
# THE TEST CONCESSION (see the header): the practice PR's workflows ask for the sandbox's runner.
for wf in .github/workflows/*.yml; do
  RO="$RUNS_ON" perl -pi -e 's{^(\s+runs-on:[ \t]*)(?!.*\$\{\{).*$}{$1$ENV{RO}}' "$wf"
done
grep -qF "runs-on: $RUNS_ON" .github/workflows/approver-check.yml || die "could not point approver-check.yml at $RUNS_ON"
ok "test concession: the PR's workflows ask for $RUNS_ON (the sandbox has no hosted minutes)"
# The title page has no rule rows: propose reads no section, needs no model, and writes the version bump.
VERSION_BEFORE="$(cat policies/VERSION 2>/dev/null || true)"
PROPOSE_OUT="$(gov rules propose </dev/null 2>&1)" || { printf '%s\n' "$PROPOSE_OUT" | tail -12 | sed 's/^/    /'; die "gov rules propose failed"; }
printf '%s' "$PROPOSE_OUT" | grep -qF "0 section(s) read" || { printf '%s\n' "$PROPOSE_OUT" | tail -12 | sed 's/^/    /'; die "gov rules propose did not say \"0 section(s) read\" for a title-page-only change"; }
VERSION_AFTER="$(cat policies/VERSION 2>/dev/null || true)"
[ -n "$VERSION_AFTER" ] && [ "$VERSION_AFTER" != "$VERSION_BEFORE" ] && ok "gov rules propose: 0 section(s) read, policies/VERSION ${VERSION_BEFORE:-?} → $VERSION_AFTER" \
  || die "gov rules propose did not change policies/VERSION (still '${VERSION_AFTER:-absent}')"
git add -- policies .github
git commit -qm "Put our name on the policy (closes #${TASK_URL##*/})" || die "nothing to commit after the change"
ok "committed the change"
MERGE_OUT="$(gov merge "$TASK_URL" </dev/null 2>&1)" || { printf '%s\n' "$MERGE_OUT" | tail -15; die "gov merge failed"; }
ok "gov merge landed the task on the project branch"
CLOSE_OUT="$(gov close </dev/null 2>&1)" || { printf '%s\n' "$CLOSE_OUT" | tail -15; die "gov close failed"; }
PR_LINE="$(gh pr list --repo "$E2E_ORG/$REPO" --state open --json number,url,headRefName \
  --jq ".[] | select(.headRefName | startswith(\"BRNCH-${PROJ_NUM}-\")) | \"\(.number) \(.url)\"" | head -1)"
T2=$(now)
[ -n "$PR_LINE" ] || { printf '%s\n' "$CLOSE_OUT" | tail -15; die "gov close opened no pull request from BRNCH-${PROJ_NUM}-…"; }
PR_NUM="${PR_LINE%% *}"; PR_URL="${PR_LINE#* }"
ok "gov close opened $PR_URL"

# ── stop: the approval check reports failure on the PR ─────────────────────────────────────────────────────────────
step "Stop — wait for approver-check to fail on PR #$PR_NUM (≤ ${STOP_DEADLINE}s)"
VERDICT=""; LAST=""; HEAD_AUTHOR=""
while [ $(( $(now) - T2 )) -lt "$STOP_DEADLINE" ]; do
  # THE PR'S HEAD ONLY (F154 A): the policy check never pushes, and `gov close` writes the PR number in a second commit
  # of its own, authored by the adopter — so the head moves once, right after the PR opens, and the verdict that counts
  # is the one on the head. A head authored by a bot, or any run there waiting for approval (`action_required`), is the
  # pattern F154 removed, and fails the journey rather than being waited out.
  HEAD="$(gh api "repos/$E2E_ORG/$REPO/pulls/$PR_NUM" --jq '"\(.head.sha) \(.head.user.login)"' 2>/dev/null || true)"
  SHA="${HEAD%% *}"
  if [ -n "$SHA" ]; then
    HEAD_AUTHOR="$(gh api "repos/$E2E_ORG/$REPO/commits/$SHA" --jq '"\(.author.login // .commit.author.name) \(.author.type // "")"' 2>/dev/null || true)"
    case "$HEAD_AUTHOR" in *"[bot]"*|*" Bot") die "PR #$PR_NUM's head ${SHA:0:7} is authored by a bot ($HEAD_AUTHOR) — F154 A: nothing but the adopter commits to the practice PR" ;; esac
    AR="$(gh api "repos/$E2E_ORG/$REPO/actions/runs?head_sha=$SHA" --jq '[.workflow_runs[] | select(.conclusion == "action_required") | .name] | join(", ")' 2>/dev/null || true)"
    [ -z "$AR" ] || die "workflow run(s) on PR #$PR_NUM's head ${SHA:0:7} wait for approval to run (action_required): $AR — F154 A removed that"
    LAST="$(gh api "repos/$E2E_ORG/$REPO/commits/$SHA/check-runs?check_name=approver-check" \
      --jq '.check_runs | sort_by(.started_at) | last | select(. != null) | "\(.id) \(.status) \(.conclusion)"' 2>/dev/null || true)"
    case "$LAST" in
      *" completed failure") VERDICT=failure; break ;;
      *" completed success") VERDICT=success; break ;;
    esac
  fi
  sleep 5
done
T3=$(now)
case "$VERDICT" in
  failure)
    # FAILED FOR THE RIGHT REASON, or it is not the stop. The first green run (2026-11-24) "stopped" on exit 127 — a
    # command missing on the runner — which a red check alone cannot tell from gov waiting for an approval.
    MSGS="$(gh api "repos/$E2E_ORG/$REPO/check-runs/${LAST%% *}/annotations" --jq '[.[] | select(.annotation_level == "failure") | .message] | join("\n")' 2>/dev/null || true)"
    REASON="$(printf '%s\n' "$MSGS" | grep -m1 -E 'No approving review yet|self-merged: no second person|Name a second person|none of them is on' || true)"
    if [ -z "$REASON" ]; then
      echo "  approver-check's failure annotations:"; printf '%s\n' "${MSGS:-<none>}" | sed 's/^/    /'
      case "$MSGS" in *"exit code 127"*)
        # The check run IS the Actions job: its log names the command the shell could not find.
        NOTFOUND="$(gh api "repos/$E2E_ORG/$REPO/actions/jobs/${LAST%% *}/logs" 2>/dev/null \
          | grep -oE '[A-Za-z0-9_.-]+: (command )?not found' | sed -E 's/: (command )?not found//' | sort -u | tr '\n' ' ' || true)"
        die "approver-check failed with exit 127 — not gov waiting for an approval: the runner $RUNS_ON lacks ${NOTFOUND:-a command (its log did not say which)}. gov's workflows there need: $RUNNER_TOOLS" ;;
      esac
      # SHOW THE CHECK'S OWN WORDS before the teardown deletes them: a failure with no annotation (F158's PR1 met two
      # in a row) is otherwise undiagnosable — the repository, and the log with it, are gone a minute later.
      echo "  the last lines of approver-check's log (job ${LAST%% *}):"
      gh api "repos/$E2E_ORG/$REPO/actions/jobs/${LAST%% *}/logs" 2>/dev/null | tail -40 | sed -E 's/^[0-9TZ:.-]+ //; s/^/    /' || echo "    (the log could not be read)"
      die "approver-check failed on PR #$PR_NUM, but not because it waits for someone else's approval"
    fi
    ok "approver-check FAILED on PR #$PR_NUM — gov stopped the change: \"$REASON\"" ;;
  success) die "approver-check PASSED on PR #$PR_NUM with nobody's approval — the stop the home page promises did not happen" ;;
  *)
    # What Actions did with the PR, before the teardown deletes the repository and the answer with it.
    echo "  the repository's workflow runs (workflow, event, status, conclusion, head):"
    gh api "repos/$E2E_ORG/$REPO/actions/runs?per_page=20" --jq '.workflow_runs[] | "    \(.name)  \(.event)  \(.status)  \(.conclusion)  \(.head_branch)@\(.head_sha[0:7])"' 2>&1 | head -20 || true
    echo "  check runs on the PR's head ${SHA:0:7}:"
    gh api "repos/$E2E_ORG/$REPO/commits/$SHA/check-runs" --jq '.check_runs[] | "    \(.name)  \(.status)  \(.conclusion)"' 2>&1 | head -20 || true
    case "$LAST" in *" queued "*|*" queued") die "approver-check is still QUEUED after ${STOP_DEADLINE}s — is a runner carrying $RUNS_ON online in $E2E_ORG?" ;; esac
    die "approver-check did not complete on PR #$PR_NUM within ${STOP_DEADLINE}s (last: ${LAST:-no check run})" ;;
esac

# ── the measurement ────────────────────────────────────────────────────────────────────────────────────────────────
step "Time to the first stop"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || { echo "PR: $PR_URL · approver-check: failed · policies/VERSION $VERSION_BEFORE → $VERSION_AFTER"; echo; } >>"$GITHUB_STEP_SUMMARY"
BUDGET_OK=0
timing_report "$BUDGET" "install=$T_INSTALL" "setup=$((T1 - T0))" "practice task → PR open=$((T2 - T1))" "PR open → approval finding on the head=$((T3 - T2))" || BUDGET_OK=$?
[ "$BUDGET_OK" -eq 0 ] && ok "the first stop came in ${TIMING_TOTAL}s — within the ${BUDGET}s the home page promises" \
  || die "the first stop took ${TIMING_TOTAL}s — over the ${BUDGET}s budget (E2E_BUDGET_SECS): the home page's \"under 10 minutes\" is not met"
