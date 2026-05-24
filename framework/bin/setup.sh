#!/usr/bin/env bash
# framework/bin/setup.sh
#
# Single entry point for all framework state transitions:
#
#   first-install     no .framework-version, no canonical paths yet
#                     → prompt for org-config values, scaffold everything,
#                       write version marker.
#
#   upgrade           .framework-version present (org is on v0.3.x already)
#                     → fetch previous version for 3-way base, apply manifest
#                       delta with 3-way merges, prompt on conflicts, update
#                       version marker.
#
#   bc-from-pre-v0.3  no .framework-version but canonical paths populated
#                     (org migrating from v0.2.x or earlier)
#                     → apply manifest as 2-way diffs against current files,
#                       extend org-config.yaml schema, write version marker.
#
# Usage:
#   bash framework/bin/setup.sh                  # interactive
#   bash framework/bin/setup.sh --non-interactive  # CI / re-run
#   bash framework/bin/setup.sh --dev            # don't delete framework/ at end
#
# Invariant: at exit, framework/ is gone from working tree (unless --dev).

set -euo pipefail

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK_DIR="$(cd "$BIN_DIR/.." && pwd)"
REPO_ROOT="$(cd "$FRAMEWORK_DIR/.." && pwd)"

source "$BIN_DIR/lib-upgrade.sh"

# ── Deferred cleanup ────────────────────────────────────────────────────────
# Deleting framework/ mid-execution is unsafe (this script lives at
# framework/bin/setup.sh; bash may re-read it after a cleanup). Schedule it
# via EXIT trap and only run on successful completion.
SETUP_SUCCESS=0
_on_exit() {
  if [[ "$SETUP_SUCCESS" == "1" && "$DEV_MODE" == "false" ]]; then
    rm -rf "$FRAMEWORK_DIR"
  fi
}
trap _on_exit EXIT

# ── Args ────────────────────────────────────────────────────────────────────

DEV_MODE=false
NON_INTERACTIVE=false
for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=true ;;
    --non-interactive) NON_INTERACTIVE=true ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //;s/^#//' | head -40
      exit 0
      ;;
    *) hard_stop "Unknown argument: $arg" ;;
  esac
done

# ── Pre-conditions ──────────────────────────────────────────────────────────

[[ -d "$FRAMEWORK_DIR" ]] \
  || hard_stop "framework/ directory missing. Run via: git checkout <version> -- framework/ && bash framework/bin/setup.sh"

[[ -f "$FRAMEWORK_DIR/VERSION" ]] \
  || hard_stop "framework/VERSION missing — corrupted framework checkout"

[[ -f "$FRAMEWORK_DIR/MANIFEST.yaml" ]] \
  || hard_stop "framework/MANIFEST.yaml missing — corrupted framework checkout"

NEW_VERSION=$(cat "$FRAMEWORK_DIR/VERSION")

# ── Detect state ────────────────────────────────────────────────────────────

STATE=$(detect_install_state "$REPO_ROOT")
PREV_VERSION=""
if [[ "$STATE" == "upgrade" ]]; then
  PREV_VERSION=$(cat "$REPO_ROOT/.framework-version")
fi

log_header "Framework setup"
log_info "state:            $STATE"
log_info "framework version: $NEW_VERSION"
[[ -n "$PREV_VERSION" ]] && log_info "current install:   $PREV_VERSION"

# ── First-install: prompt for org-config values ─────────────────────────────

if [[ "$STATE" == "first-install" ]]; then
  if $NON_INTERACTIVE; then
    log_warn "--non-interactive on first-install: skipping prompts, will use defaults"
  else
    log_header "Initial org configuration"
    echo "  Fill in your organization's identity. These values land in"
    echo "  org-config.yaml; framework files reference them at runtime via"
    echo "  <ORG_NAME>, <DEFAULT_BRANCH>, etc."
    echo ""

    _read_or_abort() {
      local __var="$1"
      local __value
      if ! IFS= read -r __value; then
        echo ""; hard_stop "Aborted (no input)."
      fi
      printf -v "$__var" '%s' "$__value"
    }

    printf "  ${BOLD}Organization name${NC}: "; _read_or_abort ORG_NAME_INPUT
    printf "  ${BOLD}Short name${NC}: "; _read_or_abort ORG_SHORT_NAME_INPUT
    while true; do
      printf "  ${BOLD}Slug (uppercase, 2-6 chars)${NC}: "; _read_or_abort ORG_SLUG_INPUT
      [[ "$ORG_SLUG_INPUT" =~ ^[A-Z][A-Z0-9]{1,5}$ ]] && break
      log_err "Slug must be 2-6 uppercase letters/digits starting with a letter (e.g. ACME)."
    done
    printf "  ${BOLD}Org repo URL${NC} (git@github.com:...): "; _read_or_abort ORG_REPO_URL_INPUT
    printf "  ${BOLD}Policy owner email${NC}: "; _read_or_abort POLICY_OWNER_EMAIL_INPUT
    printf "  ${BOLD}Policy owner GitHub${NC}: "; _read_or_abort POLICY_OWNER_GITHUB_INPUT
    printf "  ${BOLD}Default branch${NC} [main]: "; _read_or_abort DEFAULT_BRANCH_INPUT
    DEFAULT_BRANCH_INPUT="${DEFAULT_BRANCH_INPUT:-main}"
    printf "  ${BOLD}Default code branch${NC} [dev]: "; _read_or_abort DEFAULT_CODE_BRANCH_INPUT
    DEFAULT_CODE_BRANCH_INPUT="${DEFAULT_CODE_BRANCH_INPUT:-dev}"

    ORG_SLUG_LOWER_INPUT=$(echo "$ORG_SLUG_INPUT" | tr '[:upper:]' '[:lower:]')
    GITHUB_ORG_INPUT=$(echo "$ORG_REPO_URL_INPUT" | sed -E 's|.*github.com[:/]([^/]+)/.*|\1|')
    WORKSPACE_REPO_INPUT=$(echo "$ORG_REPO_URL_INPUT" | sed -E 's|.*/([^/]+?)(\.git)?$|\1|')
    AGENT_WORK_ROOT_INPUT="$HOME/.${ORG_SLUG_LOWER_INPUT}/projects"
    TODAY=$(date +%Y-%m-%d)

    cat > "$REPO_ROOT/org-config.yaml" <<EOF
# Agentic Development Framework — Organization Configuration
# Written by framework/bin/setup.sh on first install ($TODAY).

org_name: "$ORG_NAME_INPUT"
org_short_name: "$ORG_SHORT_NAME_INPUT"
org_slug: "$ORG_SLUG_INPUT"
org_slug_lower: "$ORG_SLUG_LOWER_INPUT"
org_repo_url: "$ORG_REPO_URL_INPUT"
github_org: "$GITHUB_ORG_INPUT"
workspace_repo: "$WORKSPACE_REPO_INPUT"
default_branch: "$DEFAULT_BRANCH_INPUT"
default_code_branch: "$DEFAULT_CODE_BRANCH_INPUT"
agent_work_root: "$AGENT_WORK_ROOT_INPUT"
policy_owner_email: "$POLICY_OWNER_EMAIL_INPUT"
policy_owner_github: "$POLICY_OWNER_GITHUB_INPUT"
legal_owner_github: "$POLICY_OWNER_GITHUB_INPUT"
infra_owner_github: "$POLICY_OWNER_GITHUB_INPUT"
system_arch_owner_github: "$POLICY_OWNER_GITHUB_INPUT"
data_arch_owner_github: "$POLICY_OWNER_GITHUB_INPUT"
policy_effective_date: "$TODAY"
EOF
    log_ok "wrote org-config.yaml"
  fi
fi

# ── Apply manifest ──────────────────────────────────────────────────────────

log_header "Applying manifest"

while IFS='|' read -r mode src dst perm; do
  [[ -z "$mode" ]] && continue
  case "$mode" in
    scaffold-auto)
      scaffold_auto "$FRAMEWORK_DIR" "$REPO_ROOT" "$src" "$dst" "$perm"
      ;;
    scaffold-prompt)
      scaffold_prompt "$FRAMEWORK_DIR" "$REPO_ROOT" "$src" "$dst" "$perm" "$PREV_VERSION"
      ;;
    overlay-schema)
      overlay_schema "$FRAMEWORK_DIR" "$REPO_ROOT" "$src" "$dst"
      ;;
    *)
      log_warn "Unknown mode '$mode' for $src — skipping"
      ;;
  esac
done < <(read_manifest "$FRAMEWORK_DIR/MANIFEST.yaml" "$FRAMEWORK_DIR")

# ── Version marker ──────────────────────────────────────────────────────────

write_version_marker "$REPO_ROOT" "$NEW_VERSION"

# ── Done ────────────────────────────────────────────────────────────────────
# framework/ cleanup happens in the EXIT trap (set at the top of this script)
# so we don't yank the rug from under bash mid-read.

log_header "Setup complete"
log_ok "framework at version $NEW_VERSION"
echo ""
echo "Next steps:"
case "$STATE" in
  first-install)
    echo "  1. Review your org-config.yaml: $REPO_ROOT/org-config.yaml"
    echo "  2. Commit + push: git add -A && git commit -m 'configure framework' && git push"
    echo "  3. Start working: ./prj"
    ;;
  upgrade)
    echo "  1. Review changes: git diff HEAD"
    echo "  2. Commit + push: git add -A && git commit -m 'framework: $PREV_VERSION → $NEW_VERSION' && git push"
    ;;
  bc-from-pre-v0.3)
    echo "  1. Review changes carefully — this was a BC migration:  git diff HEAD"
    echo "  2. Commit + push: git add -A && git commit -m 'framework: legacy → $NEW_VERSION' && git push"
    echo ""
    echo "  Future upgrades: ./prj upgrade [version]  (or  bash framework/bin/setup.sh  after a manual checkout)"
    ;;
esac
echo ""

# Mark success so the EXIT trap will clean up framework/.
SETUP_SUCCESS=1
