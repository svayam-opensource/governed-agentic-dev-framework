#!/usr/bin/env bash
# Verify the interactive happy path of setup.sh in Direction A:
#   - Pipe in answers for the typed fields (org_name, org_short_name,
#     org_slug, policy_owner_email, policy_owner_github)
#   - Hit Enter through everything else (defaults to defaults / today)
#   - Confirm: org-config.yaml is written with correct values
#   - Confirm: org_slug_lower derived from org_slug
#   - Confirm: github_org and workspace_repo derived from origin
#   - Confirm: agent_work_root defaults to ~/.<org_slug_lower>/projects
#   - Confirm: framework files are NOT modified (no placeholder substitution)
#
# Note on trap order: lib.sh installs `trap test_summary EXIT`. We chain
# cleanup + test_summary so failures actually fail the test.

TEST_NAME="setup_interactive"
source "$(dirname "$0")/lib.sh"

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"; test_summary' EXIT

cd "$SCRATCH" || { t_fail "Cannot cd to scratch"; exit 1; }

# Mimic a fresh adopter clone: an org-owned repo (NOT the template URL)
# already configured as origin, and the TEMPLATE-shipped empty org-config.
git init -q
git remote add origin git@github.com:test-org-fixture/000-test-prj.git
cp "$REPO_ROOT/setup.sh" .
chmod +x setup.sh
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

# Framework-file fixture: tokens should stay verbatim after setup runs.
cat > test-fixture.md <<'MD'
# <ORG_NAME> workspace

Slug: <ORG_SLUG> (lowercase <org_slug>)
GitHub org: <GITHUB_ORG>
Workspace repo: <WORKSPACE_REPO>
Policy owner: <POLICY_OWNER_EMAIL> (<POLICY_OWNER_GITHUB>)
Legal: <LEGAL_OWNER_GITHUB>
Effective: <POLICY_EFFECTIVE_DATE>
MD
ORIG_FIXTURE_SHA=$(shasum test-fixture.md | awk '{print $1}')

# Pipe answers (origin is NOT the template, so no org_repo_url prompt):
#   org_name:           TestCorp Industries
#   org_short_name:     TestCorp
#   org_slug:           TST
#   default_branch:     (Enter — default "main")
#   default_code:       (Enter — default "dev")
#   agent_work_root:    (Enter — default ~/.tst/projects)
#   policy_owner_email: testowner@example.com
#   policy_owner_github:@testowner
#   legal/infra/sys/data: (Enter ×4 — default to policy_owner_github)
#   effective_date:     (Enter — default today)
out=$(printf 'TestCorp Industries\nTestCorp\nTST\n\n\n\ntestowner@example.com\n@testowner\n\n\n\n\n\n' \
      | SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 bash setup.sh 2>&1)
exit_code=$?

assert_exit_code 0 "$exit_code" "setup.sh exits 0 on happy path"

# org-config.yaml contents
config=$(cat org-config.yaml)
assert_contains 'org_name: "TestCorp Industries"'      "$config" "org_name written"
assert_contains 'org_short_name: "TestCorp"'            "$config" "org_short_name written"
assert_contains 'org_slug: "TST"'                       "$config" "org_slug written"
assert_contains 'org_slug_lower: "tst"'                 "$config" "org_slug_lower derived"
assert_contains 'github_org: "test-org-fixture"'        "$config" "github_org derived from origin"
assert_contains 'workspace_repo: "000-test-prj"'        "$config" "workspace_repo derived from origin"
assert_contains 'default_branch: "main"'                "$config" "default_branch defaulted"
assert_contains 'default_code_branch: "dev"'            "$config" "default_code_branch defaulted"
assert_contains '/.tst/projects'                        "$config" "agent_work_root defaulted to ~/.tst/projects"
assert_contains 'policy_owner_email: "testowner@example.com"' "$config" "policy_owner_email written"
assert_contains 'policy_owner_github: "@testowner"'     "$config" "policy_owner_github written"
assert_contains 'legal_owner_github: "@testowner"'      "$config" "legal_owner_github defaults to policy_owner_github"
assert_contains 'infra_owner_github: "@testowner"'      "$config" "infra_owner_github defaults to policy_owner_github"
assert_contains 'system_arch_owner_github: "@testowner"' "$config" "system_arch defaults to policy_owner_github"
assert_contains 'data_arch_owner_github: "@testowner"'  "$config" "data_arch defaults to policy_owner_github"

# Direction A: framework file is UNTOUCHED — tokens remain verbatim,
# byte-for-byte hash matches the pre-setup version.
NEW_FIXTURE_SHA=$(shasum test-fixture.md | awk '{print $1}')
assert_eq "$ORIG_FIXTURE_SHA" "$NEW_FIXTURE_SHA" "framework file byte-identical after setup (no substitution)"
fixture=$(cat test-fixture.md)
assert_contains "<ORG_NAME>"          "$fixture" "<ORG_NAME> token preserved"
assert_contains "<ORG_SLUG>"          "$fixture" "<ORG_SLUG> token preserved"
assert_contains "<GITHUB_ORG>"        "$fixture" "<GITHUB_ORG> token preserved"
assert_not_contains "{{" "$fixture" "no {{}} placeholders ever existed"
