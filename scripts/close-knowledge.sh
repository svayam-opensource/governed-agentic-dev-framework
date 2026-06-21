#!/usr/bin/env bash
# Script: close-knowledge
# Purpose: Synthesizes project knowledge into org knowledge proposals using LLM+RAG.
#          Raises PR for domain owner review.
# Usage:   bash close-knowledge.sh <project_id>
# Triggered by: close-project automatically after successful project close.
# Compliance: C02 (POL-097 to POL-106)
#
# LLM synthesis note:
#   This script prepares the branch and context, then invokes the agent (Claude Code)
#   to perform synthesis. The agent reads all project knowledge, queries relevant org
#   knowledge, and proposes changes via the knowledge-close branch.
#   If the agent is not available, the script falls back to creating the PR with raw
#   project knowledge attached for manual review.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id>"

echo "=== close-knowledge: $PROJECT_ID"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
PROJECT_DIR=$(get_project_dir "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "completed"

# The person closing knowledge must be authorized on the project — assigned_to
# individual or a member of the assigned_to team (per-task/team model, POL-047).
# Mirrors create-task.sh; closes the inconsistent-authz gap (#62/H9).
CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")        # display/audit cache
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "You ($CURRENT_USER) are not authorized on this project — you need write access to its GitHub Project ($GH_PROJECT)."

KNOWLEDGE_DIR="$PROJECT_DIR/knowledge"
if [[ ! -d "$KNOWLEDGE_DIR" ]] || [[ -z "$(find "$KNOWLEDGE_DIR" -type f 2>/dev/null)" ]]; then
  hard_stop "projects/$PROJECT_ID/knowledge/ is empty — nothing to synthesize."
fi

BRANCH=$(project_branch_for_id "$PROJECT_ID")
KNOWLEDGE_BRANCH="${BRANCH}-knowledge"
TODAY=$(today)

# ── Failure cleanup (#64) ─────────────────────────────────────────────────────
# On any failure, undo the branch/temp-file this run created so a failed run
# leaves no orphan branch or context file and is re-runnable. State flags are
# flipped as each resource is created; _CK_DONE disarms the trap on success.
KNOWLEDGE_SUMMARY_FILE="$REPO_ROOT/.close-knowledge-context-$PROJECT_ID.md"
_CK_BRANCH_CREATED=false
_CK_BRANCH_PUSHED=false
_CK_DONE=false

cleanup_on_failure() {
  local rc=$?
  $_CK_DONE && return 0
  [[ $rc -eq 0 ]] && return 0
  warn "close-knowledge failed (exit $rc) — cleaning up so the run is re-runnable."
  rm -f "$KNOWLEDGE_SUMMARY_FILE" 2>/dev/null || true
  if $_CK_BRANCH_CREATED; then
    git -C "$REPO_ROOT" checkout "$DEFAULT_BRANCH" &>/dev/null || true
    local scope="local"
    if $_CK_BRANCH_PUSHED; then
      git -C "$REPO_ROOT" push origin --delete "$KNOWLEDGE_BRANCH" &>/dev/null || true
      scope="local + remote"
    fi
    git -C "$REPO_ROOT" branch -D "$KNOWLEDGE_BRANCH" &>/dev/null || true
    info "Removed knowledge branch '$KNOWLEDGE_BRANCH' ($scope)."
  fi
}
trap cleanup_on_failure EXIT

# ── Create knowledge branch ───────────────────────────────────────────────────

echo "Creating knowledge branch '$KNOWLEDGE_BRANCH'..."
cd "$REPO_ROOT"
git fetch origin "$DEFAULT_BRANCH"
git checkout "$DEFAULT_BRANCH"
git pull origin "$DEFAULT_BRANCH"

if git rev-parse --verify "$KNOWLEDGE_BRANCH" &>/dev/null; then
  hard_stop "Branch '$KNOWLEDGE_BRANCH' already exists — investigate before proceeding."
fi
git checkout -b "$KNOWLEDGE_BRANCH"
_CK_BRANCH_CREATED=true

# ── Collect project knowledge ─────────────────────────────────────────────────

echo "Collecting project knowledge from $KNOWLEDGE_DIR..."

{
  echo "# Knowledge Close Context: $PROJECT_ID"
  echo ""
  echo "**Project:** $PROJECT_ID"
  echo "**Closed:** $TODAY"
  echo "**Knowledge dir:** projects/$PROJECT_ID/knowledge/"
  echo ""
  echo "---"
  echo ""
  echo "## Project Knowledge Files"
  echo ""
  find "$KNOWLEDGE_DIR" -type f | sort | while IFS= read -r f; do
    rel="${f#$REPO_ROOT/}"
    echo "### $rel"
    echo ""
    cat "$f"
    echo ""
    echo "---"
    echo ""
  done
} > "$KNOWLEDGE_SUMMARY_FILE"

info "Context written to: $KNOWLEDGE_SUMMARY_FILE"

# ── LLM synthesis step ────────────────────────────────────────────────────────
#
# The agent (Claude Code) running this script MUST follow the Knowledge Harvest
# Protocol — knowledge/development/procedures/knowledge-harvest.md (POL-413, C01):
#   1. Reconstruct from EVIDENCE (git log -p across project repos, merged issues,
#      todo.md, all projects/$PROJECT_ID/knowledge/ docs) — not from memory.
#   2. Enumerate → classify (graduate/local/discard) every durable artifact; mine
#      the non-obvious (gotchas, failures-and-fixes); journey review;
#      completeness-critic pass.
#   3. Write the manifest projects/$PROJECT_ID/knowledge/knowledge-close.md
#      (template in the protocol). close-project's gate checks it is present +
#      structurally complete (no TBD).
#   4. Apply proposed org-knowledge changes to knowledge/ on this branch.
#   5. Call: bash close-knowledge.sh <project_id> --finalize <pr_description_file>
#
# If the agent is not available, we fall back to attaching raw knowledge.

if [[ "${2:-}" == "--finalize" ]]; then
  # Phase 2: agent has done synthesis and calls us back to create the PR
  PR_DESC_FILE="${3:-}"
  [[ -n "$PR_DESC_FILE" && -f "$PR_DESC_FILE" ]] \
    || hard_stop "--finalize requires a PR description file as argument 3."
  PR_BODY=$(cat "$PR_DESC_FILE")
  _finalize_mode=true
else
  # Phase 1: no agent synthesis — fall back to attaching raw knowledge for manual review
  warn "LLM synthesis not performed — attaching raw project knowledge for manual review."
  PR_BODY=$(cat <<MD
## Knowledge Close: $PROJECT_ID

**Automated synthesis was not performed.** This PR attaches the raw project knowledge
for manual review by domain owners.

### Project Knowledge

See \`projects/$PROJECT_ID/knowledge/\` in this branch for all captured learnings.

### Review Instructions

Domain owners: please review the project knowledge and manually apply relevant
learnings to the appropriate \`knowledge/\` subfolders in this PR.

*Generated by close-knowledge.sh — fallback mode (no LLM synthesis)*
MD
)
  _finalize_mode=false
fi

# ── Commit knowledge changes to branch ───────────────────────────────────────

# Remove temp context file
rm -f "$KNOWLEDGE_SUMMARY_FILE"

# Stage any knowledge/ changes the agent may have made
git add "framework/knowledge/" 2>/dev/null || true

# If no changes were staged (fallback mode), there is nothing new to commit;
# the PR will just carry the branch with existing org knowledge as baseline.
if git diff --cached --quiet; then
  info "No knowledge/ changes staged — PR will describe manual review needed."
  # Create a placeholder note so the branch has at least one commit
  mkdir -p "$REPO_ROOT/framework/knowledge/accumulated"
  cat >> "$REPO_ROOT/framework/knowledge/accumulated/README.md" <<NOTE

<!-- close-knowledge: $PROJECT_ID — manual review needed ($TODAY) -->
NOTE
  git add "framework/knowledge/accumulated/README.md"
fi

git commit -m "close-knowledge: $PROJECT_ID" --allow-empty
git push -u origin "$KNOWLEDGE_BRANCH"
_CK_BRANCH_PUSHED=true

# ── Raise PR ──────────────────────────────────────────────────────────────────

echo "Raising PR: $KNOWLEDGE_BRANCH → $DEFAULT_BRANCH..."

PR_URL=$(gh pr create \
  --base "$DEFAULT_BRANCH" \
  --head "$KNOWLEDGE_BRANCH" \
  --title "[Knowledge Close] $PROJECT_ID" \
  --body "$PR_BODY" \
  2>/dev/null) \
  || {
    warn "PR creation failed — retrying..."
    PR_URL=$(gh pr create \
      --base "$DEFAULT_BRANCH" \
      --head "$KNOWLEDGE_BRANCH" \
      --title "[Knowledge Close] $PROJECT_ID" \
      --body "$PR_BODY")
  }

info "PR created: $PR_URL"

# Point of no return: the branch is now referenced by a PR, so deleting it on a
# later failure would orphan the PR. Disarm the branch/temp-file cleanup but
# still drop the temp context file (which is removed earlier anyway).
_CK_DONE=true
rm -f "$KNOWLEDGE_SUMMARY_FILE" 2>/dev/null || true

# ── Update project.yaml ───────────────────────────────────────────────────────

cd "$REPO_ROOT"
git checkout "$DEFAULT_BRANCH"
git pull origin "$DEFAULT_BRANCH"

yaml_set "$PROJECT_YAML" "knowledge_status" "pending_review"
yaml_set "$PROJECT_YAML" "knowledge_pr"     "$PR_URL"

git add "projects/$PROJECT_ID/project.yaml"
git commit -m "close-knowledge: update knowledge_status for $PROJECT_ID"

# Pre-push validation gate (rolls back commit if validators fail)
validate_or_revert

git push origin "$DEFAULT_BRANCH"

echo ""
echo "=== Knowledge close initiated."
echo "    Branch:           $KNOWLEDGE_BRANCH"
echo "    PR:               $PR_URL"
echo "    knowledge_status: pending_review"
echo ""
echo "    CODEOWNERS will auto-assign domain reviewers."
echo "    Outcome updates:"
echo "      Merged   → archive tag + delete branch, knowledge_status: merged"
echo "      Rejected → owner closes PR, knowledge_status: rejected"
