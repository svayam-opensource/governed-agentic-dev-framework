#!/usr/bin/env bash
# Verify setup.sh refuses to run when 'origin' points at the framework's
# upstream template repo (the most likely adopter foot-gun: cloning the
# template directly instead of clicking "Use this template" on GitHub).

TEST_NAME="setup_template_origin"
source "$(dirname "$0")/lib.sh"

# Build a scratch repo that mimics a fresh template clone:
#   - copy of setup.sh + a minimal org-config.yaml
#   - origin pointing at Svayamtech/agentic-development-framework
SCRATCH=$(mktemp -d)
trap "rm -rf '$SCRATCH'" EXIT
cd "$SCRATCH" || { t_fail "Cannot cd to scratch"; exit 1; }

git init -q
git remote add origin git@github.com:Svayamtech/agentic-development-framework.git
cp "$REPO_ROOT/setup.sh" .
chmod +x setup.sh
cat > org-config.yaml <<'YAML'
org_name: "Your Organization Name"
org_short_name: "YourOrg"
org_slug: "ORG"
org_slug_lower: "org"
github_org: "your-github-org"
workspace_repo: "000-org-prj"
default_branch: "main"
default_code_branch: "dev"
policy_owner_email: "you@example.com"
policy_owner_github: "@your-github-handle"
legal_owner_github: "@legal-owner-tbd"
infra_owner_github: "@infrastructure-owner-tbd"
system_arch_owner_github: "@system-arch-owner-tbd"
data_arch_owner_github: "@data-arch-owner-tbd"
policy_effective_date: "YYYY-MM-DD"
YAML

out=$(bash setup.sh 2>&1)
exit_code=$?

assert_exit_code 1 "$exit_code" "setup.sh refuses template origin"
assert_contains "framework's source template" "$out" "error names the template"
assert_contains "Use this template" "$out" "error suggests the right path"
assert_contains "git remote set-url origin" "$out" "error suggests fix"
