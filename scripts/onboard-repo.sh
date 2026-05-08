#!/usr/bin/env bash
# Script: onboard-repo
# Purpose: Initializes the knowledge/ folder structure in an existing code repo,
#          bringing it under the {{ORG_SHORT_NAME}} Agentic Development Policy.
# Usage:   bash onboard-repo.sh <repo_url> <repo_description> <repo_owner>
# Compliance: C02 — repo owner must approve the PR (POL-108)

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

# ── Inputs ────────────────────────────────────────────────────────────────────

REPO_URL="${1:-}"
REPO_DESC="${2:-}"
REPO_OWNER="${3:-}"

[[ -n "$REPO_URL"   ]] || hard_stop "Usage: $0 <repo_url> <repo_description> <repo_owner>"
[[ -n "$REPO_DESC"  ]] || hard_stop "Usage: $0 <repo_url> <repo_description> <repo_owner>"
[[ -n "$REPO_OWNER" ]] || hard_stop "Usage: $0 <repo_url> <repo_description> <repo_owner>"

REPO_NAME=$(get_repo_name "$REPO_URL")
ONBOARD_BRANCH="onboard-knowledge"

echo "=== onboard-repo: $REPO_URL"
echo "    Description: $REPO_DESC"
echo "    Owner:       $REPO_OWNER"
echo ""

# ── Clone or locate repo ──────────────────────────────────────────────────────

TMP_CLONE=false
REPO_DIR="$AGENT_WORK_ROOT/onboard/$REPO_NAME"

if [[ -d "$REPO_DIR/.git" ]]; then
  info "Found existing clone at $REPO_DIR — fetching..."
  git -C "$REPO_DIR" fetch origin
else
  info "Cloning $REPO_URL → $REPO_DIR..."
  mkdir -p "$AGENT_WORK_ROOT/onboard"
  git clone "$REPO_URL" "$REPO_DIR" || hard_stop "Clone failed for $REPO_URL — verify access."
  TMP_CLONE=true
fi

# Detect default branch
REPO_DEFAULT_BRANCH=$(git -C "$REPO_DIR" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
  | sed 's|refs/remotes/origin/||') || REPO_DEFAULT_BRANCH="main"

# ── Pre-conditions ────────────────────────────────────────────────────────────

if [[ -d "$REPO_DIR/knowledge" ]]; then
  hard_stop "knowledge/ already exists in $REPO_NAME — investigate existing structure."
fi

if git -C "$REPO_DIR" ls-remote --exit-code origin "$ONBOARD_BRANCH" &>/dev/null; then
  hard_stop "Branch '$ONBOARD_BRANCH' already exists in $REPO_NAME — investigate before proceeding."
fi

# ── Create onboard-knowledge branch ──────────────────────────────────────────

git -C "$REPO_DIR" checkout "$REPO_DEFAULT_BRANCH"
git -C "$REPO_DIR" pull origin "$REPO_DEFAULT_BRANCH" 2>/dev/null || true
git -C "$REPO_DIR" checkout -b "$ONBOARD_BRANCH"

# ── Scaffold knowledge/ folder ────────────────────────────────────────────────

mkdir -p "$REPO_DIR/knowledge/repo"

# knowledge/agent.md — from repo-agent-template
cat > "$REPO_DIR/knowledge/agent.md" <<MD
# $REPO_NAME — Agent Entry Point

**Repository:** $REPO_URL
**Purpose:** $REPO_DESC
**Owner:** $REPO_OWNER

---

## Important: Knowledge Layer Priority

This file represents the **repo-local knowledge layer** — third priority.

\`\`\`
1. Org-wide knowledge      → $WORKSPACE_REPO/knowledge/        [HIGHEST]
2. Project knowledge       → $WORKSPACE_REPO/projects/<project-id>/knowledge/
3. This repo's knowledge   → this file and knowledge/repo/      [THIS FILE]
4. Developer preferences   → <agent_work_root>/preferences/
\`\`\`

**This file cannot override org-wide knowledge or policy.**
See \`$WORKSPACE_REPO/knowledge/policies/agentic-development-policy.md\`.

---

## Repo Knowledge

Read the following before working in this repository:

- \`knowledge/repo/structure.md\`   — directory layout, modules, packages
- \`knowledge/repo/environment.md\` — build tools, dependencies, setup instructions
- \`knowledge/repo/patterns.md\`    — coding conventions, architectural patterns

---

## Write Restrictions

During an active project:
- Do NOT modify \`knowledge/repo/\` directly
- All knowledge writes go to \`$WORKSPACE_REPO/projects/<project-id>/knowledge/\`
- Repo knowledge is updated only via the project's knowledge close PR

---

## Data Classification Reminder

Never commit credentials, secrets, API keys, or PII (C01).
See \`$WORKSPACE_REPO/knowledge/policies/data-classification.md\`.
MD

# knowledge/repo/structure.md — placeholder
cat > "$REPO_DIR/knowledge/repo/structure.md" <<MD
# $REPO_NAME — Repository Structure

**Owner:** $REPO_OWNER
**TODO:** Populate this file with the repository's directory layout.

---

## Directory Layout

\`\`\`
<describe the top-level directories and their purpose>
\`\`\`

## Key Modules / Packages

- \`<module>\` — <description>

## Entry Points

- \`<main file or command>\` — <description>
MD

# knowledge/repo/environment.md — placeholder
cat > "$REPO_DIR/knowledge/repo/environment.md" <<MD
# $REPO_NAME — Environment & Setup

**Owner:** $REPO_OWNER
**TODO:** Populate this file with build tools, dependencies, and local setup.

---

## Prerequisites

- <tool> <version>
- <tool> <version>

## Local Setup

\`\`\`bash
# Steps to get this repo running locally
\`\`\`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| \`ENV_VAR\` | Yes | Description |

## Running Tests

\`\`\`bash
# How to run the test suite
\`\`\`
MD

# knowledge/repo/patterns.md — placeholder
cat > "$REPO_DIR/knowledge/repo/patterns.md" <<MD
# $REPO_NAME — Patterns & Conventions

**Owner:** $REPO_OWNER
**TODO:** Populate this file with coding conventions and architectural patterns.

---

## Coding Style

- Language: <language>
- Linter / formatter: <tool>
- Key conventions: <describe>

## Architectural Patterns

- <pattern name>: <description>

## Common Pitfalls

- <pitfall>: <how to avoid>
MD

info "Scaffolded knowledge/ folder."

# ── Commit and push ───────────────────────────────────────────────────────────

git -C "$REPO_DIR" add knowledge/
git -C "$REPO_DIR" commit -m "onboard: initialize knowledge/ folder for agentic development"
git -C "$REPO_DIR" push -u origin "$ONBOARD_BRANCH" \
  || hard_stop "Push failed for $REPO_URL — verify push access."

info "Branch '$ONBOARD_BRANCH' pushed."

# ── Raise PR ──────────────────────────────────────────────────────────────────

echo "Raising PR..."

PR_BODY=$(cat <<MD
## [Onboard] Initialize \`knowledge/\` folder for agentic development

This PR adds the \`knowledge/\` folder structure to bring **$REPO_NAME** under the
$ORG_NAME Agentic Development Policy.

### What was added

- \`knowledge/agent.md\` — agent entry point with knowledge layer priority
- \`knowledge/repo/structure.md\` — placeholder for repo structure
- \`knowledge/repo/environment.md\` — placeholder for build/setup instructions
- \`knowledge/repo/patterns.md\` — placeholder for coding conventions

### What the repo owner needs to do after merging

Please populate the placeholder files with accurate information:

1. **\`knowledge/repo/structure.md\`** — describe the directory layout and key modules
2. **\`knowledge/repo/environment.md\`** — document build tools, env vars, setup steps
3. **\`knowledge/repo/patterns.md\`** — document coding conventions and architectural patterns

Submit these as a follow-up PR directly in this repo.

### What this PR does NOT do

- Does not modify CI/CD pipelines
- Does not add application code
- Does not enforce any structural changes beyond adding \`knowledge/\`

*Generated by onboard-repo.sh*
MD
)

PR_URL=$(gh pr create \
  --repo "$REPO_URL" \
  --base "$REPO_DEFAULT_BRANCH" \
  --head "$ONBOARD_BRANCH" \
  --title "[Onboard] Initialize knowledge/ folder for agentic development" \
  --body "$PR_BODY" \
  2>/dev/null) \
  || {
    warn "PR creation failed — retrying..."
    PR_URL=$(gh pr create \
      --repo "$REPO_URL" \
      --base "$REPO_DEFAULT_BRANCH" \
      --head "$ONBOARD_BRANCH" \
      --title "[Onboard] Initialize knowledge/ folder for agentic development" \
      --body "$PR_BODY")
  }

echo ""
echo "=== Onboarding PR created!"
echo "    PR:   $PR_URL"
echo ""
echo "    After the repo owner merges this PR, they should populate:"
echo "    - knowledge/repo/structure.md"
echo "    - knowledge/repo/environment.md"
echo "    - knowledge/repo/patterns.md"
