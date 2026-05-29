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
#   - PAT scopes: repo, workflow, delete_repo, read:org, project
#       (workflow is required because the gov repo contains .github/workflows/;
#        GitHub rejects PAT pushes touching workflow files without it)
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
#       task + merge (create-task → sub-branch commit → merge-task);
#       join (separate gov root); curate knowledge; close project
#       (auto-fires close-knowledge); cleanup.

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
      issue)
        # Issues can't be deleted via API — close them so no open smoke issues
        # linger on the (real) linked code repo. Idempotent if already closed.
        local rest="${entry#issue:}"
        local owner_repo="${rest%%:*}"
        local issue_num="${rest##*:}"
        gh issue close "https://github.com/$owner_repo/issues/$issue_num" >/dev/null 2>&1 || true
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
  # Skip lib.sh (sourced, not invoked); skip scripts that mutate state on no-args
  # (install-deps installs; render-harness regenerates the per-tool files).
  case "$(basename "$f")" in
    lib.sh|install-deps.sh|render-harness.sh) continue ;;
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
SMOKE_PREFIX=$(echo "$SMOKE_ORG_SLUG" | tr '[:upper:]' '[:lower:]')-
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
( cd "$REPO_ROOT" && git push "https://github.com/$TEST_REPO.git" "HEAD:main" ) \
  >/dev/null 2>&1 \
  || hard_stop "git push of publish HEAD to test repo failed"
ok "local publish HEAD pushed to $TEST_REPO/main"

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
cat > org-config.yaml <<EOF
org_name: "$SMOKE_ORG_NAME"
org_short_name: "$SMOKE_ORG_SHORT"
org_slug: "$SMOKE_ORG_SLUG"
org_slug_lower: "$(echo "$SMOKE_ORG_SLUG" | tr '[:upper:]' '[:lower:]')"
github_org: "$SMOKE_TEST_OWNER"
workspace_repo: "$TEST_REPO_NAME"
default_branch: "main"
default_code_branch: "$SMOKE_FIXTURE_REPO_BRANCH"
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

info "Step 5 — SETUP_SKIP_GITHUB_VERIFY=1 /bin/bash setup.sh --non-interactive..."
SETUP_SKIP_GITHUB_VERIFY=1 /bin/bash setup.sh --non-interactive >/dev/null 2>&1 \
  || hard_stop "setup.sh failed"
# Verify substitution: STRICT_PLACEHOLDERS catches any leftover {{...}}
STRICT_PLACEHOLDERS=1 python3 scripts/validate/run.py >/dev/null 2>&1 \
  || hard_stop "validators failed after setup (likely leftover placeholders)"
ok "setup substitution clean; validators pass with STRICT_PLACEHOLDERS=1"

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

info "Step 7 — ./prj list (expect empty)..."
out=$(/bin/bash ./prj list 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
echo "$out" | grep -qi "no projects found" \
  || hard_stop "prj list output didn't say 'No projects found':
$out"
ok "registry is empty"

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

# Option 2: seed authors the registry index entry on the DEFAULT branch and
# leaves TEST_CLONE (the gov clone) on main; the scaffold + per-project clones
# live under $PRJ_GOV_LOC/projects/<PID>/. Find the project via the registry.
PGL="${PRJ_GOV_LOC:-$HOME/prj_gov}"
PROJECT_ID=$(python3 -c "import yaml; ps=yaml.safe_load(open('registry.yaml')).get('projects') or []; a=[p['id'] for p in ps if p and p.get('status')=='active' and str(p.get('id','')).startswith('${SMOKE_ORG_SLUG}-')]; print(a[-1] if a else '')")
[[ -n "$PROJECT_ID" ]] || hard_stop "no active ${SMOKE_ORG_SLUG}- project in registry.yaml on main (read fix?)"
PROJECT_BRANCH=$(echo "$PROJECT_ID" | tr '[:upper:]' '[:lower:]')
PRJDIR="$PGL/projects/$PROJECT_ID"
PGOV="$PRJDIR/$TEST_REPO_NAME"
SF="$PGOV/projects/$PROJECT_ID"

# Track artifacts for cleanup
CLEANUP_ARTIFACTS+=("local:$PRJDIR")

# Registry-on-main assertions (the read fix): entry present + carries assigned_to
in_registry=$(python3 -c "import yaml; ps=yaml.safe_load(open('registry.yaml')).get('projects') or []; print('yes' if any(p.get('id')=='$PROJECT_ID' for p in ps if p) else 'no')")
[[ "$in_registry" == "yes" ]] || hard_stop "registry (on main) missing entry for $PROJECT_ID"
reg_assigned=$(python3 -c "import yaml; ps=yaml.safe_load(open('registry.yaml')).get('projects') or []; e=[p for p in ps if p and p.get('id')=='$PROJECT_ID']; print(e[0].get('assigned_to','') if e else '')")
[[ -n "$reg_assigned" ]] || hard_stop "registry entry for $PROJECT_ID missing assigned_to (read fix?)"

# Per-project gov clone (PRJ_GOV) on the project branch, carrying the scaffold
[[ -d "$PGOV/.git" ]] || hard_stop "PRJ_GOV clone missing at $PGOV"
gb=$(git -C "$PGOV" rev-parse --abbrev-ref HEAD 2>/dev/null)
[[ "$gb" == "$PROJECT_BRANCH" ]] || hard_stop "PRJ_GOV not on $PROJECT_BRANCH (got $gb)"
[[ -f "$SF/project.yaml" ]] || hard_stop "project.yaml missing in PRJ_GOV scaffold"
[[ -f "$SF/knowledge/todo.md" ]] || hard_stop "knowledge/todo.md missing in PRJ_GOV scaffold"
grep -q "^# To-do for ${SMOKE_ORG_SLUG}-" "$SF/knowledge/todo.md" \
  || hard_stop "todo.md header missing project-specific substitution"
[[ -f "$SF/AGENTS.md" ]] || hard_stop "per-project AGENTS.md missing in PRJ_GOV scaffold"
[[ -f "$SF/.cursor/rules/agent.mdc" ]] || hard_stop "per-project .cursor/rules/agent.mdc missing"
grep -q "$PROJECT_ID" "$SF/AGENTS.md" || hard_stop "per-project AGENTS.md missing project ID after substitution"
status=$(python3 -c "import yaml; print(yaml.safe_load(open('$SF/project.yaml'))['status'])")
[[ "$status" == "active" ]] || hard_stop "expected status=active in PRJ_GOV, got $status"
seeded=$(python3 -c "import yaml; print(yaml.safe_load(open('$SF/project.yaml')).get('seeded_by') or '')")
[[ -n "$seeded" ]] || hard_stop "project.yaml missing seeded_by (ownership refactor)"

# Code clones live under repos/
[[ -d "$PRJDIR/repos" ]] || hard_stop "repos/ dir missing under $PRJDIR"

# Remote project branch exists (pushed by seed)
git -C "$PGOV" ls-remote --exit-code --heads origin "$PROJECT_BRANCH" >/dev/null 2>&1 \
  || hard_stop "remote project branch '$PROJECT_BRANCH' missing"

ok "$PROJECT_ID seeded; PRJ_GOV on branch; registry(active+assignee) on main; seeded_by set; repos/ present"

# ── Step 10: prj list (shows seeded) ─────────────────────────────────────────

info "Step 10 — ./prj list (should show $PROJECT_ID)..."
out=$(/bin/bash ./prj list 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
echo "$out" | grep -q "$PROJECT_ID" \
  || hard_stop "./prj list didn't show $PROJECT_ID"
ok "registry has $PROJECT_ID"

# ── Step 11: task lifecycle (create-task → work on sub-branch → merge-task) ───
#
# Tasks-on-board: a task = a GitHub Issue (on a project code repo) + a sub-branch
# named "<project-branch>.<slug>". We create a throwaway issue on the first code
# repo, drive create-task → a commit on the sub-branch → merge-task, and assert
# the sub-branch is archived + the issue closed + the work is on the project branch.

info "Step 11 — task lifecycle (create → commit → merge)..."

TASK_REPO_URL=$(python3 -c "import yaml; r=yaml.safe_load(open('$SF/project.yaml')).get('repos') or []; print(((r[0] or {}).get('url') if r else '') or '')")
[[ -n "$TASK_REPO_URL" ]] || hard_stop "no code repo in project.yaml repos[] to host a task issue"
TASK_REPO_SLUG=$(echo "$TASK_REPO_URL" | sed 's|https://github.com/||; s|\.git$||')

TASK_TITLE="SMK smoke task $TIMESTAMP"
ISSUE_URL=$(gh issue create --repo "$TASK_REPO_SLUG" --title "$TASK_TITLE" \
  --body "Auto-generated by tests/e2e_smoke.sh; closed by merge-task. Safe to delete." 2>/tmp/smoke-issue.log) \
  || { cat /tmp/smoke-issue.log; hard_stop "gh issue create failed on $TASK_REPO_SLUG (does $SMOKE_GH_LOGIN have write access?)"; }
ISSUE_NUM="${ISSUE_URL##*/}"
CLEANUP_ARTIFACTS+=("issue:$TASK_REPO_SLUG:$ISSUE_NUM")
ok "issue created: $ISSUE_URL"

# Best-effort: put the issue on the fixture board so board_set_status has a target.
gh project item-add "$FIXTURE_PROJ_NUM" --owner "$SMOKE_TEST_OWNER" --url "$ISSUE_URL" >/dev/null 2>&1 \
  && info "  issue added to fixture board" || info "  (issue not added to board — board status is best-effort)"

# create-task (run from the PRJ_GOV clone, where work happens)
( cd "$PGOV" && /bin/bash scripts/create-task.sh "$PROJECT_ID" "$ISSUE_URL" "$SMOKE_GH_LOGIN" ) \
  >/tmp/smoke-task.log 2>&1 \
  || { tail -30 /tmp/smoke-task.log; hard_stop "create-task.sh failed"; }

# Discover the sub-branch (don't re-implement slugify): it's the lone "<branch>.*" head.
TASK_BRANCH=$(git -C "$PGOV" ls-remote --heads origin "${PROJECT_BRANCH}.*" 2>/dev/null \
  | awk '{print $2}' | sed 's|refs/heads/||' | head -1)
[[ -n "$TASK_BRANCH" ]] || hard_stop "create-task did not create a '${PROJECT_BRANCH}.*' sub-branch (separator bug?)"
CLEANUP_ARTIFACTS+=("tag:$TASK_REPO_SLUG:archive/$TASK_BRANCH")
ok "task sub-branch created: $TASK_BRANCH"

# Do "work" on the sub-branch in the gov workspace repo, then push.
git -C "$PGOV" checkout "$TASK_BRANCH" >/dev/null 2>&1 || hard_stop "could not checkout $TASK_BRANCH in PRJ_GOV"
echo "task work for $ISSUE_URL" > "$PGOV/projects/$PROJECT_ID/knowledge/task-note.md"
git -C "$PGOV" add "projects/$PROJECT_ID/knowledge/task-note.md"
git -C "$PGOV" commit -m "task work on $TASK_BRANCH" >/dev/null 2>&1 || hard_stop "commit on task sub-branch failed"
git -C "$PGOV" push origin "$TASK_BRANCH" >/dev/null 2>&1 || hard_stop "push of task sub-branch failed"
ok "work committed + pushed on $TASK_BRANCH"

# merge-task (issue-driven; derives the same sub-branch)
( cd "$PGOV" && /bin/bash scripts/merge-task.sh "$PROJECT_ID" "$ISSUE_URL" ) \
  >/tmp/smoke-merge.log 2>&1 \
  || { tail -30 /tmp/smoke-merge.log; hard_stop "merge-task.sh failed"; }

git -C "$PGOV" fetch origin --prune >/dev/null 2>&1 || true
git -C "$PGOV" ls-remote --exit-code --heads origin "$TASK_BRANCH" >/dev/null 2>&1 \
  && hard_stop "task sub-branch '$TASK_BRANCH' still on remote after merge-task (should be archived)"
git -C "$PGOV" ls-remote --exit-code --tags origin "archive/$TASK_BRANCH" >/dev/null 2>&1 \
  || warn "archive tag 'archive/$TASK_BRANCH' not found on workspace remote"
ISTATE=$(gh issue view "$ISSUE_URL" --json state -q '.state' 2>/dev/null || echo "")
[[ "$ISTATE" == "CLOSED" ]] || hard_stop "issue not CLOSED after merge-task (state=$ISTATE)"
git -C "$PGOV" checkout "$PROJECT_BRANCH" >/dev/null 2>&1 || true
git -C "$PGOV" pull --ff-only origin "$PROJECT_BRANCH" >/dev/null 2>&1 || true
[[ -f "$PGOV/projects/$PROJECT_ID/knowledge/task-note.md" ]] \
  || hard_stop "task work not present on project branch after merge"
ok "task merged: sub-branch archived, issue closed, work landed on '$PROJECT_BRANCH'"

# ── Step 11b: prj join (authorized member's own clones, separate gov root) ────
#
# Same authorized identity, but a DIFFERENT governance root — simulates a
# teammate cloning their own PRJ_GOV + code repos for the active project.

info "Step 11b — join into a separate governance root..."
JOIN_ROOT="/tmp/${TEST_REPO_NAME}-join"
CLEANUP_ARTIFACTS+=("local:$JOIN_ROOT")
( cd "$TEST_CLONE" && PRJ_GOV_LOC="$JOIN_ROOT" /bin/bash scripts/join.sh "$PROJECT_ID" ) \
  >/tmp/smoke-join.log 2>&1 \
  || { tail -30 /tmp/smoke-join.log; hard_stop "join.sh failed"; }
JPGOV="$JOIN_ROOT/projects/$PROJECT_ID/$TEST_REPO_NAME"
[[ -d "$JPGOV/.git" ]] || hard_stop "join did not clone PRJ_GOV at $JPGOV"
jb=$(git -C "$JPGOV" rev-parse --abbrev-ref HEAD 2>/dev/null)
[[ "$jb" == "$PROJECT_BRANCH" ]] || hard_stop "joined PRJ_GOV not on $PROJECT_BRANCH (got '$jb')"
[[ -f "$JPGOV/projects/$PROJECT_ID/knowledge/task-note.md" ]] \
  || hard_stop "joined clone missing the merged task work (stale branch?)"
[[ -d "$JOIN_ROOT/projects/$PROJECT_ID/repos" ]] || hard_stop "join did not create repos/ under the join root"
ok "join produced PRJ_GOV on '$PROJECT_BRANCH' (with task work) + repos/ under a separate root"

# ── Step 12 (was 11+13 dropped): curate project knowledge ────────────────────

info "Step 12 — curating project knowledge (in the PRJ_GOV clone)..."
cat > "$SF/knowledge/compliance.md" <<EOF
# Compliance Log: $PROJECT_ID

(smoke-test placeholder; real adopters fill this in during their project)
EOF
cat > "$SF/knowledge/notes.md" <<EOF
# Project Notes

Smoke-test placeholder content for $PROJECT_ID.
EOF

git -C "$PGOV" add "projects/$PROJECT_ID/knowledge/"
git -C "$PGOV" commit -m "curate project knowledge for $PROJECT_ID" >/dev/null 2>&1 \
  || hard_stop "commit of curated knowledge failed"
git -C "$PGOV" push origin "$PROJECT_BRANCH" >/dev/null 2>&1 \
  || hard_stop "push of curated knowledge failed"
ok "project knowledge curated and pushed (from PRJ_GOV)"

# ── Step 14: prj close (auto-fires close-knowledge) ──────────────────────────

info "Step 14 — close-project from the PRJ_GOV clone (auto-fires close-knowledge)..."
# Lifecycle ops run from the per-project gov clone (PRJ_GOV), where project work
# happens. close merges to base + promotes to main via the test-merge gate, then
# flips the registry index entry to completed on main.
( cd "$PGOV" && /bin/bash scripts/close-project.sh "$PROJECT_ID" ) \
  >/tmp/smoke-close.log 2>&1 \
  || { tail -40 /tmp/smoke-close.log; hard_stop "close-project.sh failed"; }

# Verify state on main (TEST_CLONE is the gov clone, resting on main):
git fetch origin main >/dev/null 2>&1 || true
git checkout main >/dev/null 2>&1 || true
git pull origin main >/dev/null 2>&1 || true

# Registry index flips to completed on main (read fix)
reg_status=$(python3 -c "import yaml; ps=yaml.safe_load(open('registry.yaml')).get('projects') or []; e=[p for p in ps if p and p.get('id')=='$PROJECT_ID']; print(e[0].get('status','') if e else 'MISSING')")
[[ "$reg_status" == "completed" ]] || hard_stop "registry status on main != completed after close (got $reg_status)"

# project.yaml merged to main via the test-merge gate
[[ -f "projects/$PROJECT_ID/project.yaml" ]] \
  || hard_stop "project.yaml not merged to main after close"
status=$(python3 -c "import yaml; print(yaml.safe_load(open('projects/$PROJECT_ID/project.yaml'))['status'])")
[[ "$status" == "completed" ]] || hard_stop "project.yaml status on main != completed, got $status"

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

info "Step 15 — ./prj list (should show $PROJECT_ID as completed)..."
out=$(/bin/bash ./prj list 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
echo "$out" | grep -q "$PROJECT_ID" \
  || hard_stop "./prj list missing $PROJECT_ID"
echo "$out" | grep -qi "completed" \
  || warn "./prj list output doesn't show 'completed' status (may render differently)"
ok "$PROJECT_ID listed"

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
echo "  Phase 2:      install-deps → setup → commit → list → deps → init → task → merge → join → curate → close → list"
echo "  Total time:   ${ELAPSED}s"
echo ""
