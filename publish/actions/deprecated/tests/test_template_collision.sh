#!/usr/bin/env bash
# Verify Direction A's collision-free property:
#
# An adopter clones TEMPLATE → runs setup.sh → gets a configured org workspace.
# The only files that should differ from TEMPLATE after setup are:
#   - org-config.yaml (org-specific values)
#   - any preference files setup.sh dropped under $AGENT_WORK_ROOT/preferences/
#     (these live outside the repo anyway)
#
# Everything else — framework files, knowledge/, policies/, scripts/, agent
# rule files — must remain byte-identical to TEMPLATE. That's what makes
# `git pull template main` conflict-free forever.

TEST_NAME="template_collision"
source "$(dirname "$0")/lib.sh"

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"; test_summary' EXIT

cd "$SCRATCH" || { t_fail "Cannot cd to scratch"; exit 1; }

# Mirror TEMPLATE state: copy the source tree, init a git repo, set origin
# to point at the test org repo URL (so setup.sh doesn't trigger the
# template-origin reconfigure flow), capture per-file hashes.
TEMPLATE_STATE="$SCRATCH/before"
mkdir -p "$TEMPLATE_STATE"
( cd "$REPO_ROOT" && git ls-files | tar -cf - -T - ) | tar -xf - -C "$TEMPLATE_STATE"

# Make a fresh working copy from the same tar, set up git + origin pointing
# at a fake org repo URL.
WORK="$SCRATCH/work"
mkdir -p "$WORK"
( cd "$REPO_ROOT" && git ls-files | tar -cf - -T - ) | tar -xf - -C "$WORK"
cd "$WORK"
git init -q
git remote add origin git@github.com:test-org-collision/test-workspace.git

# Capture per-file SHAs of every framework file we expect to remain unchanged.
# Exclude org-config.yaml (expected to change) and registry.yaml (may change
# if a project gets registered, but for this test setup.sh isn't seeding).
manifest_before=$(cd "$TEMPLATE_STATE" && find . -type f \
  -not -path './.git/*' \
  -not -name 'org-config.yaml' \
  | sort | xargs sha 2>/dev/null)

# Run setup.sh non-interactively. We need org-config.yaml to have a value
# for org_name to satisfy --non-interactive's precondition. Hand-edit it
# before the run.
cat > "$WORK/org-config.yaml" <<'YAML'
org_name: "Collision Test Org"
org_short_name: "ColTest"
org_slug: "CTC"
org_slug_lower: "ctc"
org_repo_url: "git@github.com:test-org-collision/test-workspace.git"
github_org: "test-org-collision"
workspace_repo: "test-workspace"
default_branch: "main"
default_code_branch: "dev"
agent_work_root: ""
policy_owner_email: "owner@test.com"
policy_owner_github: "@owner"
legal_owner_github: "@owner"
infra_owner_github: "@owner"
system_arch_owner_github: "@owner"
data_arch_owner_github: "@owner"
policy_effective_date: "2026-01-01"
YAML

SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 \
  bash "$WORK/setup.sh" --non-interactive >/dev/null 2>&1
exit_code=$?
assert_exit_code 0 "$exit_code" "setup.sh --non-interactive succeeded"

# Re-hash every framework file in the working copy.
manifest_after=$(cd "$WORK" && find . -type f \
  -not -path './.git/*' \
  -not -name 'org-config.yaml' \
  | sort | xargs sha 2>/dev/null)

# Compare. Anything that differs is a collision source.
if [[ "$manifest_before" != "$manifest_after" ]]; then
  t_fail "framework files diverged from TEMPLATE state after setup.sh"
  diff <(echo "$manifest_before") <(echo "$manifest_after") | head -20 \
    | sed 's/^/    /' || true
else
  t_pass "every non-config file is byte-identical to TEMPLATE state"
fi

# Spot-check: org-config.yaml DID change (that's the whole point).
sha_before=$(cd "$TEMPLATE_STATE" && sha org-config.yaml | awk '{print $1}')
sha_after=$(cd "$WORK" && sha org-config.yaml | awk '{print $1}')
assert_ne "$sha_before" "$sha_after" "org-config.yaml changed (expected — it's the org overlay)"
