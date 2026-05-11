#!/usr/bin/env bash
# Verify the interactive happy path of setup.sh:
#   - Pipe in answers for the 5 typed fields (org_name, org_short_name,
#     org_slug, policy_owner_email, policy_owner_github)
#   - Hit Enter through everything else (defaults to defaults / today)
#   - Confirm: org-config.yaml is written with correct values
#   - Confirm: github_org and workspace_repo derived from origin
#   - Confirm: org_slug_lower derived from org_slug
#   - Confirm: domain owners default to policy_owner_github
#
# Note on trap order: lib.sh installs `trap test_summary EXIT` so the
# assertion counts produce a real exit code. This test also needs to
# clean up its scratch dir on exit. Naively writing `trap "rm -rf ..." EXIT`
# OVERRIDES lib.sh's trap (only one EXIT trap can be active in bash);
# the test would then exit 0 regardless of assertion failures. The fix
# is to call both in a single trap, in the right order: rm first, then
# test_summary (which calls `exit`).

TEST_NAME="setup_interactive"
source "$(dirname "$0")/lib.sh"

SCRATCH=$(mktemp -d)
# Chain cleanup + test_summary so failures actually fail the test.
# lib.sh's plain `trap test_summary EXIT` is replaced by this composite.
trap 'rm -rf "$SCRATCH"; test_summary' EXIT

cd "$SCRATCH" || { t_fail "Cannot cd to scratch"; exit 1; }

# Mimic a fresh adopter clone: real-looking origin, template-default config
git init -q
git remote add origin git@github.com:test-org-fixture/000-test-prj.git
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

# We need at least one .md file present so the substitution loop has
# something to walk. Use a minimal placeholder doc.
cat > test-fixture.md <<'MD'
# {{ORG_NAME}} workspace

Slug: {{ORG_SLUG}} (lowercase {{org_slug}})
GitHub org: {{GITHUB_ORG}}
Workspace repo: {{WORKSPACE_REPO}}
Policy owner: {{POLICY_OWNER_EMAIL}} ({{POLICY_OWNER_GITHUB}})
Legal: {{LEGAL_OWNER_GITHUB}}
Effective: {{POLICY_EFFECTIVE_DATE}}
MD

# Pipe answers through:
#   org_name:           TestCorp Industries
#   org_short_name:     TestCorp
#   org_slug:           TST
#   default_branch:     (Enter — accepts default)
#   default_code:       (Enter)
#   policy_owner_email: testowner@example.com   (REQUIRED — typed)
#   policy_owner_github:@testowner               (REQUIRED — typed)
#   legal:              (Enter — defaults to policy_owner_github)
#   infra:              (Enter)
#   sys_arch:           (Enter)
#   data_arch:          (Enter)
#   effective_date:     (Enter — defaults to today)
# SETUP_SKIP_GITHUB_VERIFY=1 prevents setup.sh from trying to verify the
# fake test-org-fixture github_org against real GitHub at the end of the
# run, and is also what allows the run to complete without a working
# gh CLI (the prefs bootstrap is gh-conditional and skips when absent).
out=$(printf 'TestCorp Industries\nTestCorp\nTST\n\n\ntestowner@example.com\n@testowner\n\n\n\n\n\n' \
      | SETUP_SKIP_GITHUB_VERIFY=1 bash setup.sh 2>&1)
exit_code=$?

assert_exit_code 0 "$exit_code" "setup.sh exits 0 on happy path"

# Verify org-config.yaml contents
config=$(cat org-config.yaml)
assert_contains 'org_name: "TestCorp Industries"'      "$config" "org_name written"
assert_contains 'org_short_name: "TestCorp"'            "$config" "org_short_name written"
assert_contains 'org_slug: "TST"'                       "$config" "org_slug written"
assert_contains 'org_slug_lower: "tst"'                 "$config" "org_slug_lower derived"
assert_contains 'github_org: "test-org-fixture"'        "$config" "github_org derived from origin"
assert_contains 'workspace_repo: "000-test-prj"'        "$config" "workspace_repo derived from origin"
assert_contains 'default_branch: "main"'                "$config" "default_branch defaulted"
assert_contains 'default_code_branch: "dev"'            "$config" "default_code_branch defaulted"
assert_contains 'policy_owner_email: "testowner@example.com"' "$config" "policy_owner_email written"
assert_contains 'policy_owner_github: "@testowner"'     "$config" "policy_owner_github written"
assert_contains 'legal_owner_github: "@testowner"'      "$config" "legal_owner_github defaults to policy_owner_github"
assert_contains 'infra_owner_github: "@testowner"'      "$config" "infra_owner_github defaults to policy_owner_github"
assert_contains 'system_arch_owner_github: "@testowner"' "$config" "system_arch defaults to policy_owner_github"
assert_contains 'data_arch_owner_github: "@testowner"'  "$config" "data_arch defaults to policy_owner_github"

# Verify substitution worked in the fixture file
fixture=$(cat test-fixture.md)
assert_contains "TestCorp Industries workspace"          "$fixture" "ORG_NAME substituted"
assert_contains "Slug: TST"                              "$fixture" "ORG_SLUG substituted"
assert_contains "lowercase tst"                          "$fixture" "org_slug substituted"
assert_contains "GitHub org: test-org-fixture"           "$fixture" "GITHUB_ORG substituted"
assert_contains "Workspace repo: 000-test-prj"           "$fixture" "WORKSPACE_REPO substituted"
assert_contains "testowner@example.com"                  "$fixture" "POLICY_OWNER_EMAIL substituted"
assert_contains "@testowner"                             "$fixture" "POLICY_OWNER_GITHUB substituted"
assert_not_contains "{{" "$fixture" "no leftover placeholders"
