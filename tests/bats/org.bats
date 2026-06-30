#!/usr/bin/env bats
# Multi-org registry + `prj org` (PRJ-43). A developer in several orgs has several gov
# repos; the single global pointer could only name one (whichever setup ran last), so
# from a neutral cwd prj silently used the wrong org. The registry + active-org fix that:
# cwd-walk → active-org → single home → DISAMBIGUATE (never silently pick).
load helpers

# two registered gov homes (Svayamtech + aarambh) in a fresh sandbox
_two_orgs() {
  GA="$TEST_TMP/svm"; GB="$TEST_TMP/rng"; mkdir -p "$GA" "$GB"
  printf 'github_org: Svayamtech\n'        > "$GA/org-config.yaml"
  printf 'github_org: aarambhwillbeback\n' > "$GB/org-config.yaml"
  source "$REPO_SRC/scripts/gov-registry.sh"
  prj_reg_add Svayamtech "$GA"; prj_reg_add aarambhwillbeback "$GB"   # aarambh active (last)
}
setup() { sandbox_up; }
teardown() { sandbox_down; }

@test "prj org: lists registered orgs and marks the active one" {
  _two_orgs
  run bash "$BIN_PRJ" org
  assert_success
  assert_output --partial "Svayamtech"
  assert_output --partial "aarambhwillbeback"
  assert_output --partial "* "            # active marker present
}

@test "prj org use: switches the active org" {
  _two_orgs
  run bash "$BIN_PRJ" org use Svayamtech
  assert_success
  run cat "$XDG_CONFIG_HOME/prj/active-org"
  assert_output "Svayamtech"
}

@test "prj org use: rejects an unregistered org" {
  _two_orgs
  run bash "$BIN_PRJ" org use NotAnOrg
  assert_failure
  assert_output --partial "not a registered"
}

@test "multi-org: a home-requiring command DISAMBIGUATES (never silently picks) when none active" {
  _two_orgs
  rm -f "$XDG_CONFIG_HOME/prj/active-org"     # no active + 2 homes + neutral cwd
  cd /tmp
  run bash "$BIN_PRJ" status
  assert_failure
  assert_output --partial "multiple governance workspaces"
  assert_output --partial "prj org use"
}

@test "multi-org: active-org is the default from a neutral cwd" {
  _two_orgs
  prj_reg_set_active Svayamtech
  cd /tmp
  run resolved_workspace
  assert_output "$GA"
}

@test "multi-org: cwd-walk wins over the active org (you're inside an org's tree)" {
  _two_orgs
  prj_reg_set_active Svayamtech       # active = svm
  cd "$GB"                            # but standing in the aarambh tree
  run resolved_workspace
  assert_output "$GB"                 # cwd wins
}

@test "org/version/help are homeless-OK (work with no/ambiguous gov home)" {
  _two_orgs; rm -f "$XDG_CONFIG_HOME/prj/active-org"; cd /tmp
  run bash "$BIN_PRJ" org             # must NOT hard-fail on ambiguity — you fix it here
  assert_success
}
