#!/usr/bin/env bash
# setup.sh's ADF_WORKSPACE step (shared contract): if $ADF_WORKSPACE is already in the env,
# use it; otherwise ASK for the gov repo path and persist it to the login shell rc (a
# user-specific OS setting — never the repo). Idempotent; SETUP_SKIP_SHELL_RC=1 opts out;
# SETUP_FORCE_SHELL_RC=1 forces the (normally TTY-only) behaviour for this test.
TEST_NAME="setup_adf_workspace"
source "$(dirname "$0")/lib.sh"

SC=$(mktemp -d); trap "rm -rf '$SC'" EXIT
mkdir -p "$SC/home" "$SC/repo" "$SC/gov"
: > "$SC/gov/org-config.yaml"                  # a valid gov repo (signature = org-config.yaml)
cp "$REPO_ROOT/setup.sh" "$SC/repo/"
cat > "$SC/repo/org-config.yaml" <<'YAML'
org_name: "TestCorp"
org_short_name: "TC"
org_slug: "TST"
org_slug_lower: "tst"
org_repo_url: "git@github.com:test-org/gov.git"
github_org: "test-org"
workspace_repo: "gov"
default_branch: "main"
default_code_branch: "dev"
agent_work_root: "~/.tst/projects"
policy_owner_email: "o@test.com"
policy_owner_github: "@o"
legal_owner_github: ""
infra_owner_github: ""
system_arch_owner_github: ""
data_arch_owner_github: ""
policy_effective_date: "2026-01-01"
YAML
( cd "$SC/repo" && git init -q && git remote add origin git@github.com:test-org/gov.git )
RC="$SC/home/.zshrc"
base_env() { echo "HOME=$SC/home SHELL=/bin/zsh SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1"; }

# ── already set in the env → use it, do NOT prompt or rewrite the rc ──────────
rm -f "$RC"
out=$( HOME="$SC/home" SHELL=/bin/zsh ADF_WORKSPACE="$SC/gov" SETUP_FORCE_SHELL_RC=1 \
       SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 \
       bash "$SC/repo/setup.sh" --non-interactive 2>&1 ); ec=$?
assert_exit_code 0 "$ec" "setup.sh succeeds when ADF_WORKSPACE is already set"
assert_contains "already set" "$out" "uses the existing ADF_WORKSPACE (no prompt)"
[[ -f "$RC" ]] && grep -q ADF_WORKSPACE "$RC" \
  && t_fail "must not write the rc when ADF_WORKSPACE already set" \
  || t_pass "did not write the rc when ADF_WORKSPACE already set"

# ── not set → ASK for the path and persist it to the rc ───────────────────────
rm -f "$RC"
out=$( printf '%s\n' "$SC/gov" | HOME="$SC/home" SHELL=/bin/zsh SETUP_FORCE_SHELL_RC=1 \
       SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 \
       bash "$SC/repo/setup.sh" --non-interactive 2>&1 )
assert_contains "export ADF_WORKSPACE=$SC/gov" "$(cat "$RC" 2>/dev/null)" \
  "the answered gov path is persisted to the shell rc"
assert_contains "Activate now" "$out" "summary tells you to activate it"
# idempotent
printf '%s\n' "$SC/gov" | HOME="$SC/home" SHELL=/bin/zsh SETUP_FORCE_SHELL_RC=1 \
  SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 \
  bash "$SC/repo/setup.sh" --non-interactive >/dev/null 2>&1
assert_eq "1" "$(grep -c 'export ADF_WORKSPACE' "$RC")" "re-run keeps exactly one export"

# ── SETUP_SKIP_SHELL_RC=1 opts out (no prompt, no rc) ─────────────────────────
rm -f "$RC"
HOME="$SC/home" SHELL=/bin/zsh SETUP_SKIP_SHELL_RC=1 \
  SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 \
  bash "$SC/repo/setup.sh" --non-interactive </dev/null >/dev/null 2>&1
[[ -f "$RC" ]] && grep -q ADF_WORKSPACE "$RC" \
  && t_fail "SETUP_SKIP_SHELL_RC=1 must not touch the rc" \
  || t_pass "SETUP_SKIP_SHELL_RC=1 skips the rc write"
