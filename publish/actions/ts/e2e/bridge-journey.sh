#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# BRIDGE JOURNEY — the Svayamtech migration's rehearsal, scripted (PRJ-121 intent 01, task B09; spec 01 §4.3 step 2).
# bridge: deleted in D01 with the rest of the bridge, after the real runs (spec §4.1).
#
# Against REAL GitHub, on the private rehearsal copy of Svayamtech's gov repo in the sandbox org (H01:
# svayam-e2e/svm-prj-work-rehearsal — one commit, no history, secret-scanned first, ruling Q12). Every run starts by
# RESETTING the copy to H01's commit, so each run is the same migration from the same tree:
#
#   0  reset         the copy's default branch → H01's snapshot (tag $BRIDGE_SNAPSHOT); open PRs closed, other
#                    branches deleted; one "rehearsal pointer" commit: org-config names the sandbox, never Svayamtech,
#                    and CI installs the gov under test (.gov-ci/gov.tgz)
#   1  upgrade       gov upgrade --pr on the copy → the PR → its CI green (approval checks aside) → merged
#   2  propose       gov rules propose --all with a STUB model (no key, no cost) → a policy PR → merged
#   3  build         gov rules build
#   4  protect       gov repo protect apply
#   5  check install gov check install on the sandbox code repo ($BRIDGE_APP_REPO), on a throwaway branch
#   6  doctor        gov doctor on the migrated copy: ok
#   7  journey       a board + issue → gov seed → gov join (a second work root) → gov work --print-prompt → gov task
#                    → a commit → gov merge
#   8  gov-cicd      a dry run against the migrated copy: `gov-cicd catalog` and `deploy <unit> --env dev --dry-run`
#                    (knowledge/deployment/** is never touched by the bridge — T11, T13 — and gov-cicd still reads it)
#
# The copy is NOT deleted at the end: the Policy Owner reviews the rehearsal PR (§4.3 step 4). What this run created
# beside it — the board, the issue, the code repo's branch — is deleted.
#
# Required env (live):
#   E2E_ORG          the sandbox org (svayam-e2e) — never a real org; the copy must live in it
#   GH_TOKEN         classic PAT: repo, workflow, project, read:org (falls back to `gh auth token`)
#   GOV_TARBALL      the packed gov under test (npm pack) — the bridge pre-release's dev build
#   CONTENT_DIR      publish/content of the same build (what `gov upgrade --from` installs)
# Optional:
#   BRIDGE_REPO      default $E2E_ORG/svm-prj-work-rehearsal (its name must contain "rehearsal")
#   BRIDGE_SNAPSHOT  the ref in BRIDGE_REPO holding H01's commit (default tag h01-snapshot)
#   BRIDGE_APP_REPO  the sandbox code repo for step 5 (default $E2E_ORG/e2e-app)
#   BRIDGE_APPROVAL_CHECKS  extended regex of check names that wait for an authorized approval and are not read as
#                    CI (default: approver-check, GOV-FRM-455 · pull_request) — the bot is not the copy's approver
#   GOV_CICD_PACKAGE the gov-cicd package or tarball for step 8; BRIDGE_CICD_UNIT the unit (default: the first listed)
#   E2E_SKIPS_FILE   each skipped assertion, by name, for e2e/live-verdict.sh (a skip makes the journey incomplete)
#   E2E_RUNS_ON      the runner every workflow in the copy and the code repo asks for (default [self-hosted, linux,
#                    svayam-e2e] — the sandbox's self-hosted runner; its Actions spending limit is $0): written into the
#                    copy's own workflows at step 0 and as ci.runs_on in its governance.yaml from step 2 on
#   E2E_WAIT_SECS / E2E_DEADLINE_SECS   caps on one wait (480) and on the whole run's waiting (2700)
#
#   --dry-run (or E2E_DRY_RUN=1)  HERMETIC: prints every gh / git / gov / gov-cicd / npm call instead of making it.
#                                 No token, org or network; assertions are listed, not evaluated, nothing is skipped.
# shellcheck disable=SC2015  # `a && b || die` is the house idiom (adopter-journey.sh)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;; esac; done
[ "${E2E_DRY_RUN:-0}" = "1" ] && DRY=1
exec 3>&2   # the dry run's "+ call" lines

if [ "$DRY" = 1 ]; then
  E2E_ORG="${E2E_ORG:-dry-sandbox-org}"; GH_TOKEN="dry-token-never-used"
  GOV_TARBALL="${GOV_TARBALL:-/dry/svayam-opensource-gov.tgz}"
  CONTENT_DIR="${CONTENT_DIR:-$(cd "$HERE/../../../content" && pwd)}"
  GOV_CICD_PACKAGE="${GOV_CICD_PACKAGE:-/dry/svayam-gov-cicd.tgz}"
fi
: "${E2E_ORG:?set E2E_ORG}"; : "${GOV_TARBALL:?set GOV_TARBALL}"; : "${CONTENT_DIR:?set CONTENT_DIR}"
R="${BRIDGE_REPO:-$E2E_ORG/svm-prj-work-rehearsal}"
SNAP="${BRIDGE_SNAPSHOT:-h01-snapshot}"
R_APP="${BRIDGE_APP_REPO:-$E2E_ORG/e2e-app}"
APPROVAL_CHECKS="${BRIDGE_APPROVAL_CHECKS:-^(approver-check|GOV-FRM-455 · pull_request)\$}"

# THE ONE REPO THIS SCRIPT RESETS IS A REHEARSAL COPY IN THE SANDBOX — checked before the token is even read. A reset
# force-moves the default branch; pointed at Svayamtech/svm-prj-work it would erase the real governance history.
case "$E2E_ORG" in Svayamtech|svayamtech|svayam-opensource) echo "bridge-journey: E2E_ORG=$E2E_ORG is a real org — the rehearsal runs only in the sandbox" >&2; exit 2 ;; esac
[ "${R%%/*}" = "$E2E_ORG" ] || { echo "bridge-journey: $R is not in the sandbox org $E2E_ORG — refusing" >&2; exit 2; }
case "${R#*/}" in *rehearsal*) ;; *) echo "bridge-journey: $R is not a rehearsal copy (its name must contain \"rehearsal\") — refusing to reset it" >&2; exit 2 ;; esac
[ "${R_APP%%/*}" = "$E2E_ORG" ] || { echo "bridge-journey: $R_APP is not in the sandbox org $E2E_ORG — refusing" >&2; exit 2; }

if [ -z "${GH_TOKEN:-}" ]; then GH_TOKEN="$(gh auth token 2>/dev/null || true)"; fi
: "${GH_TOKEN:?set GH_TOKEN (or log gh in)}"
export GH_TOKEN

WAIT_SECS="${E2E_WAIT_SECS:-480}"
DEADLINE=$((SECONDS + ${E2E_DEADLINE_SECS:-2700}))
RUNS_ON="${E2E_RUNS_ON:-[self-hosted, linux, svayam-e2e]}"
RUN_ID="${E2E_RUN_ID:-$(date +%s)-$((RANDOM % 1000))}"
[ "$DRY" = 1 ] && RUN_ID="dry"
ROOT="$(mktemp -d)"
PASS=0; SKIP=0
BOARD=""; ISSUE=""; APP_BRANCH=""

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
note() { printf '  \033[33m! %s\033[0m\n' "$*"; }
# A SKIP IS NOT A PASS (intent 05, ruling Q2): named in the log, as an annotation, and in $E2E_SKIPS_FILE for the verdict.
skip() { printf '  \033[33m⤼ SKIPPED: %s\033[0m\n' "$*"; SKIP=$((SKIP+1))
  if [ -n "${E2E_SKIPS_FILE:-}" ]; then printf 'bridge\t%s\n' "$*" >>"$E2E_SKIPS_FILE"; fi
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::bridge journey: skipped $* — the journey is incomplete"; fi
  return 0; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::bridge journey: $*"; exit 1; }
on_err() { local rc=$? line=$1 cmd=$2; [ "$rc" -eq 0 ] && return 0
  printf '  \033[31m✗ line %s exited %s: %s\033[0m\n' "$line" "$rc" "$cmd"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::bridge journey: line $line exited $rc: $cmd"; return 0; }
trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR

# THE ONLY DOORS TO THE OUTSIDE. Dry: print the call, make none. `x` runs; `xo DEFAULT …` captures stdout (dry: DEFAULT).
x()  { if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*" >&3; return 0; fi; "$@"; }
xo() { local d="$1"; shift; if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*" >&3; printf '%s\n' "$d"; return 0; fi; "$@"; }
# `xin DIR …`: x, run inside DIR (gov resolves its workspace from the directory it runs in).
xin() { local d="$1"; shift; if [ "$DRY" = 1 ]; then printf '  + (cd %s) %s\n' "$d" "$*" >&3; return 0; fi; ( cd "$d" && "$@" ); }
xino() { local d="$1" def="$2"; shift 2; if [ "$DRY" = 1 ]; then printf '  + (cd %s) %s\n' "$d" "$*" >&3; printf '%s\n' "$def"; return 0; fi; ( cd "$d" && "$@" ); }
expect() { local msg="$1"; shift; if [ "$DRY" = 1 ]; then printf '  ◇ would assert: %s\n' "$msg"; PASS=$((PASS+1)); return 0; fi
  if "$@"; then ok "$msg"; else die "$msg"; fi; }

# ── Teardown: what this run created BESIDE the copy, always ──────────────────────────────────────────────────────
teardown() {
  local rc=$?
  trap - ERR
  if [ "${E2E_KEEP:-0}" = "1" ]; then echo "E2E_KEEP=1 — leaving the board, issue and branches"; else
    step "Teardown (the rehearsal copy stays, for review)"
    if [ -n "$BOARD" ]; then x gh project delete "$BOARD" --owner "$E2E_ORG" >/dev/null 2>&1 && echo "  deleted board $BOARD" || note "could not delete board $BOARD"; fi
    if [ -n "$ISSUE" ]; then x gh issue close "$ISSUE" >/dev/null 2>&1 || true; fi
    if [ -n "$APP_BRANCH" ]; then x gh api -X DELETE "repos/$R_APP/git/refs/heads/$APP_BRANCH" >/dev/null 2>&1 && echo "  deleted $R_APP@$APP_BRANCH" || note "could not delete $R_APP@$APP_BRANCH"; fi
  fi
  rm -rf "$ROOT"
  printf '\n\033[1m═══ bridge-journey%s: %d passed, %d skipped, %s ═══\033[0m\n' "$([ "$DRY" = 1 ] && echo ' (DRY RUN)')" "$PASS" "$SKIP" "$(if [ $rc -ne 0 ]; then echo FAILED; elif [ "$SKIP" -gt 0 ]; then echo INCOMPLETE; else echo ok; fi)"
  exit $rc
}
trap teardown EXIT
trap 'exit 130' INT TERM

# Every check run on `sha` completed? Prints "<conclusion>\t<name>" per run once they all have (≥1), else "timeout".
checks_done() { local repo="$1" sha="$2" t0=$SECONDS out
  if [ "$DRY" = 1 ]; then printf '  + poll gh api repos/%s/commits/%s/check-runs until every run completes (≤%ss)\n' "$repo" "$sha" "$WAIT_SECS" >&3; printf 'success\tgov-validate\n'; return 0; fi
  while :; do
    out="$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" --jq '.check_runs[] | "\(.status)\t\(.conclusion)\t\(.name)"' 2>/dev/null || true)"
    if [ -n "$out" ] && ! awk -F'\t' '$1 != "completed" { bad=1 } END { exit !bad }' <<<"$out"; then cut -f2- <<<"$out"; return 0; fi
    if [ $((SECONDS - t0)) -ge "$WAIT_SECS" ] || [ "$SECONDS" -ge "$DEADLINE" ]; then echo "timeout"; return 0; fi
    sleep 15
  done
}
# The checks that are CI (not approval) and did not pass: one name per line; empty = CI green.
ci_red() { awk -F'\t' -v re="$APPROVAL_CHECKS" '$1 == "timeout" { print "(timed out waiting)"; next } $2 ~ re { next } $1 != "success" && $1 != "neutral" && $1 != "skipped" { print $2 " (" $1 ")" }' <<<"$1"; }
head_of() { xo "dry-sha-$2" gh pr view "$2" --repo "$1" --json headRefOid --jq .headRefOid; }
# Land PR `n` on `repo`: its CI green (approval checks aside), then merged.
land_pr() { local repo="$1" n="$2" what="$3" sha res red
  sha="$(head_of "$repo" "$n")"
  res="$(checks_done "$repo" "$sha")"
  red="$(ci_red "$res")"
  expect "$what: CI green on PR #$n (approval checks aside)${red:+ — red: $(tr '\n' ' ' <<<"$red")}" test -z "$red"
  x gh pr merge "$n" --repo "$repo" --merge --delete-branch >/dev/null || die "merge of $what PR #$n failed"
  x git -C "$C" switch -q "$DEF" && x git -C "$C" pull -q --ff-only || die "pull $DEF failed"
  ok "$what PR #$n merged"; }

# ── Bootstrap: isolated HOME, the packed gov, gh + git ───────────────────────────────────────────────────────────
step "Bootstrap (isolated HOME · packed gov · gh)"
export HOME="$ROOT/home" XDG_CONFIG_HOME="$ROOT/home/.config" GH_CONFIG_DIR="$ROOT/home/.config/gh" GIT_CONFIG_GLOBAL="$ROOT/home/.gitconfig"
export NPM_CONFIG_PREFIX="$ROOT/npm" PATH="$ROOT/npm/bin:$PATH" GH_PROMPT_DISABLED=1
mkdir -p "$HOME" "$NPM_CONFIG_PREFIX/bin"
x npm i -g "$GOV_TARBALL" >/dev/null 2>&1 || die "could not install $GOV_TARBALL"
GOV_VERSION="$(xo 2.0.0-dev.gdry gov --version)" || die "gov not on PATH after installing the tarball"
LOGIN="$(xo e2e-bot gh api user --jq .login)" || die "gh auth failed (GH_TOKEN)"
[ -n "$LOGIN" ] || die "gh auth failed (GH_TOKEN)"
x git config --global user.name "$LOGIN"
x git config --global user.email "$LOGIN@users.noreply.github.com"
x git config --global init.defaultBranch main
x git config --global credential.https://github.com.helper '!gh auth git-credential'
ok "gov $GOV_VERSION from the tarball · gh as $LOGIN · HOME=$HOME"

# ── 0. Reset the copy to H01's snapshot ──────────────────────────────────────────────────────────────────────────
step "0 · reset $R to H01's snapshot ($SNAP)"
DEF="$(xo main gh api "repos/$R" --jq .default_branch)" || die "cannot read $R — does the rehearsal copy exist (H01)?"
C="$ROOT/copy"
x git clone -q "https://github.com/$R.git" "$C" || die "clone $R failed"
x git -C "$C" fetch -q origin "refs/tags/$SNAP:refs/tags/$SNAP" || die "$R has no $SNAP — H01 tags the snapshot commit it pushed"
SNAP_SHA="$(xo dry-snapshot-sha git -C "$C" rev-parse "$SNAP^{commit}")"
for n in $(xo "" gh pr list --repo "$R" --state open --json number --jq '.[].number'); do
  x gh pr close "$n" --repo "$R" >/dev/null || die "could not close PR #$n"
done
for b in $(xo "" git -C "$C" ls-remote --heads origin | awk '{ sub("refs/heads/", "", $2); print $2 }'); do
  [ "$b" = "$DEF" ] || x git -C "$C" push -q origin --delete "$b" || die "could not delete $R@$b"
done
x git -C "$C" push -q --force origin "$SNAP_SHA:refs/heads/$DEF" || die "could not reset $R@$DEF to $SNAP"
x git -C "$C" fetch -q origin && x git -C "$C" switch -q "$DEF" && x git -C "$C" reset -q --hard "origin/$DEF" || die "could not check out the reset $DEF"
ok "$R@$DEF is H01's snapshot ($SNAP_SHA); open PRs closed, other branches deleted"

# THE REHEARSAL POINTER: the copy's org-config names Svayamtech; every gov call below must reach the sandbox instead.
set_key() { local f="$1" k="$2" v="$3"
  if [ "$DRY" = 1 ]; then printf '  + set %s: "%s" in %s\n' "$k" "$v" "${f#"$ROOT/"}" >&3; return 0; fi
  if grep -qE "^$k:" "$f"; then perl -pi -e "s{^$k:.*}{$k: \"$v\"}" "$f"; else printf '%s: "%s"\n' "$k" "$v" >>"$f"; fi; }
set_key "$C/org-config.yaml" github_org "$E2E_ORG"
set_key "$C/org-config.yaml" workspace_repo "${R#*/}"
set_key "$C/org-config.yaml" org_gov_repo "${R#*/}"
set_key "$C/org-config.yaml" org_repo_url "https://github.com/$R"
expect "org-config.yaml names the sandbox ($E2E_ORG), not Svayamtech" grep -qx "github_org: \"$E2E_ORG\"" "$C/org-config.yaml"
mkdir -p "$C/.gov-ci"
x cp "$GOV_TARBALL" "$C/.gov-ci/gov.tgz"
# CI installs the gov under test, never what npm calls latest (gov-validate.yml is the org's; the copy's is edited).
if [ "$DRY" = 1 ] || [ -f "$C/.github/workflows/gov-validate.yml" ]; then
  x perl -pi -e 's{npm install -g \@svayam-opensource/gov\S*}{npm install -g ./.gov-ci/gov.tgz}' "$C/.github/workflows/gov-validate.yml"
fi
# THE SANDBOX'S RUNNER: the copy's own workflows are the org's (gov never rewrites them), so the rehearsal points their
# jobs at it here; gov's own workflows get it from ci.runs_on, which lands with the stub model at step 2.
for wf in "$C"/.github/workflows/*.yml; do
  [ "$DRY" = 1 ] || [ -f "$wf" ] || continue
  x perl -pi -e 's{^(    runs-on:[ \t]*)(?!.*\$\{\{).*$}{${1}'"$RUNS_ON"'}' "$wf"
done
x git -C "$C" add -A && x git -C "$C" commit -qm "rehearsal pointer: the sandbox org, the gov under test (bridge journey $RUN_ID)" \
  && x git -C "$C" push -q origin "$DEF" || die "could not push the rehearsal pointer"
ok "rehearsal pointer on $DEF"

# ── 1. gov upgrade --pr → CI green → merged ──────────────────────────────────────────────────────────────────────
step "1 · gov upgrade --pr (the bridge) → CI green → merge"
UP_OUT="$(xino "$C" "Opened upgrade PR: https://github.com/$R/pull/1" gov upgrade --pr --from "$CONTENT_DIR" --gov-package ./.gov-ci/gov.tgz --gov-home . 2>&1)" \
  || { printf '%s\n' "$UP_OUT" | tail -15; die "gov upgrade --pr failed"; }
UP_URL="$(sed -n 's/^Opened upgrade PR: //p' <<<"$UP_OUT" | head -1)"
expect "gov upgrade --pr opened the upgrade PR (${UP_URL:-none})" test -n "$UP_URL"
UP_PR="${UP_URL##*/}"
UP_BRANCH="$(xo "gov-upgrade-dry" gh pr view "$UP_PR" --repo "$R" --json headRefName --jq .headRefName)"
expect "the upgrade PR carries the move record at framework/upgrade-moves.json" \
  xo ok gh api "repos/$R/contents/framework/upgrade-moves.json?ref=$UP_BRANCH" --jq .name
expect "the upgrade PR re-renders gov-checks.yml to install the gov under test (Q9)" \
  bash -c "gh api 'repos/$R/contents/.github/workflows/gov-checks.yml?ref=$UP_BRANCH' -H 'Accept: application/vnd.github.raw' 2>/dev/null | grep -q 'npm install -g ./.gov-ci/gov.tgz' || ! gh api 'repos/$R/contents/.github/workflows/gov-checks.yml?ref=$UP_BRANCH' >/dev/null 2>&1"
land_pr "$R" "$UP_PR" "upgrade"
expect "no legacy root move record is left (§3.7)" test ! -e "$C/.gov-upgrade-moves.json"

# ── 2. gov rules propose --all, with a stub model → a policy PR → merged ─────────────────────────────────────────
step "2 · gov rules propose --all (stub model) → policy PR → merge"
# The model is read from the DEFAULT branch's governance.yaml, so the stub lands there first (the copy, soft posture).
if [ "$DRY" = 1 ]; then printf '  + set models.propose to the stub command model in policies/governance.yaml\n' >&3
else
  awk 'BEGIN { skip = 0 } /^models:/ { skip = 1; next } skip && /^[^[:space:]#]/ { skip = 0 } !skip { print }' "$C/policies/governance.yaml" >"$ROOT/gov.yaml"
  cat >>"$ROOT/gov.yaml" <<'YAML'
models:
  propose:
    provider: "command"
    model: ""
  command: "bash .gov-ci/stub-model.sh"
  ci_allowed: true
YAML
  mv "$ROOT/gov.yaml" "$C/policies/governance.yaml"
fi
# …and the sandbox's runner, which every workflow gov writes from here on asks for (protect apply, check install).
if [ "$DRY" = 1 ]; then printf '  + ci.runs_on: %s in policies/governance.yaml\n' "$RUNS_ON" >&3
else
  awk 'BEGIN { skip = 0 } /^ci:/ { skip = 1; next } skip && /^[^[:space:]#]/ { skip = 0 } !skip { print }' "$C/policies/governance.yaml" >"$ROOT/gov.yaml"
  printf 'ci:\n  runs_on: %s\n' "$RUNS_ON" >>"$ROOT/gov.yaml"
  mv "$ROOT/gov.yaml" "$C/policies/governance.yaml"
fi
cat >"$C/.gov-ci/stub-model.sh" <<'SH'
#!/usr/bin/env bash
# Stub `command` model for the bridge rehearsal — no API key, no cost, the same answer every run.
cat >/dev/null
cat <<'JSON'
{"verdicts":[{"kind":"add","row":{"expectation":"A change to application behaviour, or a bug fix, comes with a test that would fail without it.","actor":["human","agent"],"level":"C02","cue":{"tier":"on-demand","text":"Add a test that fails without your change."}}}],"ownership":[],"questions":[]}
JSON
SH
x git -C "$C" add -A && x git -C "$C" commit -qm "rehearsal: the stub propose model (bridge journey $RUN_ID)" && x git -C "$C" push -q origin "$DEF" \
  || die "could not land the stub model on $DEF"
x git -C "$C" switch -q -c bridge/propose
x git -C "$C" commit -q --allow-empty -m "policy: first extraction (bridge journey $RUN_ID)"
x git -C "$C" push -q -u origin bridge/propose || die "push bridge/propose failed"
P_URL="$(xo "https://github.com/$R/pull/2" gh pr create --repo "$R" --base "$DEF" --head bridge/propose --title "policy: first extraction (gov rules propose --all)" --body "bridge journey $RUN_ID")"
P_PR="${P_URL##*/}"
PROP_OUT="$(xino "$C" "proposed" gov rules propose --all --pr "$P_PR" --gov-home . 2>&1)" || { printf '%s\n' "$PROP_OUT" | tail -15; die "gov rules propose --all failed"; }
expect "propose --all wrote the org's rule store" test -s "$C/policies/rules/rules.yaml" -o -s "$C/policies/rules.yaml"
x git -C "$C" add -A && x git -C "$C" commit -qm "gov rules propose --all (stub model)" && x git -C "$C" push -q origin bridge/propose || die "could not push the proposal"
land_pr "$R" "$P_PR" "policy (propose --all)"

# ── 3. gov rules build ───────────────────────────────────────────────────────────────────────────────────────────
step "3 · gov rules build"
BUILD_OUT="$(xino "$C" "" gov rules build --gov-home . 2>&1)" || { printf '%s\n' "$BUILD_OUT" | tail -15; die "gov rules build failed"; }
if [ "$DRY" = 1 ] || [ -n "$(git -C "$C" status --porcelain)" ]; then
  x git -C "$C" add -A && x git -C "$C" commit -qm "gov rules build" && x git -C "$C" push -q origin "$DEF" || die "could not push the build"
fi
expect "gov rules check: nothing stale after the build" xin "$C" gov rules check --gov-home .

# ── 4. gov repo protect apply ────────────────────────────────────────────────────────────────────────────────────
step "4 · gov repo protect apply"
PROT_OUT="$(xino "$C" "" gov repo protect apply --repo "$R" --gov-home . 2>&1)" && ok "gov repo protect apply exited 0" \
  || { printf '%s\n' "$PROT_OUT" | tail -15; die "gov repo protect apply failed"; }
if [ "$DRY" = 1 ] || [ -n "$(git -C "$C" status --porcelain)" ]; then
  x git -C "$C" add -A && x git -C "$C" commit -qm "gov repo protect apply" && x git -C "$C" push -q origin "$DEF" || die "could not push protect's workflow"
fi

# ── 5. gov check install on the sandbox code repo ───────────────────────────────────────────────────────────────
step "5 · gov check install on $R_APP (a throwaway branch)"
if [ "$DRY" != 1 ] && ! gh api "repos/$R_APP" >/dev/null 2>&1; then
  skip "5 — $R_APP is not readable (create it once in the sandbox, or set BRIDGE_APP_REPO)"
else
  A="$ROOT/app"
  x git clone -q "https://github.com/$R_APP.git" "$A" || die "clone $R_APP failed"
  APP_BRANCH="bridge-$RUN_ID"
  x git -C "$A" switch -q -c "$APP_BRANCH"
  mkdir -p "$A/.gov-ci"
  INST_OUT="$(xino "$C" "wrote $A/.github/workflows/gov-checks.yml" gov check install --repo "$A" --gov-package ./.gov-ci/gov.tgz --gov-home . 2>&1)" \
    || { printf '%s\n' "$INST_OUT" | tail -15; die "gov check install (code repo) failed"; }
  expect "gov check install wrote the code repo's gov-checks.yml" grep -q "gov-checks.yml" <<<"$INST_OUT"
  expect "the code repo's gov-checks.yml asks for the sandbox's runner $RUNS_ON" grep -qF "runs-on: $RUNS_ON" "$A/.github/workflows/gov-checks.yml"
  x cp "$GOV_TARBALL" "$A/.gov-ci/gov.tgz"
  x git -C "$A" add -A && x git -C "$A" commit -qm "gov checks (bridge journey $RUN_ID)" && x git -C "$A" push -q -u origin "$APP_BRANCH" \
    || die "could not push $R_APP@$APP_BRANCH"
  ok "$R_APP@$APP_BRANCH carries the rendered workflow"
fi

# ── 6. gov doctor: ok ────────────────────────────────────────────────────────────────────────────────────────────
step "6 · gov doctor on the migrated copy"
x gov org add "$E2E_ORG" --home "$C" >/dev/null && x gov org use "$E2E_ORG" >/dev/null || die "gov org add/use failed"
DOC_RC=0; DOC_OUT="$(xino "$C" "gov doctor: ok" gov doctor --gov-home . 2>&1)" || DOC_RC=$?
expect "gov doctor exited 0 on the migrated copy (exit $DOC_RC)" test "$DOC_RC" -eq 0
expect "gov doctor says ok" grep -qi "ok" <<<"$DOC_OUT"

# ── 7. join → work → task → merge in the copy ───────────────────────────────────────────────────────────────────
step "7 · journey in the copy: seed → join → work → task → merge"
BOARD_URL="$(xo "https://github.com/orgs/$E2E_ORG/projects/1" gh project create --owner "$E2E_ORG" --title "bridge-$RUN_ID" --format json --jq .url)" || die "project create failed"
BOARD="${BOARD_URL##*/}"
ISSUE="$(xo "https://github.com/$R_APP/issues/1" gh issue create --repo "$R_APP" --title "bridge journey $RUN_ID" --body "the rehearsal's journey")" || die "issue create failed"
x gh project item-add "$BOARD" --owner "$E2E_ORG" --url "$ISSUE" >/dev/null || die "could not link the issue to the board"
SEED_OUT="$(xino "$C" "  workspace: $ROOT/home/.gov/work/PRJ-$BOARD-bridge" gov seed "$BOARD_URL" "$LOGIN" 2>&1)" || { printf '%s\n' "$SEED_OUT" | tail -10; die "gov seed failed"; }
expect "gov seed created the project branch BRNCH-$BOARD-*" grep -q "BRNCH-$BOARD" <<<"$SEED_OUT"
# JOIN from a second machine: a fresh HOME, the same org, the project someone else started.
J_HOME="$ROOT/home2"; mkdir -p "$J_HOME"
JOIN_OUT="$(HOME="$J_HOME" xino "$C" "joined" gov join "$BOARD_URL" 2>&1)" || { printf '%s\n' "$JOIN_OUT" | tail -10; die "gov join failed"; }
ok "gov join cloned the project's repos in a second work root"
PID="$(grep -oE "PRJ-$BOARD-[A-Za-z0-9-]+" <<<"$SEED_OUT" | head -1 || true)"
if [ -z "$PID" ]; then [ "$DRY" = 1 ] && PID="PRJ-$BOARD-bridge" || die "gov seed did not name the project (PRJ-$BOARD-…)"; fi
WORK_OUT="$(xino "$C" "session-start" gov work "$PID" --print-prompt 2>&1)" || { printf '%s\n' "$WORK_OUT" | tail -10; die "gov work --print-prompt failed"; }
expect "gov work printed the session-start prompt for $PID" test -n "$WORK_OUT"
PWR="$(sed -n 's/^  workspace: //p' <<<"$SEED_OUT" | head -1)"; PWR="${PWR/#\~/$HOME}"
WS="$PWR/${R#*/}"
TASK_OUT="$(xino "$WS" "ISSUE-1" gov task "$ISSUE" 2>&1)" || { printf '%s\n' "$TASK_OUT" | tail -10; die "gov task failed"; }
expect "gov task opened a sub-branch" grep -q "ISSUE-" <<<"$TASK_OUT"
if [ "$DRY" = 1 ]; then printf '  + commit a change on the task sub-branch in %s\n' "$PWR/${R_APP#*/}" >&3
else echo "bridge change $RUN_ID" >>"$PWR/${R_APP#*/}/BRIDGE.md"; ( cd "$PWR/${R_APP#*/}" && git add -A && git commit -qm "bridge journey: a change (closes #${ISSUE##*/})" ); fi
MERGE_OUT="$(xino "$WS" "merged" gov merge "$ISSUE" 2>&1)" || { printf '%s\n' "$MERGE_OUT" | tail -10; die "gov merge failed"; }
expect "gov merge closed the issue" test "$(xo CLOSED gh issue view "$ISSUE" --json state --jq .state)" = CLOSED

# ── 8. gov-cicd, a dry run against the migrated copy ────────────────────────────────────────────────────────────
step "8 · gov-cicd dry run against the migrated copy (knowledge/deployment untouched)"
if [ -z "${GOV_CICD_PACKAGE:-}" ]; then
  skip "8 — GOV_CICD_PACKAGE not set (the gov-cicd package or tarball to install)"
else
  x npm i -g "$GOV_CICD_PACKAGE" >/dev/null 2>&1 || die "could not install $GOV_CICD_PACKAGE"
  CAT_OUT="$(xino "$C" '[{"id":"dry-unit"}]' gov-cicd catalog --json 2>&1)" || { printf '%s\n' "$CAT_OUT" | tail -10; die "gov-cicd catalog failed on the migrated copy"; }
  UNIT="${BRIDGE_CICD_UNIT:-$(node -e 'const j=JSON.parse(process.argv[1]); const a=Array.isArray(j)?j:(j.units||[]); console.log((a[0]&&(a[0].id||a[0].name))||"")' "$CAT_OUT" 2>/dev/null || true)}"
  expect "gov-cicd reads the copy's catalog (${UNIT:-no unit})" test -n "$UNIT"
  DEP_OUT="$(xino "$C" "deploy (dry-run): ok" gov-cicd deploy "$UNIT" --env dev --dry-run 2>&1)" || { printf '%s\n' "$DEP_OUT" | tail -10; die "gov-cicd deploy --dry-run failed on the migrated copy"; }
  ok "gov-cicd deploy $UNIT --env dev --dry-run: exit 0"
fi
