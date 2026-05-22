#!/usr/bin/env bash
# Script: merge-task
# Purpose: Merges a completed sub-branch back into the project integration branch.
#          Archives sub-branch. Closes GitHub Issue.
# Usage:   bash merge-task.sh <project_id> <task_id>
# Compliance: C02 (POL-073 to POL-075)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
TASK_ID="${2:-}"

[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id> <task_id>"
[[ -n "$TASK_ID"    ]] || hard_stop "Usage: $0 <project_id> <task_id>"

echo "=== merge-task: $PROJECT_ID / $TASK_ID"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── Pre-conditions ────────────────────────────────────────────────────────────

require_project_status "$PROJECT_YAML" "active"

BRANCH="brnch-${PROJECT_ID#PRJ-}"|BRANCH="brnch-${PROJECT_ID#PRJ-}"

# Verify task exists and is active
TASK_META=$(python3 - "$PROJECT_YAML" "$TASK_ID" <<'PY'
import sys, yaml, json
c = yaml.safe_load(open(sys.argv[1]))
for t in (c.get('tasks') or []):
    if t and t.get('id') == sys.argv[2]:
        print(json.dumps(t))
        sys.exit(0)
sys.exit(1)
PY
) || hard_stop "Task '$TASK_ID' not found in project.yaml — verify task_id."

TASK_STATUS=$(echo "$TASK_META" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
[[ "$TASK_STATUS" == "active" ]] || hard_stop "Task '$TASK_ID' status is '$TASK_STATUS', expected 'active'."

ISSUE_URL=$(echo "$TASK_META" | python3 -c "import sys,json; print(json.load(sys.stdin).get('github_issue',''))")

# Check no uncommitted changes in workspace
check_clean "$REPO_ROOT"

# Check no uncommitted changes in code repos
while IFS= read -r repo_url; do
  REPO_DIR="$AGENT_WORK_ROOT/$PROJECT_ID/$(get_repo_name "$repo_url")"
  [[ -d "$REPO_DIR/.git" ]] && check_clean "$REPO_DIR"
done < <(get_project_repos "$PROJECT_YAML")

# ── Merge sub-branch into project branch ─────────────────────────────────────

echo "Merging '$TASK_ID' → '$BRANCH' in workspace repo..."
cd "$REPO_ROOT"
git fetch origin "$TASK_ID" 2>/dev/null || true
merge_branch "$REPO_ROOT" "$TASK_ID" "$BRANCH"
git push origin "$BRANCH"

while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$AGENT_WORK_ROOT/$PROJECT_ID/$REPO_NAME"
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping merge."
    continue
  fi
  echo "Merging '$TASK_ID' → '$BRANCH' in $REPO_NAME..."
  git -C "$REPO_DIR" fetch origin "$TASK_ID" 2>/dev/null || true
  merge_branch "$REPO_DIR" "$TASK_ID" "$BRANCH"
  git -C "$REPO_DIR" push origin "$BRANCH"
done < <(get_project_repos "$PROJECT_YAML")

# ── Archive sub-branches ──────────────────────────────────────────────────────

echo ""
echo "Archiving sub-branches..."

archive_branch "$REPO_ROOT" "$TASK_ID"

while IFS= read -r repo_url; do
  REPO_DIR="$AGENT_WORK_ROOT/$PROJECT_ID/$(get_repo_name "$repo_url")"
  [[ -d "$REPO_DIR/.git" ]] && archive_branch "$REPO_DIR" "$TASK_ID"
done < <(get_project_repos "$PROJECT_YAML")

# ── Close GitHub Issue ────────────────────────────────────────────────────────

if [[ -n "$ISSUE_URL" ]]; then
  gh issue close "$ISSUE_URL" --comment "Task \`$TASK_ID\` merged into \`$BRANCH\`." 2>/dev/null \
    || warn "Could not close issue $ISSUE_URL — close manually."
  info "Closed issue: $ISSUE_URL"
fi

# ── Update project.yaml tasks[] ──────────────────────────────────────────────

TODAY=$(today)
python3 - "$PROJECT_YAML" "$TASK_ID" "$TODAY" <<'PY'
import sys, yaml
pf, task_id, today = sys.argv[1:]
with open(pf) as f:
    c = yaml.safe_load(f)
for t in (c.get('tasks') or []):
    if t and t.get('id') == task_id:
        t['status'] = 'completed'
        t['completed_at'] = today
        break
with open(pf, 'w') as f:
    yaml.dump(c, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY

cd "$REPO_ROOT"
git checkout "$BRANCH"
git add "projects/$PROJECT_ID/project.yaml"
git commit -m "merge-task: complete task $TASK_ID"
git push origin "$BRANCH"

echo ""
echo "=== Task merged successfully!"
echo "    Task:    $TASK_ID"
echo "    Merged → $BRANCH"
echo "    Issue:   ${ISSUE_URL:-n/a} (closed)"
