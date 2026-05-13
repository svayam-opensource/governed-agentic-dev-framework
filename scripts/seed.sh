#!/usr/bin/env bash
# Script: seed
# Purpose: Transitions a project from PROPOSED to ACTIVE.
#          Scaffolds workspace, clones repos, creates branches.
# Usage:   bash seed.sh [--non-interactive] <github_project_url> <assignee>
# Compliance: C01 for all validation gates (POL-056 to POL-075)
#
# Flags:
#   --non-interactive   Skip all interactive prompts. Uses $DEFAULT_CODE_BRANCH
#                       as the base branch for every linked repo, and aborts
#                       (instead of prompting) if leftover state is detected.
#                       Required for CI / smoke-test contexts where /dev/tty
#                       is not available.
#
# Resilience:
#   - Detects leftover state from a previous failed run for the same
#     project ID and offers to clean it up before proceeding (interactive
#     mode only; --non-interactive aborts instead).
#   - Tracks side effects in this run; on error, rolls them back so the
#     workspace is restored to its pre-seed state.
#   - bash 3.2 compatible (no associative arrays / mapfile / readarray).

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

echo "=== seed: $GITHUB_PROJECT_URL"
echo "    Assignee: $ASSIGNEE"
echo ""

# ── Rollback machinery ────────────────────────────────────────────────────────
# Track artifacts created during this run so they can be reversed on failure.
# Each list entry uses '<path>|<value>' to avoid bash3 associative arrays.

CREATED_LOCAL_BRANCHES=()    # entries: "<repo-path>|<branch-name>"
PUSHED_REMOTE_BRANCHES=()    # entries: "<repo-path>|<branch-name>"
CREATED_PATHS=()              # entries: filesystem paths
REGISTRY_SNAPSHOT=""
SEED_OK=0

run_rollback() {
  local exit_code=$?
  if [[ "$SEED_OK" == "1" ]]; then
    return 0
  fi
  if [[ ${#CREATED_LOCAL_BRANCHES[@]} -eq 0 \
        && ${#PUSHED_REMOTE_BRANCHES[@]} -eq 0 \
        && ${#CREATED_PATHS[@]} -eq 0 \
        && -z "$REGISTRY_SNAPSHOT" ]]; then
    return 0
  fi
  echo ""
  warn "seed.sh failed (exit $exit_code). Rolling back partial state..."

  # Restore registry from snapshot
  if [[ -n "$REGISTRY_SNAPSHOT" && -f "$REGISTRY_SNAPSHOT" ]]; then
    cp "$REGISTRY_SNAPSHOT" "$REGISTRY" 2>/dev/null || true
    rm -f "$REGISTRY_SNAPSHOT"
  fi

  # Delete pushed remote branches (reverse order)
  if [[ ${#PUSHED_REMOTE_BRANCHES[@]} -gt 0 ]]; then
    for ((i=${#PUSHED_REMOTE_BRANCHES[@]}-1; i>=0; i--)); do
      local entry="${PUSHED_REMOTE_BRANCHES[$i]}"
      local path="${entry%%|*}"
      local branch="${entry#*|}"
      git -C "$path" push origin --delete "$branch" 2>/dev/null || true
    done
  fi

  # Delete local branches (reverse order; switch off them first)
  if [[ ${#CREATED_LOCAL_BRANCHES[@]} -gt 0 ]]; then
    for ((i=${#CREATED_LOCAL_BRANCHES[@]}-1; i>=0; i--)); do
      local entry="${CREATED_LOCAL_BRANCHES[$i]}"
      local path="${entry%%|*}"
      local branch="${entry#*|}"
      local current=$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      if [[ "$current" == "$branch" ]]; then
        git -C "$path" reset --hard HEAD 2>/dev/null || true
        git -C "$path" checkout - 2>/dev/null \
          || git -C "$path" checkout "$DEFAULT_BRANCH" 2>/dev/null \
          || git -C "$path" checkout main 2>/dev/null \
          || true
      fi
      git -C "$path" branch -D "$branch" 2>/dev/null || true
    done
  fi

  # Delete created paths (reverse order — folders are usually created in order
  # of dependency, so reverse-deletion handles nested cases)
  if [[ ${#CREATED_PATHS[@]} -gt 0 ]]; then
    for ((i=${#CREATED_PATHS[@]}-1; i>=0; i--)); do
      [[ -n "${CREATED_PATHS[$i]}" ]] && rm -rf "${CREATED_PATHS[$i]}"
    done
  fi

  warn "Rollback complete. Workspace restored."
}

trap 'run_rollback' EXIT

# ── C01 Validation Gates ──────────────────────────────────────────────────────

echo "[ C01 ] Validating GitHub Project..."

# Parse project number and owner type from URL
# Supported: /orgs/ORG/projects/N  and  /users/USER/projects/N
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

# Fetch project metadata and linked items via GraphQL
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

# C02 warnings
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
PROJECT_ID="${ORG_SLUG}-${NNN}-${SHORT_SLUG}"
BRANCH="${ORG_SLUG_LOWER}-${NNN}-${SHORT_SLUG}"
TODAY=$(today)
PROJECT_DIR="$REPO_ROOT/projects/$PROJECT_ID"

echo "Project ID : $PROJECT_ID"
echo "Branch     : $BRANCH"
echo ""

# ── Leftover-state detection (graceful re-run after a failed run) ─────────────

cd "$REPO_ROOT"

LEFTOVER=()
if git rev-parse --verify "$BRANCH" &>/dev/null; then
  LEFTOVER+=("local branch '$BRANCH' in workspace repo")
fi
if git ls-remote --exit-code --heads origin "$BRANCH" &>/dev/null; then
  LEFTOVER+=("remote branch 'origin/$BRANCH' in workspace repo")
fi
if [[ -d "$PROJECT_DIR" ]]; then
  LEFTOVER+=("project folder 'projects/$PROJECT_ID'")
fi
if python3 - "$REGISTRY" "$PROJECT_ID" <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1]))
ids = [p.get('id') for p in (c.get('projects') or []) if p]
sys.exit(0 if sys.argv[2] in ids else 1)
PY
then
  LEFTOVER+=("registry entry for '$PROJECT_ID'")
fi
if [[ -d "$AGENT_WORK_ROOT/$PROJECT_ID" ]]; then
  LEFTOVER+=("clones at '$AGENT_WORK_ROOT/$PROJECT_ID'")
fi

if [[ ${#LEFTOVER[@]} -gt 0 ]]; then
  echo ""
  warn "Detected leftover state from a previous failed run for $PROJECT_ID:"
  for item in "${LEFTOVER[@]}"; do
    echo "    - $item"
  done
  echo ""
  if $NON_INTERACTIVE; then
    hard_stop "Leftover state detected for '$PROJECT_ID' and --non-interactive is set.
    Clean up manually, then re-run. Inspect with:
      git status
      ls projects/$PROJECT_ID
      grep $PROJECT_ID registry.yaml"
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
      git reset --hard HEAD 2>/dev/null || true
      current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      if [[ "$current_branch" == "$BRANCH" ]]; then
        git checkout "$DEFAULT_BRANCH" 2>/dev/null || true
      fi
      git pull --ff-only origin "$DEFAULT_BRANCH" 2>/dev/null || true
      git branch -D "$BRANCH" 2>/dev/null || true
      git push origin --delete "$BRANCH" 2>/dev/null || true
      rm -rf "$PROJECT_DIR"
      rm -rf "$AGENT_WORK_ROOT/$PROJECT_ID"
      # Remove stray registry entry (rare; usually only present if a prior
      # run got merged to default)
      python3 - "$REGISTRY" "$PROJECT_ID" <<'PY' 2>/dev/null || true
import sys, yaml
registry, pid = sys.argv[1:]
with open(registry) as f:
    c = yaml.safe_load(f)
projects = [p for p in (c.get('projects') or []) if p and p.get('id') != pid]
c['projects'] = projects
with open(registry, 'w') as f:
    yaml.dump(c, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY
      git checkout -- registry.yaml 2>/dev/null || true
      info "Cleanup complete. Continuing seed..."
      echo ""
      ;;
    *)
      hard_stop "Aborted at user request. Inspect manually with:
    git status
    ls projects/$PROJECT_ID
    cat registry.yaml | grep $PROJECT_ID"
      ;;
  esac
fi

# Snapshot registry before any edits — used by rollback
REGISTRY_SNAPSHOT="/tmp/registry.yaml.seed.$$"
cp "$REGISTRY" "$REGISTRY_SNAPSHOT"

# ── Create branch in workspace repo ──────────────────────────────────────────

git fetch origin "$DEFAULT_BRANCH"
git checkout "$DEFAULT_BRANCH"
git pull origin "$DEFAULT_BRANCH"
git checkout -b "$BRANCH"
CREATED_LOCAL_BRANCHES+=("$REPO_ROOT|$BRANCH")
echo "Created branch '$BRANCH' in workspace repo."
echo ""

# ── Scaffold project directory ────────────────────────────────────────────────

mkdir -p "$PROJECT_DIR"/{requirements,environment,knowledge}
CREATED_PATHS+=("$PROJECT_DIR")

# Scaffold the per-project to-do carry-forward file from the org-substituted
# template. The template has 'NNN-slug' as a literal placeholder for the
# project's specific NNN-slug suffix; we replace it here per project.
TODO_TEMPLATE="$REPO_ROOT/knowledge/guidance/todo-template.md"
if [[ -f "$TODO_TEMPLATE" ]]; then
  PROJECT_SUFFIX="${PROJECT_ID#${ORG_SLUG}-}"   # NNN-slug
  sed "s/NNN-slug/$PROJECT_SUFFIX/g" "$TODO_TEMPLATE" > "$PROJECT_DIR/knowledge/todo.md"
fi

# Discover repos linked to the project (one URL per line)
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

# Pre-load the URL list into an array. We use parallel arrays (URLS + BASES)
# rather than an associative array (declare -A) so this works on bash 3.2.
# We pre-load into the array BEFORE prompting so the inner `read` for the
# base-branch prompt doesn't conflict with a `while read` consuming the
# heredoc — that would silently EOF and exit the script.
REPO_URL_LIST=()
REPO_BASE_LIST=()

if [[ -n "$REPO_URLS" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    REPO_URL_LIST+=("$line")
  done <<< "$REPO_URLS"

  REPOS_BLOCK=""
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
    REPOS_BLOCK+="  - url: $repo_url"$'\n'
    REPOS_BLOCK+="    role: primary"$'\n'
    REPOS_BLOCK+="    base_branch: $base"$'\n'
    REPOS_BLOCK+="    added_at: $TODAY"$'\n'
    REPOS_BLOCK+="    added_reason: ~"$'\n'
  done
else
  warn "No repos detected from linked items — project.yaml repos[] left as placeholder."
  REPOS_BLOCK="  - url: ~"$'\n'
  REPOS_BLOCK+="    role: primary"$'\n'
  REPOS_BLOCK+="    base_branch: $DEFAULT_CODE_BRANCH"$'\n'
  REPOS_BLOCK+="    added_at: ~"$'\n'
  REPOS_BLOCK+="    added_reason: ~"$'\n'
fi

# Lookup helper for repo_url → base_branch (parallel-array lookup)
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

# Quote string scalars to keep YAML valid when values contain reserved chars
# (e.g. a project title that starts with '@', a github handle starting with
# '@', a URL containing ':'). Embedded double-quotes in user-controlled
# strings are escaped to '\"'.
yaml_quote() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/"/\\"/g')"
}
Q_PROJECT_ID=$(yaml_quote "$PROJECT_ID")
Q_SHORT_SLUG=$(yaml_quote "$SHORT_SLUG")
Q_GITHUB_PROJECT_URL=$(yaml_quote "$GITHUB_PROJECT_URL")
Q_PROJECT_TITLE=$(yaml_quote "$PROJECT_TITLE")
Q_ASSIGNEE=$(yaml_quote "$ASSIGNEE")
Q_CURRENT_USER=$(yaml_quote "$CURRENT_USER")

cat > "$PROJECT_DIR/project.yaml" <<YAML
id: $Q_PROJECT_ID
slug: $Q_SHORT_SLUG
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
reassignment_reason: ~
reassigned_at: ~
reassigned_approved_by: ~
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
# Project: $PROJECT_ID  |  Workspace: $WORKSPACE_REPO

## Knowledge Layer Priority (Highest to Lowest)

1. **Org-wide knowledge** → \`$WORKSPACE_REPO/knowledge/\`
2. **This project** → \`$WORKSPACE_REPO/projects/$PROJECT_ID/knowledge/\`
3. **Repo-local knowledge** → \`<repo>/knowledge/\`
4. **Your developer preferences** → \`$AGENT_WORK_ROOT/preferences/<your-gh-login>.md\`
   - At session start, run \`gh api user --jq .login\` to determine your handle.
   - Load only the file matching your handle.
   - Do NOT read other files in \`$AGENT_WORK_ROOT/preferences/\` — they belong
     to other developers and are not your context.

## Session Start Checklist (C01)

1. Verify \`project.yaml\` \`locked_by\` matches your identity
2. Verify \`status: active\`
3. Pull latest \`$BRANCH\` in all repos under \`$AGENT_WORK_ROOT/$PROJECT_ID/\`
4. Load your own preferences file (see layer 4 above)
5. Read \`projects/$PROJECT_ID/knowledge/todo.md\` and surface its \`## Open\`
   items to the developer before planning new work. This is the project's
   carry-forward list — intermediate to-dos from prior sessions live here.

## Workspace Layout

Your work happens across three locations:

- **Workspace repo** (where this file lives): \`$WORKSPACE_REPO\`
  Contains org policy & project metadata. Only \`projects/$PROJECT_ID/\` is
  writable in this project.

- **Code repo clones** (already cloned by seed):
  \`$AGENT_WORK_ROOT/$PROJECT_ID/<repo-name>/\`
  Each clone is on branch \`$BRANCH\`. Code changes go here — NOT in the
  workspace repo's tree.

- **GitHub Project board**: $GITHUB_PROJECT_URL
  The source of truth for work units. Issues linked here become tasks.
  Don't invent tasks; wait for issues on the board.

## Operational Workflow

1. Pick an issue from the GitHub Project board.
2. Start a task sub-branch: \`./prj task <issue-url>\`
   (creates \`$BRANCH/<task-slug>\` in workspace + all code repos;
    assigns the GitHub Issue.)
3. Do the work in the cloned code repos on the task sub-branch.
   Capture decisions, exceptions, and policy notes in
   \`projects/$PROJECT_ID/knowledge/\` as you go (not at the end).
   Capture intermediate to-dos in \`projects/$PROJECT_ID/knowledge/todo.md\`
   under \`## Open\` as they arise. Don't wait until session end.
4. When the task is complete: \`./prj merge\`
   (merges sub-branch into \`$BRANCH\`, archives the sub-branch.)
5. When the entire project is complete: \`./prj close\`
   (merges \`$BRANCH\` to default branch, archives, fires a knowledge
    proposal PR for domain-owner review.)

When an item from \`todo.md\` is resolved, move it from \`## Open\` to
\`## Done\` with a short note (commit SHA, PR link, or one-line outcome).
Projects are stateful, sessions are not — when you switch to a different
project's branch in the same session, re-run this checklist for the new
project and read its own todo.md.

## Do Not

- Edit \`project.yaml\` \`tasks\` list directly — use \`./prj task\` / \`./prj merge\`.
- Create GitHub Issues unilaterally. Issues represent business intent that
  humans add to the Project board.
- Make code changes inside the workspace repo's tree. Code work belongs in
  the cloned repos under \`$AGENT_WORK_ROOT\`.
- Touch \`$WORKSPACE_REPO/knowledge/\` — read-only this project.

## Write Restrictions (C01)

All writes in the workspace repo are constrained to \`projects/$PROJECT_ID/\`.
\`$WORKSPACE_REPO/knowledge/\` is read-only during this project.
Code repos have their own write rules (their own \`knowledge/agent.md\`).
MD

info "Scaffolded $PROJECT_DIR"

# ── Scaffold per-project tool-bootstrap files ────────────────────────────────
#
# The workspace repo carries a root-level bootstrap file for each major
# LLM coding tool (AGENTS.md, .cursor/rules/agent.mdc, etc.) — those
# files state the framework's session-start protocol with placeholder
# tokens '<PROJECT_ID>' / '<repo-name>' to indicate per-project values.
#
# Here we copy each root file into projects/<PID>/ at the same relative
# path, substituting '<PROJECT_ID>' with the actual project ID. The
# result: a developer opening their tool with workspace rooted at
# projects/<PID>/ will find the tool's expected config file with
# project-specific context already filled in. The agent.md scaffolded
# above remains the primary per-project entrypoint with workflow
# specifics; the tool files are restatements for tool-discovery.
#
# Skip silently if a root file is missing (adopter may have removed
# tools they don't use).

TOOL_FILES=(
  "AGENTS.md"
  "CONVENTIONS.md"
  ".cursor/rules/agent.mdc"
  ".clinerules/agent.md"
  ".windsurf/rules/agent.md"
  ".github/copilot-instructions.md"
  ".gemini/styleguide.md"
  ".continue/rules.md"
)

for rel in "${TOOL_FILES[@]}"; do
  src="$REPO_ROOT/$rel"
  dst="$PROJECT_DIR/$rel"
  [[ -f "$src" ]] || continue
  mkdir -p "$(dirname "$dst")"
  sed "s|<PROJECT_ID>|$PROJECT_ID|g" "$src" > "$dst"
done

# ── Clone repos and create project branches ───────────────────────────────────

if [[ ${#REPO_URL_LIST[@]} -gt 0 ]]; then
  mkdir -p "$AGENT_WORK_ROOT/$PROJECT_ID"
  CREATED_PATHS+=("$AGENT_WORK_ROOT/$PROJECT_ID")
  for repo_url in "${REPO_URL_LIST[@]}"; do
    REPO_NAME=$(get_repo_name "$repo_url")
    REPO_BASE=$(get_repo_base "$repo_url")
    REPO_DIR="$AGENT_WORK_ROOT/$PROJECT_ID/$REPO_NAME"

    echo "Processing repo: $repo_url"
    if [[ -d "$REPO_DIR/.git" ]]; then
      info "Already cloned — fetching..."
      git -C "$REPO_DIR" fetch origin
    else
      info "Cloning into $REPO_DIR..."
      git clone "$repo_url" "$REPO_DIR" \
        || hard_stop "Clone failed for $repo_url"
      CREATED_PATHS+=("$REPO_DIR")
    fi
    git -C "$REPO_DIR" checkout "$REPO_BASE" \
      || hard_stop "Base branch '$REPO_BASE' not found in $repo_url"
    git -C "$REPO_DIR" pull origin "$REPO_BASE" 2>/dev/null || true
    if git -C "$REPO_DIR" rev-parse --verify "$BRANCH" &>/dev/null; then
      hard_stop "Branch '$BRANCH' already exists in $repo_url — investigate before proceeding."
    fi
    git -C "$REPO_DIR" checkout -b "$BRANCH"
    CREATED_LOCAL_BRANCHES+=("$REPO_DIR|$BRANCH")
    git -C "$REPO_DIR" push -u origin "$BRANCH" \
      || hard_stop "Failed to push '$BRANCH' to $repo_url"
    PUSHED_REMOTE_BRANCHES+=("$REPO_DIR|$BRANCH")
    info "Branch '$BRANCH' pushed to $repo_url"
  done
fi

# ── Update registry.yaml ──────────────────────────────────────────────────────

python3 - "$REGISTRY" "$PROJECT_ID" "$BRANCH" "$TODAY" "$GITHUB_PROJECT_URL" $((LAST_ISSUED + 1)) "$PROJECT_OWNER" <<'PY'
import sys, yaml
registry, pid, branch, today, gh_url, new_last, owner = sys.argv[1:]
with open(registry) as f:
    c = yaml.safe_load(f)
c['last_issued'] = int(new_last)
if not c.get('projects'):
    c['projects'] = []
c['projects'].append({'id': pid, 'branch': branch, 'github_project': gh_url,
                      'github_owner': owner, 'created_at': today, 'status': 'active'})
with open(registry, 'w') as f:
    yaml.dump(c, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY

info "registry.yaml updated (last_issued → $NNN)"

# ── Commit and push workspace branch ─────────────────────────────────────────

cd "$REPO_ROOT"
git add "projects/$PROJECT_ID" registry.yaml
git commit -m "seed: scaffold project $PROJECT_ID"
git push -u origin "$BRANCH"
PUSHED_REMOTE_BRANCHES+=("$REPO_ROOT|$BRANCH")

# Mark seed complete — rollback trap will skip cleanup
SEED_OK=1
rm -f "$REGISTRY_SNAPSHOT"

echo ""
echo "=== Project seeded successfully!"
echo "    ID:        $PROJECT_ID"
echo "    Branch:    $BRANCH"
echo "    Directory: $PROJECT_DIR"
[[ ${#REPO_URL_LIST[@]} -gt 0 ]] && \
  echo "    Clones:    $AGENT_WORK_ROOT/$PROJECT_ID/"
echo ""
echo "Next steps:"
echo ""
echo "  1. Point your agent at this project's knowledge entrypoint:"
echo "       projects/$PROJECT_ID/agent.md"
echo "     It links the four knowledge layers the agent must load before"
echo "     writing any code (policy + org + repo + your prefs). Skipping"
echo "     this is what makes 'agents abide by policy' fail."
echo ""
if [[ ${#REPO_URL_LIST[@]} -gt 0 ]]; then
  echo "  2. Code work happens in the cloned code repo(s), not here:"
  for repo_url in "${REPO_URL_LIST[@]}"; do
    REPO_NAME=$(get_repo_name "$repo_url")
    echo "       cd $AGENT_WORK_ROOT/$PROJECT_ID/$REPO_NAME"
  done
  echo "     Each is on branch '$BRANCH'. Make changes there, not in"
  echo "     '$WORKSPACE_REPO/'."
  echo ""
fi
echo "  3. As you work, capture project context in:"
echo "       projects/$PROJECT_ID/knowledge/             (decisions, exceptions, compliance)"
echo "       projects/$PROJECT_ID/knowledge/todo.md      (intermediate to-dos that carry forward)"
echo "     Don't wait until the end — close-project refuses an empty knowledge folder."
echo ""
echo "  4. When the project is complete, from the workspace repo:"
echo "       ./prj close"
echo "     (Merges work back, archives the branch, opens a knowledge"
echo "     proposal PR for org-level review.)"
echo ""
