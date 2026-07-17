#!/usr/bin/env bash
# Verify install-deps.sh runs cleanly regardless of org-config.yaml state.
# (As of v0.1.1: install-deps is tools-only. GitHub identity / access
# verification has moved into setup.sh, where the configured github_org
# is known. This test confirms install-deps no longer reads org-config.yaml
# and exits cleanly even when the file is at template defaults.)

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

assert_exit_code 0 "$exit_code" "install-deps --check passes at template defaults"
assert_contains "All required tools installed" "$out" \
                "success message printed"
assert_contains "bash setup.sh" "$out" "directs user to setup.sh next"
# install-deps is tools-only — it must NOT verify gh auth (that lives in setup.sh; a
# gh-auth gate here breaks unauthenticated CI and fresh machines pre-`gh auth login`).
assert_not_contains "gh auth login" "$out" "no gh-auth gate in install-deps (tools-only)"

# The two-phase split was removed in v0.1.1: install-deps no longer reads
# org-config.yaml and no longer mentions any 'Phase 2' or GitHub access checks.
assert_not_contains "Phase 2" "$out" "no Phase 2 references"
assert_not_contains "GitHub identity & access:" "$out" "no GitHub access section"
assert_not_contains "template defaults" "$out" "no template-default branching"
assert_not_contains "re-run this script" "$out" "no re-run-me-later message"
