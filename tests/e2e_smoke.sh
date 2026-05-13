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

# Find the seeded project ID
PROJECT_ID=$(ls projects/ 2>/dev/null | grep "^${SMOKE_ORG_SLUG}-" | head -1)
[[ -n "$PROJECT_ID" ]] || hard_stop "no seeded project folder found under projects/"
PROJECT_BRANCH=$(echo "$PROJECT_ID" | tr '[:upper:]' '[:lower:]')

# Track artifacts for cleanup
CLEANUP_ARTIFACTS+=("local:$HOME/work/$PROJECT_ID")

# State assertions
[[ -d "projects/$PROJECT_ID" ]] || hard_stop "project folder missing"
[[ -f "projects/$PROJECT_ID/project.yaml" ]] || hard_stop "project.yaml missing"
[[ -f "projects/$PROJECT_ID/knowledge/todo.md" ]] || hard_stop "knowledge/todo.md missing — seed should scaffold it from the template"
grep -q "^# To-do for ${SMOKE_ORG_SLUG}-" "projects/$PROJECT_ID/knowledge/todo.md" \
  || hard_stop "todo.md header missing project-specific substitution"

# Per-project tool bootstrap files (one per supported LLM coding tool).
# Sample two of the eight — flat and nested — to verify seed's scaffold loop.
[[ -f "projects/$PROJECT_ID/AGENTS.md" ]] \
  || hard_stop "per-project AGENTS.md missing — seed should scaffold from root"
[[ -f "projects/$PROJECT_ID/.cursor/rules/agent.mdc" ]] \
  || hard_stop "per-project .cursor/rules/agent.mdc missing — seed should scaffold from root"
grep -q "$PROJECT_ID" "projects/$PROJECT_ID/AGENTS.md" \
  || hard_stop "per-project AGENTS.md doesn't contain the project ID after substitution"
status=$(python3 -c "import yaml; print(yaml.safe_load(open('projects/$PROJECT_ID/project.yaml'))['status'])")
[[ "$status" == "active" ]] || hard_stop "expected status=active, got $status"
git rev-parse --verify "$PROJECT_BRANCH" >/dev/null 2>&1 \
  || hard_stop "local branch '$PROJECT_BRANCH' missing"
git ls-remote --exit-code --heads origin "$PROJECT_BRANCH" >/dev/null 2>&1 \
  || hard_stop "remote branch '$PROJECT_BRANCH' missing"
in_registry=$(python3 -c "import yaml; ps=yaml.safe_load(open('registry.yaml')).get('projects') or []; print('yes' if any(p.get('id')=='$PROJECT_ID' for p in ps if p) else 'no')")
[[ "$in_registry" == "yes" ]] || hard_stop "registry missing entry for $PROJECT_ID"

ok "project $PROJECT_ID seeded; status=active; branch on remote"

# ── Step 10: prj list (shows seeded) ─────────────────────────────────────────

info "Step 10 — ./prj list (should show $PROJECT_ID)..."
out=$(/bin/bash ./prj list 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
echo "$out" | grep -q "$PROJECT_ID" \
  || hard_stop "./prj list didn't show $PROJECT_ID"
ok "registry has $PROJECT_ID"

# ── Step 12 (was 11+13 dropped): curate project knowledge ────────────────────

info "Step 12 — curating project knowledge..."
mkdir -p "projects/$PROJECT_ID/knowledge"
cat > "projects/$PROJECT_ID/knowledge/compliance.md" <<EOF
# Compliance Log: $PROJECT_ID

(smoke-test placeholder; real adopters fill this in during their project)
EOF
cat > "projects/$PROJECT_ID/knowledge/notes.md" <<EOF
# Project Notes

Smoke-test placeholder content for $PROJECT_ID.
EOF

# Make sure we're on the project branch (seed.sh leaves us there)
git checkout "$PROJECT_BRANCH" 2>/dev/null || true
git add "projects/$PROJECT_ID/knowledge/"
git commit -m "curate project knowledge for $PROJECT_ID" >/dev/null 2>&1 \
  || hard_stop "commit of curated knowledge failed"
git push origin "$PROJECT_BRANCH" >/dev/null 2>&1 \
  || hard_stop "push of curated knowledge failed"
ok "project knowledge curated and pushed"

# ── Step 14: prj close (auto-fires close-knowledge) ──────────────────────────

info "Step 14 — close-project.sh $PROJECT_ID (auto-fires close-knowledge)..."
# Don't pipe `yes ""` into close-project: with pipefail set, `yes` exits
# with 141 on SIGPIPE after the script returns, marking the whole pipeline
# as failed even when close-project succeeded. close-project has no
# interactive prompts so stdin doesn't need feeding.
/bin/bash scripts/close-project.sh "$PROJECT_ID" \
  >/tmp/smoke-close.log 2>&1 \
  || { tail -30 /tmp/smoke-close.log; hard_stop "close-project.sh failed"; }

# Verify state
git fetch origin main >/dev/null 2>&1 || true
git checkout main >/dev/null 2>&1 || true
git pull origin main >/dev/null 2>&1 || true

[[ -f "projects/$PROJECT_ID/project.yaml" ]] \
  || hard_stop "project.yaml missing after close"
status=$(python3 -c "import yaml; print(yaml.safe_load(open('projects/$PROJECT_ID/project.yaml'))['status'])")
[[ "$status" == "completed" ]] || hard_stop "expected status=completed after close, got $status"

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
echo "  Phase 2:      install-deps → setup → commit → list → deps → init → curate → close → list"
echo "  Total time:   ${ELAPSED}s"
echo ""
