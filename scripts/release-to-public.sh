#!/usr/bin/env bash
# scripts/release-to-public.sh
#
# Cuts a new release of the Agentic Development Framework from the publish
# branch. The release process is:
#
#   1. Run the end-to-end smoke test (gate — non-bypassable except by
#      explicit confirmation).
#   2. Verify we're on publish, clean, and up to date with origin.
#   3. Tag publish at HEAD with the requested version.
#   4. Push the tag to origin (this updates the public template repo's
#      releases page).
#
# Usage:
#   bash scripts/release-to-public.sh vX.Y.Z
#   bash scripts/release-to-public.sh --skip-smoke vX.Y.Z   # emergency only
#
# Run this from the publish branch. The script will refuse to run from
# any other branch.
#
# After this script succeeds, the maintainer still needs to:
#   - sync publish → main (bash scripts/sync-from-publish.sh)
#   - run scripts/mirror-to-public.sh or push the publish branch to the
#     public Svayamtech/agentic-development-framework remote

set -uo pipefail

# ── Output helpers (self-contained — we don't source lib.sh because on the
# publish branch, org-config.yaml is full of {{PLACEHOLDERS}} which trips
# lib.sh's load_config) ──────────────────────────────────────────────────────

BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()      { echo -e "${CYAN}  →${NC} $*"; }
ok()        { echo -e "${GREEN}  ✓${NC} $*"; }
warn()      { echo -e "${YELLOW}  !${NC} $*" >&2; }
err()       { echo -e "${RED}  ✗${NC} $*" >&2; }
header()    { echo ""; echo -e "${BOLD}${CYAN}$*${NC}"; }
hard_stop() { err "$*"; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Flag parsing ──────────────────────────────────────────────────────────────

SKIP_SMOKE=false
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-smoke) SKIP_SMOKE=true ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //;s/^#//' | head -30
      exit 0
      ;;
    v*.*.*) VERSION="$1" ;;
    *) hard_stop "Unknown arg: $1 (expected vX.Y.Z or --skip-smoke)" ;;
  esac
  shift
done

[[ -n "$VERSION" ]] || hard_stop "Missing version. Usage: bash $0 vX.Y.Z"

# Validate semver shape
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || hard_stop "Version '$VERSION' is not a vX.Y.Z semver tag."

# ── Pre-conditions ────────────────────────────────────────────────────────────

cd "$REPO_ROOT"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT_BRANCH" == "publish" ]] \
  || hard_stop "Run from 'publish' (currently on '$CURRENT_BRANCH')."

[[ -z "$(git status --porcelain)" ]] \
  || hard_stop "Uncommitted changes present. Commit or stash first."

if git rev-parse --verify "refs/tags/$VERSION" >/dev/null 2>&1; then
  hard_stop "Tag '$VERSION' already exists locally. Pick a higher version."
fi

if git ls-remote --exit-code --tags origin "refs/tags/$VERSION" >/dev/null 2>&1; then
  hard_stop "Tag '$VERSION' already exists on origin. Pick a higher version."
fi

info "Fetching latest from origin..."
git fetch origin publish --tags >/dev/null 2>&1 \
  || hard_stop "git fetch failed"

LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/publish)
[[ "$LOCAL_SHA" == "$REMOTE_SHA" ]] \
  || hard_stop "Local publish ($LOCAL_SHA) is not in sync with origin/publish ($REMOTE_SHA). Push or pull first."

ok "on publish, clean, in sync with origin"

# ── Phase 1: smoke gate ──────────────────────────────────────────────────────

header "Release gate: end-to-end smoke test"

if $SKIP_SMOKE; then
  warn "WARNING: --skip-smoke specified. The smoke test gates exist to catch"
  warn "regressions that the per-test suites do not. Skipping is for emergencies"
  warn "(e.g., the smoke fixture itself is broken upstream). The last 4 releases"
  warn "all needed hotfix-on-hotfix because we shipped without this gate."
  echo ""
  read -p "  Type 'SKIP-SMOKE' verbatim to confirm bypass: " confirm
  [[ "$confirm" == "SKIP-SMOKE" ]] || hard_stop "Bypass not confirmed. Aborting."
  warn "Smoke skipped by maintainer confirmation."
else
  info "Running tests/e2e_smoke.sh --always-clean..."
  echo ""
  bash "$REPO_ROOT/tests/e2e_smoke.sh" --always-clean \
    || hard_stop "Smoke test failed. Fix the regression before releasing $VERSION."
  ok "smoke passed"
fi

# ── Phase 2: tag publish ──────────────────────────────────────────────────────

header "Tagging $VERSION on publish at $LOCAL_SHA"

git tag -a "$VERSION" -m "Release $VERSION

Tagged via scripts/release-to-public.sh from publish branch.
Smoke test: $($SKIP_SMOKE && echo 'SKIPPED (maintainer override)' || echo 'passed')
" \
  || hard_stop "git tag failed"
ok "tag $VERSION created locally"

# ── Phase 3: push tag to origin ──────────────────────────────────────────────

info "Pushing tag $VERSION to origin..."
if git push origin "$VERSION" >/dev/null 2>&1; then
  ok "tag pushed to origin"
else
  err "git push origin $VERSION failed."
  err "The tag exists locally but isn't published. To recover:"
  err "  git tag -d $VERSION                  # remove local tag, then retry"
  err "  bash scripts/release-to-public.sh $VERSION"
  exit 1
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}✓ Released $VERSION${NC}"
echo ""
echo "Next steps for the maintainer:"
echo "  1. Sync publish → main:"
echo "       git checkout main"
echo "       bash scripts/sync-from-publish.sh"
echo ""
echo "  2. Mirror publish to the public template repo:"
echo "       (run your mirror script, or push publish + tag to the public remote)"
echo ""
echo "  3. (Optional) Create a GitHub Release on the public repo:"
echo "       gh release create $VERSION --notes-from-tag --repo Svayamtech/agentic-development-framework"
echo ""
