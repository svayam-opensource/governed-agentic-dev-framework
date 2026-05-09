#!/usr/bin/env bash
# Verify install-deps.sh skips Phase 2 (GitHub identity & access checks) when
# org-config.yaml is at template defaults — the bootstrap state for an adopter
# who just cloned the template and hasn't yet run setup.sh.

TEST_NAME="install_deps_template"
source "$(dirname "$0")/lib.sh"

SCRATCH=$(mktemp -d)
trap "rm -rf '$SCRATCH'" EXIT

# Build a fake repo root with template-default org-config.yaml and a copy of
# install-deps.sh in a scripts/ subdir
mkdir -p "$SCRATCH/scripts"
cat > "$SCRATCH/org-config.yaml" <<'YAML'
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
cp "$REPO_ROOT/scripts/install-deps.sh" "$SCRATCH/scripts/"
chmod +x "$SCRATCH/scripts/install-deps.sh"

out=$(bash "$SCRATCH/scripts/install-deps.sh" --check 2>&1)
exit_code=$?

assert_exit_code 0 "$exit_code" "install-deps passes Phase 1 at template defaults"
assert_contains "template defaults" "$out" "template-default state is detected"
assert_contains "Phase 2" "$out" "Phase 2 skip is announced"
assert_contains "Tools-only check passed" "$out" "tools-only success message"
assert_not_contains "GitHub identity & access:" "$out" "Phase 2 not run"
