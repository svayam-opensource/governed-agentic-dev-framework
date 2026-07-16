#!/usr/bin/env bash
# Regression coverage for the env-keyed workspace resolver (resolve_workspace) and the
# catalog/data verbs (PRJ-012). The model:
#   GOV repo ($ADF_WORKSPACE, always on main) is the SoT for dev|uat|prod — REQUIRED, no
#     cwd-walk, no picker; errors if unset.
#   PROJECT repo (a per-project clone on a branch) is the SoT for `local` and authoring
#     (config, catalog build/check) — resolved from cwd (incl. a member repo), else picked.
#     Authoring uses the project you're IN even if $ADF_WORKSPACE points at gov.
TEST_NAME="prj_data_catalog"
source "$(dirname "$0")/lib.sh"

PRJ="$REPO_ROOT/prj"
export PRJ_NO_PULL=1   # don't git-pull the gov fixture during tests

mkcat() {  # mkcat <dir> [pin]  — make a gov-repo-shaped clone: org-config.yaml + deploy catalog
  mkdir -p "$1/knowledge/deployment/catalog"
  : > "$1/org-config.yaml"   # the gov-repo signature ensure_adf_workspace checks
  cat > "$1/knowledge/deployment/catalog/services.yaml" <<'YAML'
version: 2
config_service_map: {}
services:
  svm-ident: { repo: Org/911-SVC, paths: ["api/iam/**"], kind: api,
               artifact: docker.x/svm-ident, requires: [SVC_DB],
               hosts: { dev: chinhut }, edge: security-<env>.example.com }
platform_services: { SVC_DB: { scope: dedicated, owner: svm-ident } }
applications: { portal: { members: [svm-ident] } }
hooks: { iam-data: { repo: Org/911-SVC, cmd: "echo IAMHOOK" } }
YAML
  [[ -n "${2:-}" ]] && printf 'version: 1\npins: { dev: { svm-ident: "%s" } }\n' "$2" \
      > "$1/knowledge/deployment/catalog/pins.yaml"
}

# ── Layout: a GOV clone (outside the project tree) + a project tree (project clone + member)
ROOT=$(mktemp -d); trap "rm -rf '$ROOT'" EXIT
GOV="$ROOT/gov/svm-prj-work"
export AGENT_WORK_ROOT="$ROOT/work"
PROJ="$AGENT_WORK_ROOT/PRJ-99-demo/svm-prj-work"
MEMBER="$AGENT_WORK_ROOT/PRJ-99-demo/911-SVC/packages/svm-ident"
mkcat "$GOV" "9.9.9"          # gov: "deployed" catalog (dev pin 9.9.9)
# A gov repo on main carries a COMMITTED graph.lock — derive it once for the fixture.
ADF_WORKSPACE="$GOV" python3 "$REPO_ROOT/scripts/deploy/catalog.py" build >/dev/null 2>&1
mkcat "$PROJ"                 # project: WIP services.yaml (no lock yet → build makes it)
mkdir -p "$MEMBER"

run() { ( cd "$1"; shift; "$@" ); }   # run <cwd> <cmd...>

# ── REMOTE (dev/uat/prod) = gov repo; $ADF_WORKSPACE REQUIRED ──────────────────
out=$( unset ADF_WORKSPACE; cd /; bash "$PRJ" catalog dev 2>&1 ); ec=$?
assert_exit_code 1 "$ec" "catalog dev without ADF_WORKSPACE errors"
assert_contains "ADF_WORKSPACE" "$out" "the error tells you to set ADF_WORKSPACE"

out=$( ADF_WORKSPACE="$GOV" cd / 2>/dev/null; ADF_WORKSPACE="$GOV" bash "$PRJ" catalog dev 2>&1 )
assert_contains "svm-ident" "$out" "catalog dev reads the GOV repo when ADF_WORKSPACE is set"
assert_contains "9.9.9"     "$out" "catalog dev shows the gov-committed deployed pin"

# ── LOCAL / authoring = the PROJECT you're in (from a member repo); never gov ──
gov_lock="$GOV/knowledge/deployment/catalog/graph.lock"; gov_before="$(cat "$gov_lock" 2>/dev/null)"
out=$( unset ADF_WORKSPACE; cd "$MEMBER"; bash "$PRJ" catalog build 2>&1 ); ec=$?
assert_exit_code 0 "$ec" "catalog build (authoring) from a member repo succeeds"
[[ -f "$PROJ/knowledge/deployment/catalog/graph.lock" ]] && t_pass "build wrote the PROJECT's graph.lock" || t_fail "build wrote the PROJECT's graph.lock"
assert_eq "$gov_before" "$(cat "$gov_lock" 2>/dev/null)" "authoring build did NOT touch the gov repo"

out=$( unset ADF_WORKSPACE; cd "$MEMBER"; bash "$PRJ" catalog check 2>&1 ); ec=$?
assert_exit_code 0 "$ec" "catalog check (authoring) from a member repo passes"

# authoring uses the project you're IN even if $ADF_WORKSPACE points at the gov repo
out=$( ADF_WORKSPACE="$GOV"; export ADF_WORKSPACE; cd "$MEMBER"; bash "$PRJ" catalog check 2>&1 ); ec=$?
assert_exit_code 0 "$ec" "authoring ignores a gov ADF_WORKSPACE and uses the cwd project"

# ── catalog local = the project (cwd), not gov ────────────────────────────────
out=$( unset ADF_WORKSPACE; cd "$MEMBER"; bash "$PRJ" catalog local 2>&1 )
assert_contains "svm-ident" "$out" "catalog local lists the project's units"
assert_not_contains "9.9.9" "$out" "catalog local shows the PROJECT (no gov dev pin)"

# ── env required; bad subcommand errors ───────────────────────────────────────
out=$( ADF_WORKSPACE="$GOV" bash "$PRJ" catalog 2>&1 ); ec=$?
assert_exit_code 1 "$ec" "prj catalog with no env errors"
out=$( ADF_WORKSPACE="$GOV" bash "$PRJ" catalog buildx 2>&1 ); ec=$?
assert_exit_code 1 "$ec" "prj catalog with a bad subcommand/env errors"

# ── data --list: env-keyed (dev → gov; local → project) ───────────────────────
out=$( ADF_WORKSPACE="$GOV" bash "$PRJ" data --list dev 2>&1 )
assert_contains "iam" "$out" "data --list dev lists data-capable units from gov"
out=$( unset ADF_WORKSPACE; cd "$MEMBER"; bash "$PRJ" data --list local 2>&1 )
assert_contains "iam" "$out" "data --list local lists data-capable units from the project"
out=$( unset ADF_WORKSPACE; cd /; bash "$PRJ" data --list dev 2>&1 ); ec=$?
assert_exit_code 1 "$ec" "data --list dev without ADF_WORKSPACE errors (gov required)"
