#!/usr/bin/env bash
# tests/e2e_smoke.sh — End-to-end smoke test for the framework.
#
# Two phases:
#   Phase 1 — internal correctness on the publish branch's source
#   Phase 2 — adopter-flow daily-work sequence on a fresh template clone
#
# Invoked by scripts/release-to-public.sh as a pre-tag gate.
# Can also be run standalone for development.
#
# Usage:
#   bash tests/e2e_smoke.sh                  # default: fail-fast + preserve on failure
#   bash tests/e2e_smoke.sh --always-clean   # for CI / automation: cleanup regardless
#   bash tests/e2e_smoke.sh --success-clean  # cleanup on success only (default)
#
# Prerequisites:
#   - GH_TOKEN env var set to admin@svayam.ai's PAT (see tests/e2e_config.env
#     for the expected gh login)
#   - PAT scopes: repo, delete_repo, read:org, project
#   - Fixture GitHub Project pre-existing (see SMOKE_FIXTURE_PROJECT_URL)
#   - /bin/bash (3.2 on macOS) — the smoke test deliberately uses stock bash
#     to catch bash-4-only idioms in framework scripts
#
# Two phases:
#   Phase 1 (~10s): runs in-place on the publish branch source.
#     - Validators, existing test suite, /bin/bash -n on every script,
#       and a runtime smoke (no-args invoke) of every script under /bin/bash.
#   Phase 2 (~3-5min): full adopter flow on a fresh throwaway test repo.
#     - gh repo create --template; clone; install-deps; pre-fill org-config;
#       setup; commit/push; prj list/deps; seed against fixture project;
#       curate knowledge; close project (auto-fires close-knowledge);
#       cleanup.

set -uo pipefail

# ── Flags ─────────────────────────────────────────────────────────────────────

ALWAYS_CLEAN=false
SUCCESS_CLEAN=false   # default: preserve on failure, clean on success

while [[ $# -gt 0 ]]; do
  case "$1" in
    --always-clean)  ALWAYS_CLEAN=true ;;
    --success-clean) SUCCESS_CLEAN=true ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //;s/^#//' | head -40
      exit 0
      ;;
    *) echo "Unknown flag: $1"; exit 2 ;;
  esac
  shift
done

# ── Paths and config ──────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$REPO_ROOT/tests/e2e_config.env"
[[ -f "$CONFIG" ]] || { echo "ERROR: $CONFIG not found"; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"

# ── Output helpers ────────────────────────────────────────────────────────────

BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; DIM='\033[2m'; NC='\033[0m'
ok()      { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  !${NC} $*" >&2; }
err()     { echo -e "${RED}  ✗${NC} $*" >&2; }
info()    { echo -e "${CYAN}  →${NC} $*"; }
header()  { echo ""; echo -e "${BOLD}${CYAN}$*${NC}"; }
hard_stop() { err "$*"; echo ""; SMOKE_OK=0; exit 1; }

# ── State for cleanup ─────────────────────────────────────────────────────────

SMOKE_OK=0
TEST_REPO=""
TEST_REPO_NAME=""
TEST_CLONE=""
PROJECT_ID=""
PROJECT_BRANCH=""
CLEANUP_ARTIFACTS=()  # entries: type:value (repo:owner/name | branch:owner/name:branch | tag:owner/name:tag | local:path)

START_TIME=$(date +%s)

# ── Cleanup ──────────────────────────────────────────────────────────────────

do_cleanup() {
  if [[ ${#CLEANUP_ARTIFACTS[@]} -eq 0 ]] && [[ -z "$TEST_CLONE" ]]; then
    return 0
  fi
  info "Cleaning up..."
  for entry in "${CLEANUP_ARTIFACTS[@]}"; do
    case "${entry%%:*}" in
      repo)
        gh repo delete "${entry#repo:}" --yes 2>/dev/null || true
        ;;
      branch)
        local rest="${entry#branch:}"
        local owner_repo="${rest%%:*}"
        local branch_name="${rest##*:}"
        # gh api emits 404 bodies on stdout; redirect both streams.
        gh api -X DELETE "/repos/$owner_repo/git/refs/heads/$branch_name" >/dev/null 2>&1 || true
        ;;
      tag)
        local rest="${entry#tag:}"
        local owner_repo="${rest%%:*}"
        local tag_name="${rest##*:}"
        gh api -X DELETE "/repos/$owner_repo/git/refs/tags/$tag_name" >/dev/null 2>&1 || true
        ;;
      local)
        rm -rf "${entry#local:}"
        ;;
    esac
  done
  [[ -n "$TEST_CLONE" ]] && rm -rf "$TEST_CLONE"
}

on_exit() {
  local exit_code=$?
  if $ALWAYS_CLEAN; then
    do_cleanup
  elif [[ "$SMOKE_OK" == "1" ]]; then
    # Success: cleanup unless --no-clean (we don't have one; default is clean)
    do_cleanup
  else
    # Failure
    if $SUCCESS_CLEAN; then
      # User asked clean only on success — preserve on failure
      :
    fi
    if [[ ${#CLEANUP_ARTIFACTS[@]} -gt 0 ]] || [[ -n "$TEST_CLONE" ]]; then
      echo ""
      err "Smoke test failed (exit $exit_code). State preserved for inspection:"
      for a in "${CLEANUP_ARTIFACTS[@]}"; do echo "    - $a"; done
      [[ -n "$TEST_CLONE" ]] && echo "    Local clone: $TEST_CLONE"
      echo ""
      echo "  Run cleanup when ready:"
      echo "    bash tests/e2e_cleanup.sh ${TEST_REPO_NAME}"
    fi
  fi
}
trap on_exit EXIT

# ════════════════════════════════════════════════════════════════════════════
# Phase 1: Internal correctness
# ════════════════════════════════════════════════════════════════════════════

if [[ -n "${SMOKE_SKIP_PHASE1:-}" ]]; then
  info "Phase 1 skipped (SMOKE_SKIP_PHASE1 set — e.g. CI already runs validators + bats in the matrix)"
else
header "Phase 1: Internal correctness (publish branch source)"

cd "$REPO_ROOT"

info "1.1 — validators"
python3 scripts/validate/run.py >/dev/null 2>&1 \
  || hard_stop "Validators failed. Run: python3 scripts/validate/run.py"
ok "validators pass"

info "1.2 — existing test suite (tests/run-all.sh)"
bash tests/run-all.sh >/dev/null 2>&1 \
  || hard_stop "tests/run-all.sh failed. Run it manually for details."
ok "tests/ pass"

info "1.3 — /bin/bash -n syntax check on every shell script"
SCRIPTS_TO_CHECK=(prj setup.sh)
while IFS= read -r f; do
  SCRIPTS_TO_CHECK+=("$f")
done < <(find scripts tests -name '*.sh' 2>/dev/null)
for f in "${SCRIPTS_TO_CHECK[@]}"; do
  [[ -f "$f" ]] || continue
  /bin/bash -n "$f" 2>&1 \
    || hard_stop "syntax error in $f under /bin/bash. Run: /bin/bash -n $f"
done
ok "all scripts parse under /bin/bash"

info "1.4 — runtime smoke (each script invoked under /bin/bash, no args)"
RUNTIME_SCRIPTS=(prj setup.sh)
while IFS= read -r f; do
  # Skip lib.sh (sourced, not invoked); skip install-deps (it has side effects on no-args)
  case "$(basename "$f")" in
    lib.sh|install-deps.sh) continue ;;
  esac
  RUNTIME_SCRIPTS+=("$f")
done < <(find scripts -maxdepth 2 -name '*.sh' 2>/dev/null)
for f in "${RUNTIME_SCRIPTS[@]}"; do
  [[ -f "$f" ]] || continue
  output=$(/bin/bash "$f" 2>&1 || true)
  if echo "$output" | grep -qiE "bad substitution|invalid option|unbound variable|syntax error"; then
    err "$f failed runtime smoke under /bin/bash:"
    echo "$output" | sed 's/^/    /' | head -20
    hard_stop "Runtime smoke failed for $f"
  fi
done
ok "all scripts run cleanly under /bin/bash 3.2"

ok "Phase 1 complete ($(($(date +%s) - START_TIME))s elapsed)"
fi

# ════════════════════════════════════════════════════════════════════════════
# Phase 2: Adopter flow
# ════════════════════════════════════════════════════════════════════════════

header "Phase 2: Adopter flow (daily-work sequence)"

# ── Identity preflight ───────────────────────────────────────────────────────

[[ -n "${GH_TOKEN:-}" ]] || hard_stop "GH_TOKEN env var not set.
    Source the maintainer's smoke-test env first, e.g.: source ~/.svayam-smoke.env"

ACTIVE=$(gh api user --jq .login 2>/dev/null || echo "")
[[ -n "$ACTIVE" ]] || hard_stop "gh api user failed — GH_TOKEN may be invalid"
[[ "$ACTIVE" == "$SMOKE_GH_LOGIN" ]] \
  || hard_stop "GH_TOKEN points to '$ACTIVE'; expected '$SMOKE_GH_LOGIN'"
ok "gh authenticated as $ACTIVE (matches expected $SMOKE_GH_LOGIN)"

# ── Pre-clean: remove stale smoke artifacts from linked fixture repos ────────
#
# The smoke creates branches like 'smk-NNN-...' and archive tags like
# 'archive/smk-NNN-...' on every repo linked to the fixture Project (e.g.
# svayam-rkant/sanskriti). The throwaway test repo is deleted at end of
# each run (which cascades its branches+tags), but the *linked* repos are
# real repos belonging to other projects — we can't delete them. So we
# must scrub their smoke debris between runs, or close-project will fail
# the next time it tries to archive against a tag that already exists.

info "Pre-clean — scrubbing stale smoke artifacts from fixture-linked repos..."
# Direction A: all project branches use the literal "brnch-" prefix.
SMOKE_PREFIX="brnch-"
FIXTURE_PROJ_NUM=$(echo "$SMOKE_FIXTURE_PROJECT_URL" | sed 's|.*/projects/||')
LINKED_REPOS=$(gh project item-list "$FIXTURE_PROJ_NUM" --owner "$SMOKE_TEST_OWNER" \
  --format json --limit 50 2>/dev/null \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
seen = set()
for it in d.get('items', []):
    c = it.get('content', {})
    url = c.get('url', '')
    if '/issues/' in url or '/pull/' in url:
        repo = url.rsplit('/issues/', 1)[0].rsplit('/pull/', 1)[0]
        owner_repo = repo.replace('https://github.com/', '')
        if owner_repo not in seen:
            seen.add(owner_repo)
            print(owner_repo)
" 2>/dev/null)

for owner_repo in $LINKED_REPOS; do
  # Delete stale branches matching the smoke prefix
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    gh api -X DELETE "repos/$owner_repo/git/refs/heads/$branch" >/dev/null 2>&1 \
      && info "  cleaned branch $owner_repo:$branch"
  done < <(gh api "repos/$owner_repo/branches" --jq '.[].name' 2>/dev/null \
            | grep "^${SMOKE_PREFIX}" || true)

  # Delete stale archive tags matching the smoke prefix
  while IFS= read -r tag; do
    [[ -z "$tag" ]] && continue
    gh api -X DELETE "repos/$owner_repo/git/refs/tags/$tag" >/dev/null 2>&1 \
      && info "  cleaned tag $owner_repo:$tag"
  done < <(gh api "repos/$owner_repo/tags" --jq '.[].name' 2>/dev/null \
            | grep "^archive/${SMOKE_PREFIX}" || true)
done
ok "fixture-linked repos clean"

# ── Step 1: create empty test repo + push local publish HEAD into it ─────────
#
# CRITICAL: we do NOT use `gh repo create --template <public template>` here.
# That would test the *already-published* template, not the local publish
# branch state we're about to release. A pre-release gate must test the
# code that is about to ship — so we push local publish HEAD into a fresh
# empty repo and use that as the test workspace.

TIMESTAMP=$(date +%s)
TEST_REPO_NAME="${SMOKE_REPO_PREFIX}${TIMESTAMP}"
TEST_REPO="$SMOKE_TEST_OWNER/$TEST_REPO_NAME"

info "Step 1 — creating empty test repo $TEST_REPO..."
gh repo create "$TEST_REPO" \
  --description "ADF e2e smoke test (auto-generated; safe to delete)" \
  --private 2>&1 | tail -1 \
  || hard_stop "gh repo create failed"
CLEANUP_ARTIFACTS+=("repo:$TEST_REPO")
ok "test repo created: $TEST_REPO"

info "Step 1b — pushing local publish HEAD ($(cd "$REPO_ROOT" && git rev-parse --short HEAD)) to $TEST_REPO as main..."
_PUSH_URL="https://github.com/$TEST_REPO.git"
if ( cd "$REPO_ROOT" && git push "$_PUSH_URL" "HEAD:main" ) >/dev/null 2>&1; then
  ok "local publish HEAD pushed to $TEST_REPO/main"
else
  # A repo-scoped PAT (no `workflow` scope) cannot push ANY commit that touches
  # .github/workflows/* — and pushing the full history into the empty test repo
  # replays every historical commit, including ones that added workflows. So
  # retry as a SINGLE ORPHAN commit of the tree minus .github/workflows: no
  # history ⇒ no pushed commit touches a workflow file. The throwaway workspace
  # exercises the governance lifecycle, not CI, so the workflows aren't needed.
  # Keeps the bot PAT at least-privilege (`repo` scope only).
  warn "direct push rejected — retrying as a single orphan commit without .github/workflows"
  _WT="$(mktemp -d)"
  _rc=0
  ( cd "$REPO_ROOT" && git worktree add -q --detach "$_WT" HEAD ) || _rc=1
  if [[ $_rc -eq 0 ]]; then
    (
      cd "$_WT" || exit 1
      git checkout -q --orphan _e2e_pub || exit 1
      rm -rf .github/workflows
      git add -A || exit 1
      git -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email 2>/dev/null || echo e2e@local)}" \
          -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name 2>/dev/null || echo prj-e2e)}" \
          commit -q -m "e2e: publish HEAD ($(git -C "$REPO_ROOT" rev-parse --short HEAD), CI workflows stripped)" || exit 1
      git push "$_PUSH_URL" "HEAD:main" || exit 1
    ) >/dev/null 2>&1 || _rc=1
    ( cd "$REPO_ROOT" && git worktree remove --force "$_WT" ) >/dev/null 2>&1 || rm -rf "$_WT"
  fi
  [[ $_rc -eq 0 ]] || hard_stop "git push of publish HEAD to test repo failed (even after stripping .github/workflows)"
  ok "local publish HEAD (minus CI workflows, orphan commit) pushed to $TEST_REPO/main"
fi

# Brief pause so GitHub registers the default branch
sleep 2

# ── Step 2: git clone ─────────────────────────────────────────────────────────

TEST_CLONE="/tmp/$TEST_REPO_NAME"
info "Step 2 — git clone to $TEST_CLONE..."
git clone "https://github.com/$TEST_REPO.git" "$TEST_CLONE" 2>&1 | tail -1 \
  || hard_stop "git clone failed"
cd "$TEST_CLONE"

# Verify essential files present
ESSENTIAL_FILES=(
  scripts/lib.sh
  scripts/seed.sh
  scripts/install-deps.sh
  scripts/validate/run.py
  prj
  setup.sh
  README.md
  org-config.yaml
)
for f in "${ESSENTIAL_FILES[@]}"; do
  [[ -f "$f" ]] || hard_stop "missing essential file in template clone: $f"
done
ok "essential files present"

# ── Step 3: install-deps ──────────────────────────────────────────────────────

info "Step 3 — bash scripts/install-deps.sh --check..."
/bin/bash scripts/install-deps.sh --check >/dev/null 2>&1 \
  || hard_stop "install-deps --check failed"
ok "install-deps passes"

# ── Step 4: pre-fill org-config.yaml ─────────────────────────────────────────

info "Step 4 — pre-filling org-config.yaml with smoke values..."
SMOKE_ORG_SLUG_LOWER=$(echo "$SMOKE_ORG_SLUG" | tr '[:upper:]' '[:lower:]')
SMOKE_AGENT_WORK_ROOT="$HOME/.${SMOKE_ORG_SLUG_LOWER}/projects"
cat > org-config.yaml <<EOF
org_name: "$SMOKE_ORG_NAME"
org_short_name: "$SMOKE_ORG_SHORT"
org_slug: "$SMOKE_ORG_SLUG"
org_slug_lower: "$SMOKE_ORG_SLUG_LOWER"
org_repo_url: "https://github.com/$TEST_REPO.git"
github_org: "$SMOKE_TEST_OWNER"
workspace_repo: "$TEST_REPO_NAME"
default_branch: "main"
default_code_branch: "$SMOKE_FIXTURE_REPO_BRANCH"
agent_work_root: "$SMOKE_AGENT_WORK_ROOT"
policy_owner_email: "$SMOKE_POLICY_OWNER_EMAIL"
policy_owner_github: "@$SMOKE_GH_LOGIN"
legal_owner_github: "@$SMOKE_GH_LOGIN"
infra_owner_github: "@$SMOKE_GH_LOGIN"
system_arch_owner_github: "@$SMOKE_GH_LOGIN"
data_arch_owner_github: "@$SMOKE_GH_LOGIN"
policy_effective_date: "$(date +%Y-%m-%d)"
EOF
ok "org-config.yaml written"

# ── Step 5: setup.sh --non-interactive ───────────────────────────────────────

info "Step 5 — SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 setup.sh --non-interactive..."
SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 \
  /bin/bash setup.sh --non-interactive >/dev/null 2>&1 \
  || hard_stop "setup.sh failed"
# Direction A: the validator's placeholder check is always-on; no flag needed.
# Any leftover {{...}} would fail it.
python3 scripts/validate/run.py >/dev/null 2>&1 \
  || hard_stop "validators failed after setup"
ok "setup complete; validators pass"

# ── Step 6: commit + push ─────────────────────────────────────────────────────

# Configure git author for the smoke test (overrides maintainer's global)
git config user.email "$SMOKE_POLICY_OWNER_EMAIL"
git config user.name "Svayam Smoke Test"

info "Step 6 — commit + push configured workspace..."
git add -A
git commit -m "configure framework for smoke test" >/dev/null 2>&1 \
  || hard_stop "git commit failed"
git push origin main >/dev/null 2>&1 \
  || hard_stop "git push failed"
ok "configured workspace pushed to $TEST_REPO"

# ── Step 7: prj list (empty) ─────────────────────────────────────────────────

info "Step 7 — ./prj list (fresh workspace)..."
out=$(/bin/bash ./prj list 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
if [[ -n "${SMOKE_SKIP_EMPTY_LIST:-}" ]]; then
  # Org-sandbox mode: the fixture board is PROVISIONED by the harness, so it
  # legitimately shows as an active project here. The real fresh-workspace
  # invariant is that no project FOLDERS exist locally yet (seed creates them in
  # Step 9). Just assert prj list ran cleanly + the local workspace is clean.
  echo "$out" | grep -qiE "ongoing projects|no projects found" \
    || hard_stop "prj list did not run cleanly:
$out"
  [[ -z "$(ls -d projects/PRJ-*/ 2>/dev/null)" ]] \
    || hard_stop "fresh workspace already has project folder(s) before seed"
  ok "prj list runs; local workspace clean (pre-seed)"
else
  echo "$out" | grep -qi "no projects found" \
    || hard_stop "prj list output didn't say 'No projects found':
$out"
  ok "registry is empty"
fi

# ── Step 8: prj deps ──────────────────────────────────────────────────────────

info "Step 8 — ./prj deps..."
/bin/bash ./prj deps >/dev/null 2>&1 \
  || hard_stop "./prj deps failed"
ok "deps verified"

# ── Step 9: seed (prj init) against fixture ──────────────────────────────────

info "Step 9 — seed against fixture project $SMOKE_FIXTURE_PROJECT_URL..."
/bin/bash scripts/seed.sh --non-interactive \
  "$SMOKE_FIXTURE_PROJECT_URL" "$SMOKE_POLICY_OWNER_EMAIL" \
  >/tmp/smoke-init.log 2>&1 \
  || { tail -30 /tmp/smoke-init.log; hard_stop "seed.sh failed"; }

# Find the seeded project ID from the project FOLDER stub on the default branch
# (registry-elimination: there is no registry entry; seed scaffolds
# projects/<PID>/ on main + an anchor issue on GitHub). The fixture workspace
# started empty (Step 7), so the single PRJ-* folder is the one just seeded.
PROJECT_ID=$(basename "$(ls -d projects/PRJ-*/ 2>/dev/null | head -1)" 2>/dev/null)
[[ -n "$PROJECT_ID" ]] || hard_stop "no PRJ-* project folder after seed"
PROJECT_BRANCH="BRNCH-${PROJECT_ID#PRJ-}"

PROJECT_WORK_ROOT="$SMOKE_AGENT_WORK_ROOT/$PROJECT_ID"
ORG_GOV_CLONE="$PROJECT_WORK_ROOT/$TEST_REPO_NAME"

# Track per-project workspace for cleanup
CLEANUP_ARTIFACTS+=("local:$PROJECT_WORK_ROOT")

# Direction A invariant: home workspace must stay on default branch
HOME_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$HOME_BRANCH" == "main" ]] \
  || hard_stop "home workspace switched to '$HOME_BRANCH' — should have stayed on main"

# Home has the stub folder on the default branch (no registry entry — GitHub is
# the project SoT; registry-elimination Increment 2).
[[ -d "projects/$PROJECT_ID" ]] || hard_stop "stub folder projects/$PROJECT_ID/ missing on home main"
[[ -f "projects/$PROJECT_ID/.gitkeep" ]] || hard_stop "stub .gitkeep missing"

# Per-project workspace has full content on the project branch
[[ -d "$ORG_GOV_CLONE" ]] \
  || hard_stop "per-project ORG GOV clone missing at $ORG_GOV_CLONE"
[[ -f "$ORG_GOV_CLONE/projects/$PROJECT_ID/project.yaml" ]] \
  || hard_stop "project.yaml missing in per-project workspace"
[[ -f "$ORG_GOV_CLONE/projects/$PROJECT_ID/knowledge/todo.md" ]] \
  || hard_stop "todo.md missing in per-project workspace"
grep -q "^# To-do for ${PROJECT_ID}" "$ORG_GOV_CLONE/projects/$PROJECT_ID/knowledge/todo.md" \
  || hard_stop "todo.md header missing per-project substitution"

# Per-project tool bootstrap files
[[ -f "$ORG_GOV_CLONE/projects/$PROJECT_ID/AGENTS.md" ]] \
  || hard_stop "per-project AGENTS.md missing in per-project workspace"
[[ -f "$ORG_GOV_CLONE/projects/$PROJECT_ID/.cursor/rules/agent.mdc" ]] \
  || hard_stop "per-project .cursor/rules/agent.mdc missing"
grep -q "$PROJECT_ID" "$ORG_GOV_CLONE/projects/$PROJECT_ID/AGENTS.md" \
  || hard_stop "per-project AGENTS.md doesn't contain project ID after substitution"

status=$(python3 -c "import yaml; print(yaml.safe_load(open('$ORG_GOV_CLONE/projects/$PROJECT_ID/project.yaml'))['status'])")
[[ "$status" == "active" ]] || hard_stop "expected status=active in per-project workspace, got $status"

# Project branch lives on per-project workspace and on remote (not home)
( cd "$ORG_GOV_CLONE" && git rev-parse --verify "$PROJECT_BRANCH" >/dev/null 2>&1 ) \
  || hard_stop "project branch '$PROJECT_BRANCH' missing in per-project workspace"
git ls-remote --exit-code --heads origin "$PROJECT_BRANCH" >/dev/null 2>&1 \
  || hard_stop "remote branch '$PROJECT_BRANCH' missing on workspace repo"

ok "project $PROJECT_ID seeded; home stayed on main; per-project workspace ready"

# ── Step 10: prj list (shows seeded) ─────────────────────────────────────────

info "Step 10 — ./prj list (should show $PROJECT_ID)..."
out=$(/bin/bash ./prj list 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
echo "$out" | grep -q "$PROJECT_ID" \
  || hard_stop "./prj list didn't show $PROJECT_ID"
ok "prj list (GitHub-derived) shows $PROJECT_ID"

# ── Step 11: task lifecycle (create-task → work on sub-branch → merge-task) ───

info "Step 11 — task lifecycle (create → commit → merge)..."

TASK_REPO_URL=$(python3 -c "import yaml; r=yaml.safe_load(open('$ORG_GOV_CLONE/projects/$PROJECT_ID/project.yaml')).get('repos') or []; print(((r[0] or {}).get('url') if r else '') or '')")
[[ -n "$TASK_REPO_URL" ]] || hard_stop "no code repo in project.yaml repos[] to host a task issue"
TASK_REPO_SLUG=$(echo "$TASK_REPO_URL" | sed 's|https://github.com/||; s|\.git$||')

TASK_TITLE="SMK smoke task $TIMESTAMP"
ISSUE_URL=$(gh issue create --repo "$TASK_REPO_SLUG" --title "$TASK_TITLE" \
  --body "Auto-generated by tests/e2e_smoke.sh; closed by merge-task. Safe to delete." 2>/tmp/smoke-issue.log) \
  || { cat /tmp/smoke-issue.log; hard_stop "gh issue create failed on $TASK_REPO_SLUG"; }
ISSUE_NUM="${ISSUE_URL##*/}"
CLEANUP_ARTIFACTS+=("issue:$TASK_REPO_SLUG:$ISSUE_NUM")
ok "issue created: $ISSUE_URL"

gh project item-add "$FIXTURE_PROJ_NUM" --owner "$SMOKE_TEST_OWNER" --url "$ISSUE_URL" >/dev/null 2>&1 \
  && info "  issue added to fixture board" || info "  (issue not added to board — board status is best-effort)"

( cd "$ORG_GOV_CLONE" && /bin/bash scripts/create-task.sh "$PROJECT_ID" "$ISSUE_URL" "$SMOKE_GH_LOGIN" ) \
  >/tmp/smoke-task.log 2>&1 \
  || { tail -30 /tmp/smoke-task.log; hard_stop "create-task.sh failed"; }

TASK_BRANCH=$(git -C "$ORG_GOV_CLONE" ls-remote --heads origin "${PROJECT_BRANCH}.*" 2>/dev/null \
  | awk '{print $2}' | sed 's|refs/heads/||' | head -1)
[[ -n "$TASK_BRANCH" ]] || hard_stop "create-task did not create a '${PROJECT_BRANCH}.*' sub-branch"
CLEANUP_ARTIFACTS+=("tag:$TASK_REPO_SLUG:archive/$TASK_BRANCH")
ok "task sub-branch created: $TASK_BRANCH"

git -C "$ORG_GOV_CLONE" checkout "$TASK_BRANCH" >/dev/null 2>&1 || hard_stop "could not checkout $TASK_BRANCH"
echo "task work for $ISSUE_URL" > "$ORG_GOV_CLONE/projects/$PROJECT_ID/knowledge/task-note.md"
git -C "$ORG_GOV_CLONE" add "projects/$PROJECT_ID/knowledge/task-note.md"
git -C "$ORG_GOV_CLONE" commit -m "task work on $TASK_BRANCH" >/dev/null 2>&1 || hard_stop "commit on task sub-branch failed"
git -C "$ORG_GOV_CLONE" push origin "$TASK_BRANCH" >/dev/null 2>&1 || hard_stop "push of task sub-branch failed"
ok "work committed + pushed on $TASK_BRANCH"

( cd "$ORG_GOV_CLONE" && /bin/bash scripts/merge-task.sh "$PROJECT_ID" "$ISSUE_URL" ) \
  >/tmp/smoke-merge.log 2>&1 \
  || { tail -30 /tmp/smoke-merge.log; hard_stop "merge-task.sh failed"; }

git -C "$ORG_GOV_CLONE" fetch origin --prune >/dev/null 2>&1 || true
git -C "$ORG_GOV_CLONE" ls-remote --exit-code --heads origin "$TASK_BRANCH" >/dev/null 2>&1 \
  && hard_stop "task sub-branch '$TASK_BRANCH' still on remote after merge-task"
ISTATE=$(gh issue view "$ISSUE_URL" --json state -q '.state' 2>/dev/null || echo "")
[[ "$ISTATE" == "CLOSED" ]] || hard_stop "issue not CLOSED after merge-task (state=$ISTATE)"
git -C "$ORG_GOV_CLONE" checkout "$PROJECT_BRANCH" >/dev/null 2>&1 || true
git -C "$ORG_GOV_CLONE" pull --ff-only origin "$PROJECT_BRANCH" >/dev/null 2>&1 || true
[[ -f "$ORG_GOV_CLONE/projects/$PROJECT_ID/knowledge/task-note.md" ]] \
  || hard_stop "task work not present on project branch after merge"
ok "task merged: sub-branch archived, issue closed, work landed on '$PROJECT_BRANCH'"

# ── Step 12: curate project knowledge (inside per-project workspace) ─────────

info "Step 12 — curating project knowledge (per-project workspace, project branch)..."
mkdir -p "$ORG_GOV_CLONE/projects/$PROJECT_ID/knowledge"
cat > "$ORG_GOV_CLONE/projects/$PROJECT_ID/knowledge/compliance.md" <<EOF
# Compliance Log: $PROJECT_ID

(smoke-test placeholder; real adopters fill this in during their project)
EOF
cat > "$ORG_GOV_CLONE/projects/$PROJECT_ID/knowledge/notes.md" <<EOF
# Project Notes

Smoke-test placeholder content for $PROJECT_ID.
EOF

( cd "$ORG_GOV_CLONE" \
  && git add "projects/$PROJECT_ID/knowledge/" \
  && git commit -m "curate project knowledge for $PROJECT_ID" >/dev/null 2>&1 \
  && git push origin "$PROJECT_BRANCH" >/dev/null 2>&1 ) \
  || hard_stop "curate-knowledge commit/push failed in per-project workspace"
ok "project knowledge curated and pushed on $PROJECT_BRANCH"

# ── Step 14: prj close (auto-fires close-knowledge) — from per-project workspace ──

info "Step 14 — close-project.sh $PROJECT_ID (from per-project workspace)..."
( cd "$ORG_GOV_CLONE" \
  && /bin/bash scripts/close-project.sh "$PROJECT_ID" >/tmp/smoke-close.log 2>&1 ) \
  || { tail -30 /tmp/smoke-close.log; hard_stop "close-project.sh failed"; }

# close-project promotes the project folder to main via a PR AND removes the
# per-project workspace (registry-elimination + workspace cleanup). Pull main to
# home so we can verify the promoted state.
( cd "$TEST_CLONE" \
  && git fetch origin main >/dev/null 2>&1 \
  && git pull --ff-only origin main >/dev/null 2>&1 ) || true
cd "$TEST_CLONE"

# The per-project workspace must have been removed by close.
[[ ! -d "$ORG_GOV_CLONE" ]] \
  || warn "per-project workspace $ORG_GOV_CLONE still present after close (cleanup may have warned)"

# project.yaml (now on main via the close PR) records status=completed.
status=$(python3 -c "import yaml; print(yaml.safe_load(open('projects/$PROJECT_ID/project.yaml'))['status'])" 2>/dev/null)
[[ "$status" == "completed" ]] || hard_stop "expected status=completed on main after close, got '$status'"

# Knowledge close branch should exist
KNOWLEDGE_BRANCH="${PROJECT_BRANCH}-knowledge"
if git ls-remote --exit-code --heads origin "$KNOWLEDGE_BRANCH" >/dev/null 2>&1; then
  CLEANUP_ARTIFACTS+=("branch:$TEST_REPO:$KNOWLEDGE_BRANCH")
  ok "knowledge-close branch raised"
else
  warn "knowledge-close branch '$KNOWLEDGE_BRANCH' not found — close-knowledge may have skipped"
fi

# Archive tag should exist
CLEANUP_ARTIFACTS+=("tag:$TEST_REPO:archive/$PROJECT_BRANCH")

ok "project $PROJECT_ID closed; status=completed"

# ── Step 15: prj list (shows completed) ──────────────────────────────────────

# Board is closed at close → 'prj list' (ongoing only) hides it; 'prj list-all'
# shows it as completed (GitHub-derived).
info "Step 15 — ./prj list-all (should show $PROJECT_ID as completed)..."
out=$(/bin/bash ./prj list-all 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
echo "$out" | grep -q "$PROJECT_ID" \
  || hard_stop "./prj list-all missing $PROJECT_ID"
echo "$out" | grep -qi "completed" \
  || warn "./prj list-all output doesn't show 'completed' status (may render differently)"
ok "$PROJECT_ID listed as completed (GitHub-derived)"

# ── Done ──────────────────────────────────────────────────────────────────────

SMOKE_OK=1
ELAPSED=$(($(date +%s) - START_TIME))

echo ""
echo -e "${BOLD}${GREEN}✓ Smoke test passed${NC}"
echo ""
echo "Summary:"
echo "  Test repo:    $TEST_REPO"
echo "  Project:      $PROJECT_ID"
echo "  Phase 1:      validators + tests + bash 3.2 syntax + runtime smoke"
echo "  Phase 2:      install-deps → setup → commit → list → deps → init → curate → close → list"
echo "  Total time:   ${ELAPSED}s"
echo ""
