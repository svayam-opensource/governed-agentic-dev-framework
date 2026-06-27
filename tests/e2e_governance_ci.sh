#!/usr/bin/env bash
# tests/e2e_governance_ci.sh — P6 governance E2E for CI, against an ORG sandbox.
#
# Self-provisions a throwaway GitHub Project board + a code repo + an anchor issue
# in $TESTBED_SANDBOX_ORG (assigned to the bot), then runs the existing
# full-lifecycle smoke (e2e_smoke.sh: create ws repo -> setup -> seed -> list ->
# task -> merge -> close) against that board, and tears the board + repo down.
#
# Driven entirely by the bot: a hands-off "day-to-day governance" run. Gated by
# the caller (e2e.yml) on $TESTBED_BOT_PAT being present.
#
# Requires: $GH_TOKEN (bot PAT: repo, project, read:org, delete_repo),
#           $TESTBED_SANDBOX_ORG (e.g. svayam-e2e). Bot must be an org owner.
set -uo pipefail

: "${GH_TOKEN:?GH_TOKEN (bot PAT) required}"
ORG="${TESTBED_SANDBOX_ORG:?TESTBED_SANDBOX_ORG required}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${GITHUB_RUN_ID:-manual-$(date +%s)}"
CODE_REPO="$ORG/prj-e2e-gov-$STAMP"          # throwaway code repo (holds the anchor + task issues)
BOARD_NUM=""; BOARD_URL=""; ANCHOR_URL=""
BOT="$(gh api user --jq .login 2>/dev/null || echo "")"
[[ -n "$BOT" ]] || { echo "FATAL: GH_TOKEN does not resolve to a GitHub login"; exit 1; }
echo "bot identity: $BOT · sandbox org: $ORG · run: $STAMP"

teardown() {
  local rc=$?
  set +e
  echo "::group::teardown"
  [[ -n "$BOARD_NUM" ]] && gh project delete "$BOARD_NUM" --owner "$ORG" 2>/dev/null && echo "deleted board #$BOARD_NUM"
  gh repo delete "$CODE_REPO" --yes 2>/dev/null && echo "deleted $CODE_REPO" \
    || gh repo archive "$CODE_REPO" --yes 2>/dev/null  # archive if delete_repo scope is missing
  echo "::endgroup::"
  exit $rc
}
trap teardown EXIT

# ── Provision the throwaway fixture in the org ────────────────────────────────
echo "== provision code repo + anchor issue + board =="
gh repo create "$CODE_REPO" --private --add-readme >/dev/null \
  || { echo "FATAL: could not create $CODE_REPO (bot needs repo create in $ORG)"; exit 1; }

# anchor label + a linked anchor issue, assigned to the bot
gh label create anchor --repo "$CODE_REPO" --color FBCA04 --force >/dev/null 2>&1 || true
ANCHOR_URL="$(gh issue create --repo "$CODE_REPO" --title "Anchor: prj-e2e $STAMP" \
  --body "Scope/anchor issue for the prj governance E2E. Throwaway." 2>/dev/null)"
[[ -n "$ANCHOR_URL" ]] || { echo "FATAL: anchor issue create failed"; exit 1; }
gh issue edit "$ANCHOR_URL" --add-label anchor --add-assignee "$BOT" >/dev/null 2>&1 || true

# org board, link the anchor issue
BOARD_URL="$(gh project create --owner "$ORG" --title "prj-e2e $STAMP" --format json 2>/dev/null \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("url",""))')"
[[ -n "$BOARD_URL" ]] || { echo "FATAL: board create failed (bot needs project scope/owner in $ORG)"; exit 1; }
BOARD_NUM="$(printf '%s' "$BOARD_URL" | sed -nE 's#.*/projects/([0-9]+).*#\1#p')"
gh project item-add "$BOARD_NUM" --owner "$ORG" --url "$ANCHOR_URL" >/dev/null 2>&1 \
  || { echo "FATAL: could not link anchor issue to board"; exit 1; }
echo "provisioned: board $BOARD_URL (#$BOARD_NUM) · anchor $ANCHOR_URL · repo $CODE_REPO"

# ── Run the full-lifecycle smoke against the org fixture ──────────────────────
echo "== run e2e_smoke (org overrides) =="
SMOKE_GH_LOGIN="$BOT" \
SMOKE_TEST_OWNER="$ORG" \
SMOKE_TEST_OWNER_TYPE="org" \
SMOKE_FIXTURE_PROJECT_URL="$BOARD_URL" \
SMOKE_FIXTURE_REPO_BRANCH="main" \
SMOKE_SKIP_PHASE1=1 \
  bash "$REPO_ROOT/tests/e2e_smoke.sh" --always-clean
rc=$?
[[ $rc -eq 0 ]] && echo "✓ P6 governance E2E passed" || echo "✗ P6 governance E2E failed (rc=$rc)"
exit $rc
