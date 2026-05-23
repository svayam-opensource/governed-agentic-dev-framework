#!/usr/bin/env bash
# Script: seed
# Purpose: Initialize a per-project workspace under $AGENT_WORK_ROOT/<PROJECT_ID>/.
#          Clones the ORG GOVERNANCE repo and each impacted code repo into that
#          workspace on the project branch. The HOME workspace stays on the
#          default branch throughout — never switches.
# Usage:   bash seed.sh [--non-interactive] <github_project_url> <assignee>
# Compliance: C01 for all validation gates (POL-056 to POL-075)
#
# Flags:
#   --non-interactive   Skip all interactive prompts. Uses $DEFAULT_CODE_BRANCH
#                       as the base branch for every linked repo, and aborts
#                       (instead of prompting) if leftover state is detected.
#
# Lifecycle invariants (Direction A):
#   - Home workspace stays on $DEFAULT_BRANCH. No `git checkout` of any
#     project branch happens here.
#   - All project branch work lives in $AGENT_WORK_ROOT/<PROJECT_ID>/<workspace_repo>/
#     (a separate clone of ORG GOVERNANCE).
#   - Home's default branch gets a minimal projects/<PROJECT_ID>/.gitkeep stub
#     so the registry entry has a folder for the validator. Full scaffolding
#     (project.yaml, agent.md, knowledge/) lives on the project branch in the
#     per-project workspace, and arrives in default via the close-project merge.
#
# Resilience:
#   - Pre-conditions: home is on default, clean, no leftover state.
#   - Tracked side effects roll back on error: created paths removed, pushed
#     remote branches deleted, local registry commit reset.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

NON_INTERACTIVE=false
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=true ;;
    *) ARGS+=("$arg") ;;
  esac
done

GITHUB_PROJECT_URL="${ARGS[0]:-}"
ASSIGNEE="${ARGS[1]:-}"

[[ -n "$GITHUB_PROJECT_URL" ]] || hard_stop "Usage: $0 [--non-interactive] <github_project_url> <assignee>"
[[ -n "$ASSIGNEE" ]]           || hard_stop "Usage: $0 [--non-interactive] <github_project_url> <assignee>"

[[ -n "$ORG_REPO_URL" ]] \
  || hard_stop "org_repo_url not set in org-config.yaml. Run ./setup.sh first."

echo "=== seed: $GITHUB_PROJECT_URL"
echo "    Assignee:        $ASSIGNEE"
echo "    Agent work root: $AGENT_WORK_ROOT"
echo ""

# ── Rollback machinery ────────────────────────────────────────────────────────
# Track artifacts created during this run so they can be reversed on failure.
# Each list entry uses '<path>|<value>' to avoid bash3 associative arrays.

CREATED_LOCAL_BRANCHES=()
PUSHED_REMOTE_BRANCHES=()
CREATED_PATHS=()
HOME_PRE_SEED_SHA=""
SEED_OK=0

run_rollback() {
  local exit_code=$?
  if [[ "$SEED_OK" == "1" ]]; then return 0; fi
  if [[ ${#CREATED_LOCAL_BRANCHES[@]} -eq 0 \
        && ${#PUSHED_REMOTE_BRANCHES[@]} -eq 0 \
        && ${#CREATED_PATHS[@]} -eq 0 \
        && -z "$HOME_PRE_SEED_SHA" ]]; then
    return 0
  fi
  echo ""
  warn "seed.sh failed (exit $exit_code). Rolling back partial state..."

  # Delete pushed remote branches (these may exist if Phase B/C succeeded
  # before a later phase failed).
  for ((i=${#PUSHED_REMOTE_BRANCHES[@]}-1; i>=0; i--)); do
    local entry="${PUSHED_REMOTE_BRANCHES[$i]}"
    local path="${entry%%|*}"
    local branch="${entry#*|}"
    git -C "$path" push origin --delete "$branch" 2>/dev/null || true
  done

  # Reset HOME workspace if we made a local commit but haven't pushed it.
  if [[ -n "$HOME_PRE_SEED_SHA" ]]; then
    local current_home_sha
    current_home_sha=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "")
    if [[ "$current_home_sha" != "$HOME_PRE_SEED_SHA" ]]; then
      info "Reverting home workspace commit ($current_home_sha → $HOME_PRE_SEED_SHA)"
      git -C "$REPO_ROOT" reset --hard "$HOME_PRE_SEED_SHA" 2>/dev/null || true
      git -C "$REPO_ROOT" clean -fd projects 2>/dev/null || true
    fi
  fi

  # Local branches in clones (mostly cosmetic — the clones themselves are
  # deleted below, but switch off first to keep git happy).
  for ((i=${#CREATED_LOCAL_BRANCHES[@]}-1; i>=0; i--)); do
    local entry="${CREATED_LOCAL_BRANCHES[$i]}"
    local path="${entry%%|*}"
    local branch="${entry#*|}"
    if [[ -d "$path/.git" ]]; then
      local current=$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      if [[ "$current" == "$branch" ]]; then
        git -C "$path" checkout - 2>/dev/null \
          || git -C "$path" checkout "$DEFAULT_BRANCH" 2>/dev/null \
          || git -C "$path" checkout main 2>/dev/null || true
      fi
      git -C "$path" branch -D "$branch" 2>/dev/null || true
    fi
  done

  # Created filesystem paths (reverse order — innermost first)
  for ((i=${#CREATED_PATHS[@]}-1; i>=0; i--)); do
    [[ -n "${CREATED_PATHS[$i]}" ]] && rm -rf "${CREATED_PATHS[$i]}"
  done

  warn "Rollback complete. Home workspace restored, remote branches deleted."
}

trap 'run_rollback' EXIT

# ── Pre-conditions on the HOME workspace ─────────────────────────────────────

cd "$REPO_ROOT"

CURRENT_HOME_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$CURRENT_HOME_BRANCH" != "$DEFAULT_BRANCH" ]]; then
  hard_stop "Home workspace is on '$CURRENT_HOME_BRANCH', expected '$DEFAULT_BRANCH'.
The home workspace must stay on $DEFAULT_BRANCH (project branches live only in
per-project workspaces under \$AGENT_WORK_ROOT). Switch back first:
    git checkout $DEFAULT_BRANCH"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  hard_stop "Home workspace has uncommitted changes. Commit or stash first."
fi

# Fetch + ff-pull default to ensure we're current with origin.
info "Fetching latest $DEFAULT_BRANCH from origin..."
git fetch origin "$DEFAULT_BRANCH" >/dev/null 2>&1 || true
if ! git pull --ff-only origin "$DEFAULT_BRANCH" >/dev/null 2>&1; then
  warn "Could not fast-forward home workspace. Proceeding with local state."
fi

# ── C01 Validation Gates ──────────────────────────────────────────────────────

echo "[ C01 ] Validating GitHub Project..."

PROJECT_NUMBER=$(echo "$GITHUB_PROJECT_URL" | grep -oE '/projects/[0-9]+' | grep -oE '[0-9]+') \
  || hard_stop "Cannot extract project number from: $GITHUB_PROJECT_URL"
[[ -n "$PROJECT_NUMBER" ]] || hard_stop "Cannot extract project number from: $GITHUB_PROJECT_URL"

if echo "$GITHUB_PROJECT_URL" | grep -q '/orgs/'; then
  PROJECT_OWNER=$(echo "$GITHUB_PROJECT_URL" | sed 's|.*/orgs/\([^/]*\)/.*|\1|')
  OWNER_FIELD="organization"
else
  PROJECT_OWNER=$(echo "$GITHUB_PROJECT_URL" | sed 's|.*/users/\([^/]*\)/.*|\1|')
  OWNER_FIELD="user"
fi

info "Owner: $PROJECT_OWNER ($OWNER_FIELD), Project #$PROJECT_NUMBER"

PROJECT_DATA=$(gh api graphql -f query="
query {
  ${OWNER_FIELD}(login: \"$PROJECT_OWNER\") {
    projectV2(number: $PROJECT_NUMBER) {
      id
      title
      shortDescription
      items(first: 50) {
        nodes {
          content {
            ... on Issue       { url repository { url } }
            ... on PullRequest { url repository { url } }
          }
        }
      }
    }
  }
}") || hard_stop "GitHub Project not found or not accessible. Check URL and permissions."

PROJECT_TITLE=$(echo "$PROJECT_DATA" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = list(d['data'].values())[0]['projectV2']
print(p.get('title') or '')
")
[[ -n "$PROJECT_TITLE" ]] || hard_stop "GitHub Project has no name."
info "Project title: $PROJECT_TITLE"

ITEM_COUNT=$(echo "$PROJECT_DATA" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = list(d['data'].values())[0]['projectV2']
print(sum(1 for i in p['items']['nodes'] if i.get('content')))
")
[[ "$ITEM_COUNT" -gt 0 ]] || hard_stop "GitHub Project has no linked Issues or PRs."
info "Linked items: $ITEM_COUNT"

PROJECT_DESC=$(echo "$PROJECT_DATA" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = list(d['data'].values())[0]['projectV2']
print(p.get('shortDescription') or '')
" 2>/dev/null || echo "")
[[ -n "$PROJECT_DESC" ]] || warn "Project has no description"

echo "[ C01 ] Validation passed."
echo ""

# ── Compute project ID ────────────────────────────────────────────────────────

SHORT_SLUG=$(slugify "$PROJECT_TITLE")
LAST_ISSUED=$(yaml_get "$REGISTRY" "last_issued")
NNN=$(printf "%03d" $((LAST_ISSUED + 1)))
PROJECT_ID="PRJ-${NNN}-${SHORT_SLUG}"
BRANCH="brnch-${NNN}-${SHORT_SLUG}"
TODAY=$(today)
NEW_LAST_ISSUED=$((LAST_ISSUED + 1))

PROJECT_WORK_ROOT="$AGENT_WORK_ROOT/$PROJECT_ID"
ORG_GOV_CLONE="$PROJECT_WORK_ROOT/$WORKSPACE_REPO"

echo "Project ID         : $PROJECT_ID"
echo "Branch             : $BRANCH"
echo "Per-project root   : $PROJECT_WORK_ROOT"
echo "ORG GOV clone      : $ORG_GOV_CLONE"
echo ""

# ── Leftover-state detection ──────────────────────────────────────────────────

LEFTOVER=()

if git -C "$REPO_ROOT" rev-parse --verify "$BRANCH" &>/dev/null; then
  LEFTOVER+=("local branch '$BRANCH' in home workspace")
fi
if git ls-remote --exit-code --heads origin "$BRANCH" &>/dev/null; then
  LEFTOVER+=("remote branch 'origin/$BRANCH' on $ORG_REPO_URL")
fi
if [[ -d "$PROJECT_WORK_ROOT" ]]; then
  LEFTOVER+=("per-project workspace at '$PROJECT_WORK_ROOT'")
fi
if [[ -d "$REPO_ROOT/projects/$PROJECT_ID" ]]; then
  LEFTOVER+=("home stub folder 'projects/$PROJECT_ID/' on $DEFAULT_BRANCH")
fi
if python3 - "$REGISTRY" "$PROJECT_ID" <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1])) or {}
ids = [p.get('id') for p in (c.get('projects') or []) if p]
sys.exit(0 if sys.argv[2] in ids else 1)
PY
then
  LEFTOVER+=("registry entry for '$PROJECT_ID'")
fi

if [[ ${#LEFTOVER[@]} -gt 0 ]]; then
  echo ""
  warn "Detected leftover state from a previous failed run:"
  for item in "${LEFTOVER[@]}"; do echo "    - $item"; done
  echo ""
  if $NON_INTERACTIVE; then
    hard_stop "Leftover state detected and --non-interactive is set.
    Clean up manually, then re-run."
  fi

  echo "Options:"
  echo "  (a) Clean up these artifacts and start fresh"
  echo "  (b) Abort — inspect manually"
  echo ""
  printf "Choose [a/b]: "
  read -r choice </dev/tty
  case "$choice" in
    a|A)
      info "Cleaning up partial state..."
      # Remote branch on workspace repo
      git push origin --delete "$BRANCH" 2>/dev/null || true
      # Local branch (should not exist on home in the new model — we never
      # create one there — but clean defensively)
      git branch -D "$BRANCH" 2>/dev/null || true
      # Per-project workspace
      rm -rf "$PROJECT_WORK_ROOT"
      # Home stub folder (was created by a prior partial seed)
      rm -rf "$REPO_ROOT/projects/$PROJECT_ID"
      # Stray registry entry
      python3 - "$REGISTRY" "$PROJECT_ID" <<'PY' 2>/dev/null || true
import sys, yaml
registry, pid = sys.argv[1:]
with open(registry) as f: c = yaml.safe_load(f) or {}
c['projects'] = [p for p in (c.get('projects') or []) if p and p.get('id') != pid]
with open(registry, 'w') as f:
    yaml.dump(c, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY
      git checkout -- registry.yaml 2>/dev/null || true
      info "Cleanup complete. Continuing seed..."
      echo ""
      ;;
    *)
      hard_stop "Aborted at user request."
      ;;
  esac
fi

# ── Discover linked repos + prompt for base branches ─────────────────────────

REPO_URLS=$(echo "$PROJECT_DATA" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = list(d['data'].values())[0]['projectV2']
seen = set()
for i in p['items']['nodes']:
    c = i.get('content') or {}
    r = (c.get('repository') or {}).get('url')
    if r and r not in seen:
        seen.add(r)
        print(r)
")

REPO_URL_LIST=()
REPO_BASE_LIST=()

if [[ -n "$REPO_URLS" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    REPO_URL_LIST+=("$line")
  done <<< "$REPO_URLS"

  for repo_url in "${REPO_URL_LIST[@]}"; do
    if $NON_INTERACTIVE; then
      base="$DEFAULT_CODE_BRANCH"
      echo "  Base branch for '$repo_url': $base  (--non-interactive)"
    else
      printf "  Base branch for '%s' [%s]: " "$repo_url" "$DEFAULT_CODE_BRANCH"
      read -r input_base </dev/tty
      base="${input_base:-$DEFAULT_CODE_BRANCH}"
    fi
    REPO_BASE_LIST+=("$base")
  done
else
  warn "No repos detected from linked items — project.yaml repos[] will be a placeholder."
fi

get_repo_base() {
  local target="$1" i
  for ((i=0; i<${#REPO_URL_LIST[@]}; i++)); do
    if [[ "${REPO_URL_LIST[$i]}" == "$target" ]]; then
      echo "${REPO_BASE_LIST[$i]}"
      return 0
    fi
  done
  echo "$DEFAULT_CODE_BRANCH"
}

CURRENT_USER=$(git config user.email 2>/dev/null || echo "$ASSIGNEE")

# ── Phase A: HOME workspace, default branch — registry stub + folder stub ──
# We commit locally but do NOT push yet — pushing happens at the very end
# once every other phase has succeeded. If something fails in B/C, we just
# git reset --hard back to the pre-seed SHA (recorded below).

HOME_PRE_SEED_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)

info "Phase A: updating home registry + creating projects/$PROJECT_ID/ stub..."

python3 - "$REGISTRY" "$PROJECT_ID" "$BRANCH" "$ASSIGNEE" "$TODAY" "$GITHUB_PROJECT_URL" "$NEW_LAST_ISSUED" "$PROJECT_OWNER" <<'PY'
import sys, yaml
registry, pid, branch, assignee, today, gh_url, new_last, owner = sys.argv[1:]
with open(registry) as f: c = yaml.safe_load(f) or {}
c['last_issued'] = int(new_last)
if not c.get('projects'): c['projects'] = []
c['projects'].append({
    'id': pid,
    'branch': branch,
    'github_project': gh_url,
    'github_owner': owner,
    'assigned_to': assignee,
    'created_at': today,
    'status': 'active',
})
# Drop any matching pre_assignment now that we have a real registry entry.
c['pre_assignments'] = [a for a in (c.get('pre_assignments') or [])
                        if a and a.get('github_project') != gh_url]
with open(registry, 'w') as f:
    yaml.dump(c, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY

mkdir -p "$REPO_ROOT/projects/$PROJECT_ID"
cat > "$REPO_ROOT/projects/$PROJECT_ID/.gitkeep" <<EOF
# Active project — full content lives on branch '$BRANCH'.
#
# This folder is a stub on $DEFAULT_BRANCH so the registry entry has a folder
# to point at (validator requirement). The full project content (project.yaml,
# agent.md, knowledge/, etc.) lives on branch '$BRANCH' inside the per-project
# workspace at:
#
#   $AGENT_WORK_ROOT/$PROJECT_ID/$WORKSPACE_REPO/projects/$PROJECT_ID/
#
# On close-project, the project branch merges back to $DEFAULT_BRANCH and the
# full content arrives here, overwriting this stub.
EOF

git -C "$REPO_ROOT" add registry.yaml "projects/$PROJECT_ID/.gitkeep"
git -C "$REPO_ROOT" commit -m "seed: register project $PROJECT_ID (assigned to $ASSIGNEE)" >/dev/null
info "  ✓ home commit recorded locally (will push after all phases succeed)"

# ── Phase B: per-project workspace — clone ORG GOVERNANCE on project branch ──

info "Phase B: cloning ORG GOVERNANCE into per-project workspace..."

mkdir -p "$PROJECT_WORK_ROOT"
CREATED_PATHS+=("$PROJECT_WORK_ROOT")

# Clone from local home repo (file://) so the clone has our just-committed
# registry update + .gitkeep stub without needing to push first. We then
# re-point origin to the org repo URL so subsequent `git push` goes to the
# right place.
git clone --local "$REPO_ROOT" "$ORG_GOV_CLONE" >/dev/null 2>&1 \
  || hard_stop "Failed to clone home workspace into $ORG_GOV_CLONE"
CREATED_PATHS+=("$ORG_GOV_CLONE")

git -C "$ORG_GOV_CLONE" remote set-url origin "$ORG_REPO_URL"

# Create the project branch in the clone
git -C "$ORG_GOV_CLONE" checkout -b "$BRANCH" >/dev/null 2>&1
CREATED_LOCAL_BRANCHES+=("$ORG_GOV_CLONE|$BRANCH")
info "  ✓ created branch '$BRANCH' in ORG GOV clone"

# ── Phase B.1: scaffold projects/<PID>/* inside the clone ────────────────────

PROJECT_DIR="$ORG_GOV_CLONE/projects/$PROJECT_ID"
rm -f "$PROJECT_DIR/.gitkeep"  # we're about to write real content
mkdir -p "$PROJECT_DIR"/{requirements,environment,knowledge}

# todo.md from template
TODO_TEMPLATE="$ORG_GOV_CLONE/knowledge/guidance/todo-template.md"
if [[ -f "$TODO_TEMPLATE" ]]; then
  PROJECT_SUFFIX="${PROJECT_ID#PRJ-}"
  sed "s/NNN-slug/$PROJECT_SUFFIX/g" "$TODO_TEMPLATE" > "$PROJECT_DIR/knowledge/todo.md"
fi

# Build repos[] YAML fragment
REPOS_BLOCK=""
if [[ ${#REPO_URL_LIST[@]} -gt 0 ]]; then
  for repo_url in "${REPO_URL_LIST[@]}"; do
    base=$(get_repo_base "$repo_url")
    REPOS_BLOCK+="  - url: $repo_url"$'\n'
    REPOS_BLOCK+="    role: primary"$'\n'
    REPOS_BLOCK+="    base_branch: $base"$'\n'
    REPOS_BLOCK+="    added_at: $TODAY"$'\n'
    REPOS_BLOCK+="    added_reason: ~"$'\n'
  done
else
  REPOS_BLOCK="  - url: ~"$'\n'
  REPOS_BLOCK+="    role: primary"$'\n'
  REPOS_BLOCK+="    base_branch: $DEFAULT_CODE_BRANCH"$'\n'
  REPOS_BLOCK+="    added_at: ~"$'\n'
  REPOS_BLOCK+="    added_reason: ~"$'\n'
fi

# Quote string scalars for YAML safety
yaml_quote() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/"/\\"/g')"
}
Q_PROJECT_ID=$(yaml_quote "$PROJECT_ID")
Q_SHORT_SLUG=$(yaml_quote "$SHORT_SLUG")
Q_GITHUB_PROJECT_URL=$(yaml_quote "$GITHUB_PROJECT_URL")
Q_PROJECT_TITLE=$(yaml_quote "$PROJECT_TITLE")
Q_ASSIGNEE=$(yaml_quote "$ASSIGNEE")
Q_CURRENT_USER=$(yaml_quote "$CURRENT_USER")
Q_BRANCH=$(yaml_quote "$BRANCH")

cat > "$PROJECT_DIR/project.yaml" <<YAML
id: $Q_PROJECT_ID
slug: $Q_SHORT_SLUG
branch: $Q_BRANCH
description: ~
github_project: $Q_GITHUB_PROJECT_URL
github_project_name: $Q_PROJECT_TITLE
assigned_to: $Q_ASSIGNEE
locked_by: $Q_CURRENT_USER
status: active
created_at: $TODAY
started_at: $TODAY
completed_at: ~
paused_at: ~
cancelled_at: ~
cancellation_reason: ~
repos:
$REPOS_BLOCK
tasks: []
knowledge_status: ~
knowledge_pr: ~
agent_config:
  model: auto
  provider: cursor
YAML

cat > "$PROJECT_DIR/agent.md" <<MD
# $PROJECT_TITLE — Project Agent Entry Point
# Project: $PROJECT_ID  |  Branch: $BRANCH

This file is the project-specific entrypoint. Combined with the framework's
universal session-start protocol (CLAUDE.md / AGENTS.md / etc. at repo root),
it tells you everything you need to start work on $PROJECT_ID.

## Working Directory

Your per-project workspace lives at:

    $PROJECT_WORK_ROOT/

Inside it:

- \`$WORKSPACE_REPO/\` — clone of ORG GOVERNANCE on branch \`$BRANCH\`. This is where
  you are right now. \`projects/$PROJECT_ID/\` here is your project metadata workspace.
$([[ ${#REPO_URL_LIST[@]} -gt 0 ]] && for u in "${REPO_URL_LIST[@]}"; do
  rn=$(get_repo_name "$u"); echo "- \`$rn/\` — clone of $u on branch \`$BRANCH\`. Code changes go here.";
done)

## Knowledge Layer Priority

1. **Org-wide knowledge** → \`$WORKSPACE_REPO/knowledge/\` (read-only this project)
2. **This project** → \`$WORKSPACE_REPO/projects/$PROJECT_ID/knowledge/\`
3. **Repo-local** → \`<repo>/knowledge/\` in each cloned code repo
4. **Your developer preferences** → \`$AGENT_WORK_ROOT/preferences/<your-gh-login>.md\`
   - At session start, run \`gh api user --jq .login\` to determine your handle.
   - Load only the file matching your handle.

## Session Start Checklist (C01)

1. Verify \`project.yaml\` \`locked_by\` matches your identity. If not, claim
   it by updating \`locked_by\` first (single-session lock).
2. Verify \`status: active\` in \`project.yaml\`.
3. Read \`projects/$PROJECT_ID/knowledge/todo.md\` and surface \`## Open\`
   items before planning new work.
4. Load all four knowledge layers fresh.

## Operational Workflow

1. Pick an issue from the GitHub Project board: $GITHUB_PROJECT_URL
2. Start a task sub-branch: \`./prj task <issue-url>\`
   (creates \`$BRANCH/<task-slug>\` in this clone + each code repo clone)
3. Do code work in the cloned code repos on the task sub-branch.
   Capture decisions, exceptions, and policy notes in
   \`projects/$PROJECT_ID/knowledge/\` as you go (not at session end).
   Capture intermediate to-dos in \`projects/$PROJECT_ID/knowledge/todo.md\`
   under \`## Open\` as they arise.
4. When the task is complete: \`./prj merge\` (merges sub-branch into \`$BRANCH\`).
5. When the whole project is complete: \`./prj close\` (merges \`$BRANCH\` back to
   $DEFAULT_BRANCH in ORG GOVERNANCE, archives, fires knowledge-proposal PR).

## Do Not

- Edit \`project.yaml\` \`tasks\` list directly — use \`./prj task\` / \`./prj merge\`.
- Create GitHub Issues unilaterally — those are humans-only.
- Touch \`$WORKSPACE_REPO/knowledge/\` — read-only this project.
- Push the project branch from the home ORG GOVERNANCE checkout — that
  checkout stays on $DEFAULT_BRANCH. All project-branch work happens here.
MD

# Per-tool agent rule files: copy framework-level files into the project
# workspace, substituting org values + project ID. The per-project copies have
# baked-in values (no <ORG_NAME> tokens) so the agent has full context.
TOOL_FILES=(
  "AGENTS.md"
  "CONVENTIONS.md"
  ".cursor/rules/agent.mdc"
  ".clinerules/agent.md"
  ".windsurf/rules/agent.md"
  ".github/copilot-instructions.md"
  ".gemini/styleguide.md"
  ".continue/rules.md"
  "CLAUDE.md"
)

for rel in "${TOOL_FILES[@]}"; do
  src="$ORG_GOV_CLONE/$rel"
  dst="$PROJECT_DIR/$rel"
  [[ -f "$src" ]] || continue
  mkdir -p "$(dirname "$dst")"
  # Substitute org values + the per-project ID/branch/paths.
  ORG_NAME_V="$ORG_NAME" ORG_SHORT_NAME_V="$ORG_SHORT_NAME" \
  ORG_SLUG_V="$ORG_SLUG" ORG_SLUG_LOWER_V="$ORG_SLUG_LOWER" \
  GITHUB_ORG_V="$GITHUB_ORG" WORKSPACE_REPO_V="$WORKSPACE_REPO" \
  DEFAULT_BRANCH_V="$DEFAULT_BRANCH" DEFAULT_CODE_BRANCH_V="$DEFAULT_CODE_BRANCH" \
  AGENT_WORK_ROOT_V="$AGENT_WORK_ROOT" \
  POLICY_OWNER_EMAIL_V="$POLICY_OWNER_EMAIL" \
  PROJECT_ID_V="$PROJECT_ID" BRANCH_V="$BRANCH" \
  perl -pe '
    s|<ORG_NAME>|$ENV{ORG_NAME_V}|g;
    s|<ORG_SHORT_NAME>|$ENV{ORG_SHORT_NAME_V}|g;
    s|<ORG_SLUG>|$ENV{ORG_SLUG_V}|g;
    s|<org_slug>|$ENV{ORG_SLUG_LOWER_V}|g;
    s|<GITHUB_ORG>|$ENV{GITHUB_ORG_V}|g;
    s|<WORKSPACE_REPO>|$ENV{WORKSPACE_REPO_V}|g;
    s|<DEFAULT_BRANCH>|$ENV{DEFAULT_BRANCH_V}|g;
    s|<DEFAULT_CODE_BRANCH>|$ENV{DEFAULT_CODE_BRANCH_V}|g;
    s|<AGENT_WORK_ROOT>|$ENV{AGENT_WORK_ROOT_V}|g;
    s|<POLICY_OWNER_EMAIL>|$ENV{POLICY_OWNER_EMAIL_V}|g;
    s|<PROJECT_ID>|$ENV{PROJECT_ID_V}|g;
  ' "$src" > "$dst"
done

info "  ✓ scaffolded $PROJECT_DIR"

# Commit the scaffold on the project branch
git -C "$ORG_GOV_CLONE" add "projects/$PROJECT_ID"
git -C "$ORG_GOV_CLONE" commit -m "seed: scaffold project content for $PROJECT_ID" >/dev/null

# ── Phase C: clone code repos into per-project workspace ─────────────────────

if [[ ${#REPO_URL_LIST[@]} -gt 0 ]]; then
  info "Phase C: cloning code repos into $PROJECT_WORK_ROOT/..."
  for repo_url in "${REPO_URL_LIST[@]}"; do
    REPO_NAME=$(get_repo_name "$repo_url")
    REPO_BASE=$(get_repo_base "$repo_url")
    REPO_DIR="$PROJECT_WORK_ROOT/$REPO_NAME"

    info "  cloning $repo_url → $REPO_DIR (base: $REPO_BASE)..."
    # Retry once on network/transient clone failure. Suppress only stdout
    # (progress) but keep stderr visible so real errors surface.
    if ! git clone "$repo_url" "$REPO_DIR" >/dev/null; then
      warn "  clone failed (likely transient) — retrying once..."
      rm -rf "$REPO_DIR"
      git clone "$repo_url" "$REPO_DIR" >/dev/null \
        || hard_stop "Clone failed for $repo_url"
    fi
    CREATED_PATHS+=("$REPO_DIR")
    git -C "$REPO_DIR" checkout "$REPO_BASE" >/dev/null 2>&1 \
      || hard_stop "Base branch '$REPO_BASE' not found in $repo_url"
    if git -C "$REPO_DIR" rev-parse --verify "$BRANCH" &>/dev/null; then
      hard_stop "Branch '$BRANCH' already exists in $repo_url — investigate."
    fi
    git -C "$REPO_DIR" checkout -b "$BRANCH" >/dev/null 2>&1
    CREATED_LOCAL_BRANCHES+=("$REPO_DIR|$BRANCH")
    git -C "$REPO_DIR" push -u origin "$BRANCH" >/dev/null 2>&1 \
      || hard_stop "Failed to push '$BRANCH' to $repo_url"
    PUSHED_REMOTE_BRANCHES+=("$REPO_DIR|$BRANCH")
    info "    ✓ branch '$BRANCH' pushed"
  done
fi

# ── Phase D: push everything ─────────────────────────────────────────────────

info "Phase D: pushing project branch and home registry update..."

# Push project branch from ORG GOV clone first (so origin has the entry)
git -C "$ORG_GOV_CLONE" push -u origin "$BRANCH" >/dev/null 2>&1 \
  || hard_stop "Failed to push '$BRANCH' to $ORG_REPO_URL"
PUSHED_REMOTE_BRANCHES+=("$ORG_GOV_CLONE|$BRANCH")
info "  ✓ pushed $BRANCH to $ORG_REPO_URL"

# Push home's default branch (the registry update + stub folder commit)
git -C "$REPO_ROOT" push origin "$DEFAULT_BRANCH" >/dev/null 2>&1 \
  || hard_stop "Failed to push $DEFAULT_BRANCH from home workspace"
info "  ✓ pushed $DEFAULT_BRANCH (registry update) to $ORG_REPO_URL"

# ── Done — disarm rollback ───────────────────────────────────────────────────

SEED_OK=1

# ── First-session prompt ─────────────────────────────────────────────────────

FIRST_PROMPT="Start project $PROJECT_ID. I'm working in $ORG_GOV_CLONE on branch $BRANCH. Follow your session-start protocol: read org-config.yaml, then read projects/$PROJECT_ID/agent.md, then knowledge/policies/agentic-development-policy.md, then surface any \\\`## Open\\\` items from projects/$PROJECT_ID/knowledge/todo.md before planning work."

cat <<EOF

=== Project $PROJECT_ID initialized.

ID         : $PROJECT_ID
Branch     : $BRANCH
Assignee   : $ASSIGNEE
GitHub     : $GITHUB_PROJECT_URL

Workspace layout:
  $PROJECT_WORK_ROOT/
    └── $WORKSPACE_REPO/    ← ORG GOVERNANCE clone (you cd here)
EOF
if [[ ${#REPO_URL_LIST[@]} -gt 0 ]]; then
  for repo_url in "${REPO_URL_LIST[@]}"; do
    REPO_NAME=$(get_repo_name "$repo_url")
    echo "    └── $REPO_NAME/    ← code repo clone (code changes here)"
  done
fi

cat <<EOF

The home workspace stayed on '$DEFAULT_BRANCH' throughout. All project-branch
work happens inside the per-project workspace above.

────────────────────────────────────────────────────────────────────────
Next step — paste this in your shell:

    cd $ORG_GOV_CLONE

Then start your agent session with this prompt:

    $FIRST_PROMPT

────────────────────────────────────────────────────────────────────────
EOF
