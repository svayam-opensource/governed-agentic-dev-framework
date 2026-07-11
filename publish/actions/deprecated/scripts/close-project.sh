#!/usr/bin/env bash
# Script: close-project
# Purpose: Closes project work. Validates completion, merges branches to base,
#          archives, then triggers close-knowledge.
# Usage:   bash close-project.sh <project_id>
# Compliance: C01 for pre-close gate (POL-087 to POL-096)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

PROJECT_ID="${1:-}"
[[ -n "$PROJECT_ID" ]] || hard_stop "Usage: $0 <project_id>"

echo "=== close-project: $PROJECT_ID"
echo ""

PROJECT_YAML=$(get_project_yaml "$PROJECT_ID")
PROJECT_DIR=$(get_project_dir "$PROJECT_ID")
check_project_exists "$PROJECT_ID"

# ── C01 Pre-close Gate ────────────────────────────────────────────────────────

echo "[ C01 ] Running pre-close gate..."
GATE_FAILURES=()

# 1. knowledge/ contains at least one file
KNOWLEDGE_DIR="$PROJECT_DIR/knowledge"
if [[ ! -d "$KNOWLEDGE_DIR" ]] || [[ -z "$(find "$KNOWLEDGE_DIR" -type f 2>/dev/null)" ]]; then
  GATE_FAILURES+=("projects/$PROJECT_ID/knowledge/ is empty — document project learnings first.")
fi

# 2. compliance.md exists
if [[ ! -f "$KNOWLEDGE_DIR/compliance.md" ]]; then
  GATE_FAILURES+=("projects/$PROJECT_ID/knowledge/compliance.md is missing — required before close.")
fi

# 2b. knowledge-close.md manifest present + structurally complete (POL-413/414).
#     Presence + structure ONLY — quality is the Harvest Protocol + Owner PR review.
MANIFEST="$KNOWLEDGE_DIR/knowledge-close.md"
if [[ ! -f "$MANIFEST" ]]; then
  GATE_FAILURES+=("knowledge-close.md is missing — run the Knowledge Harvest Protocol (knowledge/development/procedures/knowledge-harvest.md) first.")
else
  for section in "## Graduated to org knowledge" "## Kept project-local" "## Discarded" "## Journeys created / updated" "## Completeness critic"; do
    grep -qF "$section" "$MANIFEST" || GATE_FAILURES+=("knowledge-close.md missing required section: '$section'")
  done
  # Case-SENSITIVE: placeholder markers are uppercase by convention; this avoids
  # false-positives on the lowercase 'todo.md' filename (the standard project file).
  if grep -qE '\b(TBD|TODO|FIXME|XXX)\b' "$MANIFEST"; then
    GATE_FAILURES+=("knowledge-close.md still contains a TBD/TODO/FIXME placeholder — harvest incomplete.")
  fi
fi

# 3. project.yaml mandatory fields populated
for field in id slug assigned_to seeded_by started_at; do
  val=$(yaml_get "$PROJECT_YAML" "$field")
  [[ -z "$val" || "$val" == "~" ]] && GATE_FAILURES+=("project.yaml field '$field' is not populated.")
done

if [[ ${#GATE_FAILURES[@]} -gt 0 ]]; then
  echo "" >&2
  echo "[ C01 ] Pre-close gate FAILED:" >&2
  for f in "${GATE_FAILURES[@]}"; do
    echo "    - $f" >&2
  done
  hard_stop "Fix the above issues before closing the project."
fi

echo "[ C01 ] Pre-close gate passed."
echo ""

# Allow re-runs after partial failure: status may be 'active' (first run)
# or 'completed' (re-run after step 2/3 succeeded but later step failed).
require_any_project_status "$PROJECT_YAML" "active" "completed"

# close-project is C01-destructive (merges to protected base branches, archives
# branches). The person closing must be authorized on the project — assigned_to
# individual or a member of the assigned_to team (POL-046/047). Mirrors the gate
# in create-task.sh. (H9: authz was previously missing on this destructive op.)
CURRENT_USER=$(git config user.email 2>/dev/null || echo "")
ASSIGNED_TO=$(yaml_get "$PROJECT_YAML" "assigned_to")        # display/audit cache
GH_PROJECT=$(yaml_get "$PROJECT_YAML" "github_project")
is_authorized_for_project "$GH_PROJECT" "$ASSIGNED_TO" \
  || hard_stop "You ($CURRENT_USER) are not authorized to close this project — you need write access to its GitHub Project ($GH_PROJECT)."

BRANCH=$(project_branch_for_id "$PROJECT_ID")
TODAY=$(today)

# Workspace-repo git ops run in the PER-PROJECT gov clone (on the project branch),
# not $REPO_ROOT — which the deterministic resolver (#57) makes the home clone (on
# main). The project branch is checked out in the per-project worktree (shared
# base), so 'git checkout <project-branch>' in the home clone fails with "already
# used by worktree". Fall back to REPO_ROOT when no per-project clone exists.
WS_CLONE="$(org_gov_clone "$PROJECT_ID")"
[[ -e "$WS_CLONE/.git" ]] || WS_CLONE="$REPO_ROOT"

# Tasks-on-board: a task is a sub-branch (<branch>.<task-slug>). Refuse to close
# while any remain unmerged — merge them (prj merge) or cancel first. The "$BRANCH.*"
# glob matches task sub-branches only (not "$BRANCH" itself, nor "$BRANCH-knowledge").
OPEN_TASKS=$(git -C "$WS_CLONE" ls-remote --heads origin "$BRANCH.*" 2>/dev/null | awk '{print $2}' | sed 's|refs/heads/||')
[[ -n "$OPEN_TASKS" ]] && hard_stop "Unmerged task sub-branches exist — merge or cancel them first:
$OPEN_TASKS"

# ── Update state on project branch (so the gate validates it) ────────────────

echo "Updating project state on '$BRANCH'..."
cd "$WS_CLONE"
git fetch origin "$DEFAULT_BRANCH"
git fetch origin "$BRANCH" 2>/dev/null || true
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH" 2>/dev/null || true

# Sync project branch with latest default — needed to pick up registry.yaml updates
# from any other projects that closed after this one was seeded.
if ! git merge --no-edit "origin/$DEFAULT_BRANCH" 2>/dev/null; then
  echo ""
  echo "MERGE CONFLICT: $DEFAULT_BRANCH → $BRANCH in workspace repo."
  echo "Resolve conflicts manually, commit, then re-run: bash close-project.sh $PROJECT_ID"
  exit 2
fi

yaml_set "$PROJECT_YAML" "status"       "completed"
yaml_set "$PROJECT_YAML" "completed_at" "$TODAY"

# project.yaml status lives on the project branch (merges to $DEFAULT_BRANCH
# below). The registry index entry lives on $DEFAULT_BRANCH (authored at seed)
# and is flipped to 'completed' after the merge, near the end of this script.
git add "projects/$PROJECT_ID/project.yaml"
if ! git diff --cached --quiet; then
  git commit -m "close-project: $PROJECT_ID — mark completed"
  git push origin "$BRANCH"
fi

# ── Merge code repo branches → base_branch — LOCAL ONLY, NO PUSH (gate-before-push) ──
#
# H5/#64: previously each code repo was merged AND pushed here, BEFORE the
# workspace test-merge gate ran. A gate failure therefore shipped the code while
# leaving the registry 'active'. We now merge every repo LOCALLY first, then run
# the gate, and only push base branches once ALL repos merged cleanly. Re-runs
# are safe: a repo already merged (its base branch contains $BRANCH) is skipped.
#
# MERGED_REPOS queues "<name>|<base>" entries for the deferred-push phase below.
# A '|'-delimited list is used (not a bash4 associative array) to stay bash-3.2
# compatible — see the same convention in seed.sh.
MERGED_REPOS=()

echo ""
echo "Merging code repo branches locally (no push yet)..."

while IFS= read -r repo_url; do
  REPO_NAME=$(get_repo_name "$repo_url")
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  REPO_BASE=$(get_repo_base_branch "$PROJECT_YAML" "$repo_url")

  if [[ ! -e "$REPO_DIR/.git" ]]; then
    warn "Repo $REPO_NAME not cloned locally — skipping merge (merge manually)."
    continue
  fi

  git -C "$REPO_DIR" fetch origin "$REPO_BASE"
  git -C "$REPO_DIR" fetch origin "$BRANCH" 2>/dev/null || true
  # The per-project repo is a worktree of a shared base clone (ADR-0001). If that
  # base clone "holds" $REPO_BASE (e.g. it's sitting on main), the worktree can't
  # check it out → "already used by worktree". Detach the base's HEAD to free the
  # branch (the base is an object store, not a working checkout).
  _RBASE_CLONE="$(base_clone_dir "$repo_url")"
  [[ -e "$_RBASE_CLONE/.git" ]] && git -C "$_RBASE_CLONE" checkout --detach -q 2>/dev/null || true
  git -C "$REPO_DIR" checkout "$REPO_BASE"

  MERGED_REPOS+=("$REPO_NAME|$REPO_BASE")

  # Idempotency: if $BRANCH is already an ancestor of $REPO_BASE, this repo was
  # merged on a prior run — nothing to merge, but still queued for push below in
  # case a previous run failed before pushing.
  if git -C "$REPO_DIR" merge-base --is-ancestor "$BRANCH" "$REPO_BASE" 2>/dev/null; then
    info "$REPO_NAME: '$BRANCH' already merged into '$REPO_BASE' — skipping merge."
    continue
  fi

  echo "Merging '$BRANCH' → '$REPO_BASE' in $REPO_NAME (local)..."
  if ! git -C "$REPO_DIR" merge --no-edit "$BRANCH" 2>/dev/null; then
    echo ""
    echo "MERGE CONFLICT: $BRANCH → $REPO_BASE in $REPO_NAME."
    echo "Resolve conflicts manually, commit, then re-run: bash close-project.sh $PROJECT_ID"
    exit 2
  fi
  info "$REPO_NAME: merged locally (push deferred until after gate)."
done < <(get_project_repos "$PROJECT_YAML")

# ── Test-merge gate: $BRANCH → $DEFAULT_BRANCH (workspace repo only) ─────────
# Runs BEFORE any base-branch push. A failure here aborts with nothing shipped.

echo ""
echo "Running test-merge gate for workspace repo..."
bash "$SCRIPT_DIR/test-merge.sh" "$BRANCH"

# ── All repos merged cleanly AND the gate passed — now push base branches ─────
# Order: code-repo base branches first, then $DEFAULT_BRANCH. Pushes are
# idempotent (re-pushing an unchanged base branch is a no-op).

echo ""
echo "Gate passed — pushing code repo base branches..."
for entry in "${MERGED_REPOS[@]+"${MERGED_REPOS[@]}"}"; do
  REPO_NAME="${entry%%|*}"
  REPO_BASE="${entry#*|}"
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$REPO_NAME")"
  git -C "$REPO_DIR" push origin "$REPO_BASE"
  info "$REPO_NAME: pushed '$REPO_BASE'."
done

# ── Promote $BRANCH → $DEFAULT_BRANCH via a pull request (worktree-safe) ──────
# We NEVER `git checkout $DEFAULT_BRANCH` here. The workspace clone may be a git
# worktree that shares its .git with the home governance checkout already holding
# $DEFAULT_BRANCH, so a local checkout/ff/push of the default branch is
# impossible (the old `git push origin $DEFAULT_BRANCH` after a local fast-forward
# is what collided with the worktree). Instead we push the branch and open a PR;
# merging it moves the project folder + project.yaml status to $DEFAULT_BRANCH
# atomically. Status itself is GitHub-derived (board closed below) — there is no
# registry flip to ship (registry-elimination Increment 2).

cd "$WS_CLONE"
git push origin "$BRANCH"

CLOSE_PR_TITLE="close-project: $PROJECT_ID → $DEFAULT_BRANCH"
CLOSE_PR_BODY="Automated project close for **$PROJECT_ID** ($TODAY).

Moves to \`$DEFAULT_BRANCH\` atomically on merge:
- \`projects/$PROJECT_ID/\` workspace + knowledge state
- \`projects/$PROJECT_ID/project.yaml\` → status: completed

Status is GitHub-derived: the board is closed at close, so the project reads as
*completed* with no registry write. Gate: test-merge validators PASSED before
this PR was opened."

if PR_URL="$(gh pr create --repo "$GITHUB_ORG/$WORKSPACE_REPO" \
      --base "$DEFAULT_BRANCH" --head "$BRANCH" \
      --title "$CLOSE_PR_TITLE" --body "$CLOSE_PR_BODY" 2>/dev/null)"; then
  info "Opened close PR: $PR_URL"
else
  PR_URL="$(gh pr view "$BRANCH" --repo "$GITHUB_ORG/$WORKSPACE_REPO" --json url -q .url 2>/dev/null || echo "")"
  [[ -n "$PR_URL" ]] && info "Reusing existing close PR: $PR_URL"
fi

info "Merging close PR into '$DEFAULT_BRANCH'..."
if ! gh pr merge "$BRANCH" --repo "$GITHUB_ORG/$WORKSPACE_REPO" --merge --admin 2>/dev/null; then
  if gh pr view "$BRANCH" --repo "$GITHUB_ORG/$WORKSPACE_REPO" --json state -q .state 2>/dev/null | grep -q MERGED; then
    info "Close PR already merged."
  else
    hard_stop "Could not merge the close PR automatically. Merge it manually, then re-run: bash close-project.sh $PROJECT_ID"
  fi
fi

# Make the local repo aware of the new $DEFAULT_BRANCH tip (no checkout).
git fetch origin "$DEFAULT_BRANCH" 2>/dev/null || true

# Mirror governance summary (best-effort, GitHub-side — not the registry).
anchor_set_state "$(yaml_get "$PROJECT_YAML" github_project)" completed
project_readme_mirror "$PROJECT_ID" "$(yaml_get "$PROJECT_YAML" github_project)" "completed" \
  "$(yaml_get "$PROJECT_YAML" assigned_to)" "$(yaml_get "$PROJECT_YAML" seeded_by)" "$BRANCH" || true

# Close the GitHub Project board — THIS is what makes the project read as
# 'completed' (board closed, anchor not 'cancelled'). #56 Facet A.
close_project_board "$GH_PROJECT"

# ── Archive branches ──────────────────────────────────────────────────────────

echo ""
echo "Archiving branches..."

archive_branch "$REPO_ROOT" "$BRANCH"

while IFS= read -r repo_url; do
  REPO_DIR="$(repo_clone_dir "$PROJECT_ID" "$(get_repo_name "$repo_url")")"
  [[ -e "$REPO_DIR/.git" ]] && archive_branch "$REPO_DIR" "$BRANCH"
done < <(get_project_repos "$PROJECT_YAML")

echo ""
echo "=== Project closed."
echo "    Status:       completed"
echo "    completed_at: $TODAY"
echo ""

# ── Automatically trigger close-knowledge ────────────────────────────────────

echo "Triggering close-knowledge..."
bash "$(dirname "$0")/close-knowledge.sh" "$PROJECT_ID"

# ── Remove the per-project workspace ─────────────────────────────────────────
# The project folder has been promoted to $DEFAULT_BRANCH via the close PR, so
# the local working copy at $AGENT_WORK_ROOT/$PROJECT_ID is no longer needed.
# This deletes the directory we are standing in (cd's out first) — your shell
# will be left in a removed dir; cd elsewhere afterwards.
echo ""
echo "Removing per-project workspace (content now on $DEFAULT_BRANCH via the close PR)..."
cleanup_project_workspace "$PROJECT_ID"
echo ""
echo "    Workspace removed: $AGENT_WORK_ROOT/$PROJECT_ID"
echo "    (your shell may be in a deleted directory — cd \$HOME or elsewhere.)"
