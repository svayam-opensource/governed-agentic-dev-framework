#!/usr/bin/env bash
# Script: merge-task
# Purpose: Merges a completed sub-branch back into the project integration branch.
#          Archives sub-branch. Closes the GitHub Issue(s) it covers.
# Usage:   bash merge-task.sh <project_id> <issue_url | task_branch>
#          arg2 may be a GitHub issue URL (single-issue task) OR the task
#          sub-branch itself (BRANCH.ISSUE-<n1>-<n2>), which the work flow passes
#          directly so combined multi-issue branches merge correctly (POL-070).
# Compliance: C02 (POL-073 to POL-075)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
TASK_ARG="${2:-}"

[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id> <issue_url | task_branch>"
[[ -n "$TASK_ARG"   ]] || hard_stop "Usage: $0 <project_id> <issue_url | task_branch>"

echo "=== merge-task: $PROJECT_ID / $TASK_ARG"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "active"

# This op merges + pushes + archives branches + closes the issue — all mutating.
# Gate it on GitHub-Project write access like the other mutating scripts
# (create-task/seed/resume), per H9.
CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")        # display/audit cache
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "You ($CURRENT_USER) are not authorized on this project — you need write access to its GitHub Project ($GH_PROJECT)."

BRANCH=$(project_branch_for_id "$PROJECT_ID")

# Resolve arg2 → the task sub-branch (TASK_ID) and every issue it closes.
# Scheme B (POL-070): sub-branch = BRANCH.ISSUE-<n1>-<n2>-…, keyed on issue NUMBERS.
#  - issue URL  → TASK_ID = BRANCH.ISSUE-<that number>; closes that one issue.
#  - task branch → TASK_ID = the branch; closes every issue whose number it carries
#    (resolved to a URL via the project board).
ISSUE_URLS=()

# resolve_board_issue_url <number> → the issue's URL on this project's board (or empty).
resolve_board_issue_url() {
  local want="$1" pnum powner
  pnum=$(echo "$GH_PROJECT"   | grep -oE '/projects/[0-9]+' | grep -oE '[0-9]+')
  powner=$(echo "$GH_PROJECT" | sed -E 's|.*/(orgs\|users)/([^/]+)/.*|\2|')
  gh project item-list "$pnum" --owner "$powner" --format json --limit 200 2>/dev/null | python3 -c "
import sys, json
want = '$want'
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for i in d.get('items', []):
    c = i.get('content') or {}
    if str(c.get('number')) == want and c.get('url'):
        print(c['url']); break
"
}

if [[ "$TASK_ARG" == *"/issues/"* ]]; then
  INUM=$(echo "$TASK_ARG" | grep -oE '/issues/[0-9]+' | grep -oE '[0-9]+$') \
    || hard_stop "Could not parse an issue number from $TASK_ARG"
  [[ -n "$INUM" ]] || hard_stop "Could not parse an issue number from $TASK_ARG"
  TASK_ID="${BRANCH}.ISSUE-${INUM}"
  ISSUE_URLS+=("$TASK_ARG")
else
  TASK_ID="$TASK_ARG"
  [[ "$TASK_ID" == "${BRANCH}".ISSUE-* ]] \
    || hard_stop "'$TASK_ID' is not a task sub-branch of '$BRANCH' (expected ${BRANCH}.ISSUE-<n>)."
  SUFFIX="${TASK_ID#"${BRANCH}".ISSUE-}"
  IFS='-' read -ra TASK_NUMS <<< "$SUFFIX"
  for n in "${TASK_NUMS[@]}"; do
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    u="$(resolve_board_issue_url "$n")"
    if [[ -n "$u" ]]; then ISSUE_URLS+=("$u"); else warn "Could not resolve issue #$n on the board — close it manually after merge."; fi
  done
fi

# Verify the task sub-branch exists on the remote
git -C "$REPO_ROOT" ls-remote --exit-code --heads origin "$TASK_ID" >/dev/null 2>&1 \
  || hard_stop "No sub-branch '$TASK_ID' on the remote — was the task created?"

# Check no uncommitted changes in workspace
check_clean "$REPO_ROOT"

# Check no uncommitted changes in code repos
while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  [[ -e "$REPO_DIR/.git" ]] && check_clean "$REPO_DIR"
done < <(get_project_repos "$PROJECT_YAML")

# ── Merge sub-branch into project branch ─────────────────────────────────────
# Multi-repo, not transactional: a conflict on a later repo leaves earlier repos
# already merged+pushed. To make a re-run safe (H5) we detect an already-merged
# sub-branch with `git merge-base --is-ancestor` and skip it, and we defer ALL
# archiving until every merge+push has succeeded — so a mid-loop failure never
# archives some repos and not others.

# Merge the sub-branch into the project branch in <path>, idempotently:
# if $TASK_ID is already an ancestor of $BRANCH, the merge is a no-op and we skip
# (no checkout/merge/push) so re-runs after a partial failure don't churn.
merge_task_into_branch() {
  local path="$1" label="$2"
  git -C "$path" fetch origin "$TASK_ID" 2>/dev/null || true
  if git -C "$path" merge-base --is-ancestor "$TASK_ID" "$BRANCH" 2>/dev/null; then
    info "'$TASK_ID' already merged into '$BRANCH' in $label — skipping."
    return 0
  fi
  echo "Merging '$TASK_ID' → '$BRANCH' in $label..."
  merge_branch "$path" "$TASK_ID" "$BRANCH"
  git -C "$path" push origin "$BRANCH"
}

cd "$REPO_ROOT"
merge_task_into_branch "$REPO_ROOT" "workspace repo"

while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  if [[ ! -e "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping merge."
    continue
  fi
  merge_task_into_branch "$REPO_DIR" "$REPO_NAME"
done < <(get_project_repos "$PROJECT_YAML")

# Reaching here means every merge+push above succeeded (merge_branch exits 2 on
# conflict). Only now is it safe to archive sub-branches across all repos.

# ── Archive sub-branches ──────────────────────────────────────────────────────

echo ""
echo "Archiving sub-branches..."

archive_branch "$REPO_ROOT" "$TASK_ID"

while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  [[ -e "$REPO_DIR/.git" ]] && archive_branch "$REPO_DIR" "$TASK_ID"
done < <(get_project_repos "$PROJECT_YAML")

# ── Close every GitHub Issue the branch covers + mark Done on the board ───────
GHPROJ=$(yaml_get "$PROJECT_YAML" "github_project")
for u in "${ISSUE_URLS[@]}"; do
  gh issue close "$u" --comment "Task \`$TASK_ID\` merged into \`$BRANCH\`." 2>/dev/null \
    || warn "Could not close issue $u — close manually."
  info "Closed issue: $u"
  board_set_status "$GHPROJ" "$u" "Done" || true
done

echo ""
echo "=== Task merged successfully!"
echo "    Task:    $TASK_ID"
echo "    Merged → $BRANCH"
echo "    Issues:  ${ISSUE_URLS[*]:-n/a} (closed)"
