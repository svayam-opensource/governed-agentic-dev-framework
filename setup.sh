#!/usr/bin/env bash
# Agentic Development Framework — Organization Setup Script
#
# Usage: bash setup.sh
#
# Reads org-config.yaml and substitutes all placeholder values throughout
# the framework files. Run this once when adopting this framework for your org.
#
# Prerequisites: yq (YAML parser) — install via: brew install yq
# Also works with python3 if yq is unavailable.

set -e

CONFIG="org-config.yaml"

if [ ! -f "$CONFIG" ]; then
  echo "Error: $CONFIG not found. Run this script from the repo root."
  exit 1
fi

# Read config values
if command -v yq &> /dev/null; then
  ORG_NAME=$(yq '.org_name' "$CONFIG" | tr -d '"')
  ORG_SHORT_NAME=$(yq '.org_short_name' "$CONFIG" | tr -d '"')
  ORG_SLUG=$(yq '.org_slug' "$CONFIG" | tr -d '"')
  ORG_SLUG_LOWER=$(yq '.org_slug_lower' "$CONFIG" | tr -d '"')
  GITHUB_ORG=$(yq '.github_org' "$CONFIG" | tr -d '"')
  WORKSPACE_REPO=$(yq '.workspace_repo' "$CONFIG" | tr -d '"')
  DEFAULT_BRANCH=$(yq '.default_branch' "$CONFIG" | tr -d '"')
  DEFAULT_CODE_BRANCH=$(yq '.default_code_branch' "$CONFIG" | tr -d '"')
  POLICY_OWNER_EMAIL=$(yq '.policy_owner_email' "$CONFIG" | tr -d '"')
  POLICY_OWNER_GITHUB=$(yq '.policy_owner_github' "$CONFIG" | tr -d '"')
  POLICY_EFFECTIVE_DATE=$(yq '.policy_effective_date' "$CONFIG" | tr -d '"')
else
  echo "yq not found — falling back to python3"
  ORG_NAME=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['org_name'])")
  ORG_SHORT_NAME=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['org_short_name'])")
  ORG_SLUG=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['org_slug'])")
  ORG_SLUG_LOWER=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['org_slug_lower'])")
  GITHUB_ORG=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['github_org'])")
  WORKSPACE_REPO=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['workspace_repo'])")
  DEFAULT_BRANCH=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['default_branch'])")
  DEFAULT_CODE_BRANCH=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['default_code_branch'])")
  POLICY_OWNER_EMAIL=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['policy_owner_email'])")
  POLICY_OWNER_GITHUB=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['policy_owner_github'])")
  POLICY_EFFECTIVE_DATE=$(python3 -c "import yaml,sys; c=yaml.safe_load(open('$CONFIG')); print(c['policy_effective_date'])")
fi

echo "Configuring framework for: $ORG_NAME ($ORG_SLUG)"
echo ""

# Files to process (all markdown and yaml files except org-config.yaml itself and .git)
FILES=$(find . -not -path './.git/*' -not -name 'org-config.yaml' -not -name 'setup.sh' \( -name '*.md' -o -name '*.yaml' -o -name '*.yml' -o -name 'CODEOWNERS' \))

# Perform substitutions in order (most specific first)
for FILE in $FILES; do
  sed -i '' \
    -e "s|{{ORG_NAME}}|$ORG_NAME|g" \
    -e "s|{{ORG_SHORT_NAME}}|$ORG_SHORT_NAME|g" \
    -e "s|{{ORG_SLUG}}|$ORG_SLUG|g" \
    -e "s|{{org_slug}}|$ORG_SLUG_LOWER|g" \
    -e "s|{{GITHUB_ORG}}|$GITHUB_ORG|g" \
    -e "s|{{WORKSPACE_REPO}}|$WORKSPACE_REPO|g" \
    -e "s|{{DEFAULT_BRANCH}}|$DEFAULT_BRANCH|g" \
    -e "s|{{DEFAULT_CODE_BRANCH}}|$DEFAULT_CODE_BRANCH|g" \
    -e "s|{{POLICY_OWNER_EMAIL}}|$POLICY_OWNER_EMAIL|g" \
    -e "s|{{POLICY_OWNER_GITHUB}}|$POLICY_OWNER_GITHUB|g" \
    -e "s|{{POLICY_EFFECTIVE_DATE}}|$POLICY_EFFECTIVE_DATE|g" \
    "$FILE"
done

echo "Done. All placeholders replaced with values from $CONFIG."
echo ""
echo "Next steps:"
echo "  1. Review the changes: git diff"
echo "  2. Commit: git add -A && git commit -m 'Configure framework for $ORG_NAME'"
echo "  3. If renaming the repo from 000-org-prj, update your GitHub remote URL"
