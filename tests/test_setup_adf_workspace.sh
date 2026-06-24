#!/usr/bin/env bash
# setup.sh must persist ADF_WORKSPACE (the gov repo = REPO_ROOT) to the login shell's rc,
# so dev/uat/prod commands (which REQUIRE it) always resolve the gov repo. Idempotent;
# SETUP_SKIP_SHELL_RC=1 opts out.
TEST_NAME="setup_adf_workspace"
source "$(dirname "$0")/lib.sh"

SC=$(mktemp -d); trap "rm -rf '$SC'" EXIT
mkdir -p "$SC/repo" "$SC/home"
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
do_setup() { HOME="$SC/home" SHELL=/bin/zsh SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 \
             bash "$SC/repo/setup.sh" --non-interactive 2>&1; }

# ── writes the export to the login-shell rc ───────────────────────────────────
out=$(do_setup); ec=$?
assert_exit_code 0 "$ec" "setup.sh succeeds"
assert_contains "export ADF_WORKSPACE=$SC/repo" "$(cat "$RC" 2>/dev/null)" \
  "rc exports ADF_WORKSPACE = the gov repo (REPO_ROOT)"
assert_contains "Activate now" "$out" "summary tells you to activate it"

# ── idempotent: re-running leaves exactly one export ──────────────────────────
do_setup >/dev/null 2>&1
assert_eq "1" "$(grep -c 'export ADF_WORKSPACE' "$RC")" "re-run keeps exactly one export (managed block)"

# ── SETUP_SKIP_SHELL_RC=1 opts out ────────────────────────────────────────────
rm -f "$RC"
HOME="$SC/home" SHELL=/bin/zsh SETUP_SKIP_GITHUB_VERIFY=1 SETUP_SKIP_REMOTE_CONFIG=1 \
  SETUP_SKIP_SHELL_RC=1 bash "$SC/repo/setup.sh" --non-interactive >/dev/null 2>&1
[[ -f "$RC" ]] && grep -q ADF_WORKSPACE "$RC" \
  && t_fail "SETUP_SKIP_SHELL_RC=1 must not touch the rc" \
  || t_pass "SETUP_SKIP_SHELL_RC=1 skips the rc write"
