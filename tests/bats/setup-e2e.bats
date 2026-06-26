#!/usr/bin/env bats
# P2 — fresh clone + setup E2E: a brand-new adopter clone runs setup.sh, and the
# result is a usable gov repo: org-config populated, gov_workspace recorded, the
# deterministic gov-home pointer written, and `prj` resolving to it from anywhere.
load helpers
setup() { sandbox_up; command -v git >/dev/null || skip "git not available (e.g. minimal container)"; }
teardown() { sandbox_down; }

# Mimic a fresh adopter clone in $TEST_TMP/clone and run setup.sh in it.
_fresh_clone_and_setup() {
  CLONE="$TEST_TMP/clone"; mkdir -p "$CLONE"; cd "$CLONE"
  git init -q
  git remote add origin git@github.com:test-org-fixture/000-test-prj.git
  cp "$REPO_SRC/setup.sh" .
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
gov_workspace: ""
policy_owner_email: ""
policy_owner_github: ""
legal_owner_github: ""
infra_owner_github: ""
system_arch_owner_github: ""
data_arch_owner_github: ""
policy_effective_date: ""
YAML
  printf 'TestCorp Industries\nTestCorp\nTST\n\n\n\ntestowner@example.com\n@testowner\n\n\n\n\n\n' \
    | SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 bash setup.sh >/dev/null 2>&1
}

@test "setup populates org-config (org repo established)" {
  _fresh_clone_and_setup
  run cat "$CLONE/org-config.yaml"
  assert_output --partial 'org_name: "TestCorp Industries"'
  assert_output --partial 'org_slug: "TST"'
  assert_output --partial 'github_org: "test-org-fixture"'
}

@test "setup records gov_workspace (canonical ~/.<slug>/gov_repo)" {
  _fresh_clone_and_setup
  run cat "$CLONE/org-config.yaml"
  assert_output --partial 'gov_workspace: "~/.tst/gov_repo"'
}

@test "setup writes the deterministic gov-home pointer file" {
  _fresh_clone_and_setup
  local ptr="$XDG_CONFIG_HOME/prj/gov-workspace"
  [ -s "$ptr" ]
  # pointer must reference the just-established gov repo (symlink-robust)
  run grep -q 'org_name: "TestCorp Industries"' "$(cat "$ptr")/org-config.yaml"
  assert_success
}

@test "after setup, prj resolves the gov home from /tmp (env unset, via pointer)" {
  _fresh_clone_and_setup
  cd /tmp
  run resolved_workspace
  assert_success
  [ -n "$output" ]
  run grep -q 'org_name: "TestCorp Industries"' "$output/org-config.yaml"
  assert_success
}
