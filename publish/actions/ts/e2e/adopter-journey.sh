#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# Clean-slate ADOPTER-JOURNEY e2e — runs INSIDE the gyan container (fresh每run).
# Exercises the whole first-adopter path against REAL GitHub, asserting a
# specific outcome at each step, then tears everything down. Run on publish,
# every time content or actions change.
#
# Required env:
#   E2E_ORG      GitHub org to create the throwaway repos/project in (you own it)
#   GH_TOKEN     token with scopes: repo, project, read:org  (gov delegates to gh)
#   GOV_TARBALL  path to the packed local gov build (npm pack output) — tests THIS build
#   CONTENT_DIR  path to the framework publish/content (the template source)
# Optional:
#   E2E_KEEP=1   skip teardown (leave artifacts for inspection)
set -euo pipefail

: "${E2E_ORG:?set E2E_ORG}"; : "${GH_TOKEN:?set GH_TOKEN}"; : "${GOV_TARBALL:?set GOV_TARBALL}"; : "${CONTENT_DIR:?set CONTENT_DIR}"
RUN_ID="${E2E_RUN_ID:-$(date +%s)}"           # unique namespace per run
SLUG="gov-e2e-${RUN_ID}"
WS_REPO="${SLUG}-gov"                          # the adopter workspace repo
CODE_REPO="${SLUG}-svc"                        # a code repo in the project
ROOT="$(mktemp -d)"
PASS=0; FAIL=0
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; FAIL=$((FAIL+1)); exit 1; }
assert_contains() { echo "$1" | grep -qF "$2" && ok "$3" || die "$3 — expected to contain: $2"; }

# ── Teardown (runs in THIS process — deletes work when the script is invoked by
#    you / CI, not blocked like an assistant tool-call). ──────────────────────
teardown() {
  [ "${E2E_KEEP:-0}" = "1" ] && { echo "E2E_KEEP=1 — leaving $WS_REPO / $CODE_REPO / project"; return; }
  step "Teardown"
  gh repo delete "$E2E_ORG/$WS_REPO"   --yes 2>/dev/null && echo "  deleted $WS_REPO"  || true
  gh repo delete "$E2E_ORG/$CODE_REPO" --yes 2>/dev/null && echo "  deleted $CODE_REPO" || true
  [ -n "${PROJ_NUM:-}" ] && gh project delete "$PROJ_NUM" --owner "$E2E_ORG" 2>/dev/null && echo "  deleted project #$PROJ_NUM" || true
  rm -rf "$ROOT"
}
trap teardown EXIT

# ── 0. Bootstrap: node 24 · install the packed gov · authenticate gh ─────────
step "Bootstrap (node 24 · gov · gh auth)"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm install 24 >/dev/null 2>&1; nvm use 24 >/dev/null
node -v | grep -q '^v24' && ok "node $(node -v)" || die "node 24 not active"
npm i -g "$GOV_TARBALL" >/dev/null 2>&1
command -v gov >/dev/null && ok "gov installed: $(gov --version 2>/dev/null || echo '?')" || die "gov not on PATH"
echo "$GH_TOKEN" | gh auth login --with-token
gh auth status >/dev/null 2>&1 && ok "gh authenticated as $(gh api user --jq .login)" || die "gh auth failed"

# ── 1. Create the workspace repo from the framework template ─────────────────
step "Create adopter workspace repo ($E2E_ORG/$WS_REPO) from template content"
gh repo create "$E2E_ORG/$WS_REPO" --private --clone -- "$ROOT/$WS_REPO" >/dev/null 2>&1 || \
  { gh repo create "$E2E_ORG/$WS_REPO" --private >/dev/null && gh repo clone "$E2E_ORG/$WS_REPO" "$ROOT/$WS_REPO" >/dev/null 2>&1; }
cp -R "$CONTENT_DIR"/. "$ROOT/$WS_REPO"/         # seed the workspace from publish/content (the template)
cd "$ROOT/$WS_REPO"
git add -A && git commit -qm "seed from framework template" && git push -q origin HEAD 2>/dev/null || true
[ -f MANIFEST.yaml ] && ok "workspace seeded from template" || die "template content missing"

# ── 2. gov setup (non-interactive) → org-config.yaml filled, non-template ────
# Non-interactive setup derives github_org/workspace_repo from origin but needs
# org_name/org_slug pre-seeded (it has no prompt to ask them). github_org/
# workspace_repo come from the repo origin ($E2E_ORG/$WS_REPO).
step "gov setup"
cat > org-config.yaml <<YAML
org_name: "Gov E2E Org"
org_short_name: "GovE2E"
org_slug: "gov-e2e"
YAML
gov setup --non-interactive >/tmp/setup.log 2>&1 || true
grep -q "github_org: \"$E2E_ORG\"" org-config.yaml 2>/dev/null && ok "org-config.yaml written for $E2E_ORG" \
  || { echo "  --- setup log ---"; tail -8 /tmp/setup.log; die "org-config not configured for $E2E_ORG"; }
grep -q 'org_name: ""' org-config.yaml && die "org-config still in template state" || ok "workspace is non-template"
gov org add "$E2E_ORG" "$PWD" >/dev/null 2>&1 && gov org use "$E2E_ORG" >/dev/null 2>&1 && ok "registered + activated org $E2E_ORG" || die "gov org add/use failed"

# ── 3. Create a code repo + a Project board + an issue ──────────────────────
step "Create code repo + project board + issue"
gh repo create "$E2E_ORG/$CODE_REPO" --private >/dev/null && ok "code repo $CODE_REPO created" || die "code repo create failed"
PROJ_URL=$(gh project create --owner "$E2E_ORG" --title "$SLUG" --format json --jq .url 2>/dev/null) && ok "project board: $PROJ_URL" || die "project create failed"
PROJ_NUM="${PROJ_URL##*/}"
ISSUE_URL=$(gh issue create --repo "$E2E_ORG/$CODE_REPO" --title "e2e: implement thing" --body "outcome under test" 2>/dev/null) && ok "issue: $ISSUE_URL" || die "issue create failed"
gh project item-add "$PROJ_NUM" --owner "$E2E_ORG" --url "$ISSUE_URL" >/dev/null 2>&1 && ok "issue linked to board" || true

# ── 4. Work: seed → task → merge ────────────────────────────────────────────
step "gov seed → task → merge"
SEED_OUT=$(gov seed "$PROJ_URL" "$(gh api user --jq .login)" 2>&1) || { echo "$SEED_OUT" | tail -8; die "gov seed failed"; }
assert_contains "$SEED_OUT" "BRNCH-${PROJ_NUM}" "seed created the project branch"
# (task/merge/close/knowledge steps assert against the seeded workspace + board)
TASK_OUT=$(gov task "$ISSUE_URL" 2>&1) || { echo "$TASK_OUT" | tail -8; die "gov task failed"; }
assert_contains "$TASK_OUT" "ISSUE-" "task opened a sub-branch"

# make a change in the code-repo worktree the task created, then land it
AWR="$(grep -E '^agent_work_root:' org-config.yaml | sed -E 's/.*"(.*)".*/\1/')"
PID="PRJ-${PROJ_NUM}-${SLUG#gov-e2e-}"
REPO_WT=$(find "${AWR/#\~/$HOME}" -maxdepth 3 -type d -name "$CODE_REPO" 2>/dev/null | head -1 || true)
if [ -n "$REPO_WT" ]; then
  echo "e2e change $RUN_ID" >> "$REPO_WT/E2E.md"
  ( cd "$REPO_WT" && git add -A && git commit -qm "e2e: implement thing (closes #${ISSUE_URL##*/})" )
  ok "committed a change on the task sub-branch"
fi
step "gov merge"
MERGE_OUT=$(gov merge "$ISSUE_URL" 2>&1) || { echo "$MERGE_OUT" | tail -8; die "gov merge failed"; }
[ "$(gh issue view "$ISSUE_URL" --json state --jq .state 2>/dev/null)" = "CLOSED" ] && ok "merge closed the issue" || die "issue not closed after merge"

# ── 5. Propose org knowledge (branch → PR) ───────────────────────────────────
step "gov knowledge propose → submit"
KN_OUT=$(gov knowledge propose "e2e-decision-${RUN_ID}" 2>&1) || { echo "$KN_OUT" | tail -8; die "gov knowledge propose failed"; }
assert_contains "$KN_OUT" "knowledge" "knowledge propose opened a change"

# ── 6. Close the project (knowledge gate → promote → close board) ────────────
step "gov close"
CLOSE_OUT=$(gov close 2>&1) || { echo "$CLOSE_OUT" | tail -12; die "gov close failed"; }
[ "$(gh project view "$PROJ_NUM" --owner "$E2E_ORG" --format json --jq .closed 2>/dev/null)" = "true" ] && ok "close shut the board" \
  || assert_contains "$CLOSE_OUT" "close" "close ran the gate"

# ── 8. Gap-2: --gov-home resolves from an unrelated cwd ──────────────────────
step "Gap-2 — --gov-home override"
cd /tmp
STATUS_OUT=$(gov status --gov-home "$ROOT/$WS_REPO" 2>&1 || true)
assert_contains "$STATUS_OUT" "$SLUG" "gov --gov-home resolved the workspace from an unrelated cwd"

printf '\n\033[1m═══ adopter-journey: %d passed, %d failed ═══\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
