#!/usr/bin/env bash
# Script: seed
# Purpose: Transitions a project from PROPOSED to ACTIVE.
#          Scaffolds workspace, clones repos, creates branches.
# Usage:   bash seed.sh <github_project_url> <assignee>
# Compliance: C01 for all validation gates (POL-056 to POL-075)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

GITHUB_PROJECT_URL="${1:-}"
ASSIGNEE="${2:-}"

[[ -n "$GITHUB_PROJECT_URL" ]] || hard_stop "Usage: $0 <github_project_url> <assignee>"
[[ -n "$ASSIGNEE" ]]           || hard_stop "Usage: $0 <github_project_url> <assignee>"

echo "=== seed: $GITHUB_PROJECT_URL"
echo "    Assignee: $ASSIGNEE"
echo ""

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

echo "Project ID : $PROJECT_ID"
echo "Branch     : $BRANCH"
echo ""

# Guard: registry conflict
if python3 - "$REGISTRY" "$PROJECT_ID" <<'PY'; then
import sys, yaml
c = yaml.safe_load(open(sys.argv[1]))
ids = [p.get('id') for p in (c.get('projects') or []) if p]
sys.exit(0 if sys.argv[2] in ids else 1)
PY
  hard_stop "Registry conflict: $PROJECT_ID already exists — manual registry inspection required."
fi

# ── Create branch in workspace repo ──────────────────────────────────────────

cd "$REPO_ROOT"
git fetch origin "$DEFAULT_BRANCH"
git checkout "$DEFAULT_BRANCH"
git pull origin "$DEFAULT_BRANCH"
if git rev-parse --verify "$BRANCH" &>/dev/null; then
  hard_stop "Branch '$BRANCH' already exists in workspace repo — investigate before proceeding."
fi
git checkout -b "$BRANCH"
echo "Created branch '$BRANCH' in workspace repo."
echo ""

# ── Scaffold project directory ────────────────────────────────────────────────

PROJECT_DIR="$REPO_ROOT/projects/$PROJECT_ID"
mkdir -p "$PROJECT_DIR"/{requirements,environment,knowledge}

# Discover repos linked to the project
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

# Build repos section for project.yaml, prompting for base_branch per repo
REPOS_BLOCK=""
declare -A REPO_BASE_MAP=()

if [[ -n "$REPO_URLS" ]]; then
  while IFS= read -r repo_url; do
    [[ -z "$repo_url" ]] && continue
    printf "  Base branch for '%s' [%s]: " "$repo_url" "$DEFAULT_CODE_BRANCH"
    read -r input_base
    base="${input_base:-$DEFAULT_CODE_BRANCH}"
    REPO_BASE_MAP["$repo_url"]="$base"
    REPOS_BLOCK+="  - url: $repo_url"$'\n'
    REPOS_BLOCK+="    role: primary"$'\n'
    REPOS_BLOCK+="    base_branch: $base"$'\n'
    REPOS_BLOCK+="    added_at: $TODAY"$'\n'
    REPOS_BLOCK+="    added_reason: ~"$'\n'
  done <<< "$REPO_URLS"
else
  warn "No repos detected from linked items — project.yaml repos[] left as placeholder."
  REPOS_BLOCK="  - url: ~"$'\n'
  REPOS_BLOCK+="    role: primary"$'\n'
  REPOS_BLOCK+="    base_branch: $DEFAULT_CODE_BRANCH"$'\n'
  REPOS_BLOCK+="    added_at: ~"$'\n'
  REPOS_BLOCK+="    added_reason: ~"$'\n'
fi

CURRENT_USER=$(git config user.email 2>/dev/null || echo "$ASSIGNEE")

cat > "$PROJECT_DIR/project.yaml" <<YAML
id: $PROJECT_ID
slug: $SHORT_SLUG
description: ~
github_project: $GITHUB_PROJECT_URL
github_project_name: $PROJECT_TITLE
assigned_to: $ASSIGNEE
locked_by: $CURRENT_USER
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
4. **Developer preferences** → \`<agent_work_root>/preferences/agent.md\`

## Session Start Checklist (C01)

1. Verify \`project.yaml\` \`locked_by\` matches your identity
2. Verify \`status: active\`
3. Pull latest \`$BRANCH\` in all repos

## Write Restrictions (C01)

All writes are constrained to \`projects/$PROJECT_ID/\`.
\`$WORKSPACE_REPO/knowledge/\` is read-only during this project.

## GitHub Project

$GITHUB_PROJECT_URL
MD

info "Scaffolded $PROJECT_DIR"

# ── Clone repos and create project branches ───────────────────────────────────

if [[ -n "$REPO_URLS" ]]; then
  mkdir -p "$AGENT_WORK_ROOT/$PROJECT_ID"
  while IFS= read -r repo_url; do
    [[ -z "$repo_url" ]] && continue
    REPO_NAME=$(get_repo_name "$repo_url")
    REPO_BASE="${REPO_BASE_MAP[$repo_url]:-$DEFAULT_CODE_BRANCH}"
    REPO_DIR="$AGENT_WORK_ROOT/$PROJECT_ID/$REPO_NAME"

    echo "Processing repo: $repo_url"
    if [[ -d "$REPO_DIR/.git" ]]; then
      info "Already cloned — fetching..."
      git -C "$REPO_DIR" fetch origin
    else
      info "Cloning into $REPO_DIR..."
      git clone "$repo_url" "$REPO_DIR" \
        || hard_stop "Clone failed for $repo_url — script aborted (no partial scaffold)."
    fi
    git -C "$REPO_DIR" checkout "$REPO_BASE" \
      || hard_stop "Base branch '$REPO_BASE' not found in $repo_url"
    git -C "$REPO_DIR" pull origin "$REPO_BASE" 2>/dev/null || true
    if git -C "$REPO_DIR" rev-parse --verify "$BRANCH" &>/dev/null; then
      hard_stop "Branch '$BRANCH' already exists in $repo_url — investigate before proceeding."
    fi
    git -C "$REPO_DIR" checkout -b "$BRANCH"
    git -C "$REPO_DIR" push -u origin "$BRANCH" \
      || hard_stop "Failed to push '$BRANCH' to $repo_url"
    info "Branch '$BRANCH' pushed to $repo_url"
  done <<< "$REPO_URLS"
fi

# ── Update registry.yaml ──────────────────────────────────────────────────────

python3 - "$REGISTRY" "$PROJECT_ID" "$BRANCH" "$TODAY" "$GITHUB_PROJECT_URL" $((LAST_ISSUED + 1)) <<'PY'
import sys, yaml
registry, pid, branch, today, gh_url, new_last = sys.argv[1:]
with open(registry) as f:
    c = yaml.safe_load(f)
c['last_issued'] = int(new_last)
if not c.get('projects'):
    c['projects'] = []
c['projects'].append({'id': pid, 'branch': branch, 'github_project': gh_url,
                      'created_at': today, 'status': 'active'})
with open(registry, 'w') as f:
    yaml.dump(c, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
PY

info "registry.yaml updated (last_issued → $NNN)"

# ── Commit and push workspace branch ─────────────────────────────────────────

cd "$REPO_ROOT"
git add "projects/$PROJECT_ID" registry.yaml
git commit -m "seed: scaffold project $PROJECT_ID"
git push -u origin "$BRANCH"

echo ""
echo "=== Project seeded successfully!"
echo "    ID:        $PROJECT_ID"
echo "    Branch:    $BRANCH"
echo "    Directory: $PROJECT_DIR"
