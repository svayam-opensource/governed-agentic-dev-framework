#!/usr/bin/env bash
# Verify setup.sh validates the org_slug input:
#   - Rejects: lowercase, special chars, too short, too long, leading digit
#   - Accepts: 2-6 uppercase letters/digits starting with a letter

TEST_NAME="setup_slug_validation"
source "$(dirname "$0")/lib.sh"

SCRATCH=$(mktemp -d)
# Chain cleanup + test_summary; bare `trap "rm ..." EXIT` would clobber
# lib.sh's trap and make the test exit 0 regardless of assertion failures.
trap 'rm -rf "$SCRATCH"; test_summary' EXIT
cd "$SCRATCH" || { t_fail "Cannot cd to scratch"; exit 1; }

# Use a benign user-account origin (not the template) so setup.sh doesn't
# trigger the template-origin reconfigure flow.
git init -q
git remote add origin git@github.com:svayam-rkant/test-slug-validation.git
cp "$REPO_ROOT/setup.sh" .
chmod +x setup.sh
# TEMPLATE-state org-config: every field empty (Direction A baseline).
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

# Each test: pipe a sequence of inputs through setup.sh.
# We give: org_name, org_short_name, slug attempt(s), then exit on EOF.
# The slug validator re-prompts on bad input; if it ever accepts a bad
# slug (or rejects a good one), this surfaces in the captured output.

run_setup() {
  local stdin="$1"
  printf '%s' "$stdin" | SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 SETUP_SKIP_SHELL_RC=1 bash setup.sh 2>&1 || true
}

# Bad slugs should produce the validation error message
for bad in "acme" "a" "TOOLONG7" "1ACME" "AC-ME" "AC ME" ""; do
  out=$(run_setup "Test Corp
Test
$bad
")
  if [[ "$out" == *"2-6 uppercase letters/digits"* ]]; then
    t_pass "rejects bad slug: '$bad'"
  else
    t_fail "did not reject bad slug '$bad' — output: $(printf '%.200s' "$out")"
  fi
done

# Good slug should not trigger the validation error
out=$(run_setup "Test Corp
Test
ACME
")
if [[ "$out" != *"2-6 uppercase letters/digits"* ]]; then
  t_pass "accepts good slug: ACME"
else
  t_fail "wrongly rejected good slug ACME"
fi
