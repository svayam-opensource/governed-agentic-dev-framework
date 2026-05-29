#!/usr/bin/env bash
# Verify setup.sh's behavior when 'origin' still points at the framework's
# upstream TEMPLATE repo: rather than refusing, it prompts for the org's own
# repo URL and reconfigures remotes:
#   - origin  → the user-provided org repo URL
#   - template → the original TEMPLATE URL (for future `git pull template main`)
#
# Direction A: setup.sh's job is to configure the org. A fresh `git clone`
# of TEMPLATE is the supported starting point.

TEST_NAME="setup_template_origin"
source "$(dirname "$0")/lib.sh"

SCRATCH=$(mktemp -d)
trap "rm -rf '$SCRATCH'" EXIT
cd "$SCRATCH" || { t_fail "Cannot cd to scratch"; exit 1; }

git init -q
git remote add origin git@github.com:svayam-opensource/governed-agentic-dev-framework.git
cp "$REPO_ROOT/setup.sh" .
chmod +x setup.sh

# Empty-values org-config (the TEMPLATE state shipped by the framework).
cat > org-config.yaml <<'YAML'
org_name: ""
org_short_name: ""
org_slug: ""
org_slug_lower: ""
org_repo_url: ""
github_org: ""
workspace_repo: ""
default_branch: "main"
default_code_branch: "dev"
agent_work_root: ""
policy_owner_email: ""
policy_owner_github: ""
legal_owner_github: ""
infra_owner_github: ""
system_arch_owner_github: ""
data_arch_owner_github: ""
policy_effective_date: ""
YAML

# Need at least one framework file in the scratch to prove it's untouched.
cat > FRAMEWORK_FILE.md <<'MD'
# Framework file
Tokens like <ORG_NAME>, <DEFAULT_BRANCH>, <GITHUB_ORG> should stay verbatim.
MD
ORIG_FRAMEWORK_SHA=$(shasum FRAMEWORK_FILE.md | awk '{print $1}')

# Pipe answers (in prompt order):
#   org_repo_url           (prompted because origin == TEMPLATE)
#   org_name
#   org_short_name
#   org_slug
#   default_branch         (Enter = "main")
#   default_code_branch    (Enter = "dev")
#   agent_work_root        (Enter = ~/.tst/projects)
#   policy_owner_email
#   policy_owner_github
#   legal/infra/sys_arch/data_arch  (Enter ×4)
#   policy_effective_date  (Enter = today)
out=$(printf 'git@github.com:test-org/my-governance.git\nTestCorp Industries\nTestCorp\nTST\n\n\n\nowner@test.com\n@owner\n\n\n\n\n\n' \
      | SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 bash setup.sh 2>&1)
exit_code=$?

assert_exit_code 0 "$exit_code" "setup.sh succeeds (reconfigures rather than refuses)"

# org-config.yaml populated
config=$(cat org-config.yaml)
assert_contains 'org_repo_url: "git@github.com:test-org/my-governance.git"' "$config" "org_repo_url captured"
assert_contains 'org_name: "TestCorp Industries"'                            "$config" "org_name captured"
assert_contains 'org_slug: "TST"'                                            "$config" "org_slug captured"
assert_contains 'github_org: "test-org"'                                     "$config" "github_org derived from org_repo_url"
assert_contains 'workspace_repo: "my-governance"'                            "$config" "workspace_repo derived from org_repo_url"

# Framework file unchanged (direction A: no in-place substitution)
NEW_FRAMEWORK_SHA=$(shasum FRAMEWORK_FILE.md | awk '{print $1}')
assert_eq "$ORIG_FRAMEWORK_SHA" "$NEW_FRAMEWORK_SHA" "framework file untouched by setup.sh"
