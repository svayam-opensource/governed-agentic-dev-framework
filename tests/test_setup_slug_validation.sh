#!/usr/bin/env bash
# Verify setup.sh validates the org_slug input:
#   - Rejects: lowercase, special chars, too short, too long, leading digit
#   - Accepts: 2-6 uppercase letters/digits starting with a letter

TEST_NAME="setup_slug_validation"
source "$(dirname "$0")/lib.sh"

SCRATCH=$(mktemp -d)
trap "rm -rf '$SCRATCH'" EXIT
cd "$SCRATCH" || { t_fail "Cannot cd to scratch"; exit 1; }

# Use a benign user-account origin (not the template) so the early refusal
# doesn't fire. svayam-rkant is the gh-authenticated user in this session.
git init -q
git remote add origin git@github.com:svayam-rkant/test-slug-validation.git
cp "$REPO_ROOT/setup.sh" .
chmod +x setup.sh
cat > org-config.yaml <<'YAML'
org_name: "Test Corp"
org_short_name: "Test"
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
policy_effective_date: "2026-05-09"
YAML

# Each test: pipe a sequence of inputs through setup.sh.
# We give: org_name, org_short_name, slug attempt(s), then exit on EOF.
# The slug validator re-prompts on bad input; if it ever accepts a bad
# slug (or rejects a good one), this surfaces in the captured output.

run_setup() {
  local stdin="$1"
  printf '%s' "$stdin" | bash setup.sh 2>&1 || true
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
