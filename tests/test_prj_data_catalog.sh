#!/usr/bin/env bash
# Regression coverage for the deploy-catalog verbs and workspace resolution (PRJ-012).
# Pins behaviour converged on across 0.6.7–0.6.11:
#   - `prj catalog build` derives graph.lock from services.yaml; `prj catalog check` gates it.
#   - `prj catalog <env>` REQUIRES an env and lists units (host/deployed-pin/edge), NO picker.
#   - `prj data --list <env>` REQUIRES an env and lists data-capable units.
#   - resolution finds the workspace from a subdir; remembered default works from outside.
TEST_NAME="prj_data_catalog"
source "$(dirname "$0")/lib.sh"

PRJ="$REPO_ROOT/prj"

# ── Minimal project workspace: org-config.yaml (so resolve_local_workspace finds it) +
#    a declared-only services.yaml (no anchor → no repo derivation) + per-env pins.
WS=$(mktemp -d)
trap "rm -rf '$WS'" EXIT
export XDG_CONFIG_HOME="$WS/.config"
unset ADF_WORKSPACE
mkdir -p "$WS/knowledge/deployment/catalog" "$WS/sub/deep"
: > "$WS/org-config.yaml"   # presence is what resolve_local_workspace walks up for

cat > "$WS/knowledge/deployment/catalog/services.yaml" <<'YAML'
version: 2
config_service_map: {}
services:
  svm-ident:
    repo: Org/911-SVC
    paths: ["api/iam/**"]
    kind: api
    artifact: docker.x/svm-ident
    requires: [SVC_DB]
    hosts: { dev: chinhut }
    edge: security-<env>.example.com
  portal-spa:
    repo: Org/912-UI
    paths: ["apps/portal/**"]
    kind: spa
    artifact: docker.x/portal-spa
    requires: [svm-ident]
    hosts: { dev: chinhut }
    edge: portal-<env>.example.com
platform_services:
  SVC_DB: { scope: dedicated, owner: svm-ident }
applications:
  portal: { members: [svm-ident, portal-spa] }
hooks:
  iam-data: { repo: Org/911-SVC, cmd: "echo IAMHOOK" }
YAML
cat > "$WS/knowledge/deployment/catalog/pins.yaml" <<'YAML'
version: 1
pins:
  dev:
    svm-ident: "1.2.3"
YAML

run() { ( cd "$1" && shift && bash "$PRJ" "$@" 2>&1 ); }

# ── prj catalog build / check (config-as-build, via catalog.py) ───────────────
out=$(run "$WS" catalog build); ec=$?
assert_exit_code 0 "$ec" "prj catalog build succeeds"
assert_contains "graph.lock" "$out" "build writes graph.lock"
[[ -f "$WS/knowledge/deployment/catalog/graph.lock" ]] && t_pass "graph.lock created" || t_fail "graph.lock created"

out=$(run "$WS" catalog check); ec=$?
assert_exit_code 0 "$ec" "prj catalog check passes on a freshly-built lock"

out=$(run "$WS" catalog buildx); ec=$?    # typo must NOT silently run build/check
assert_exit_code 1 "$ec" "prj catalog with a bad subcommand/env errors"
assert_contains "build" "$out" "the error names the build/check subcommands"

# ── prj catalog <env>: env REQUIRED; lists units, pin, edge — NO picker ───────
out=$(run "$WS" catalog); ec=$?
assert_exit_code 1 "$ec" "prj catalog with no env exits non-zero"
assert_contains "required" "$out" "prj catalog with no env says env is required"

out=$(run "$WS" catalog dev)
assert_contains "svm-ident"          "$out" "catalog dev lists the unit"
assert_contains "portal"             "$out" "catalog dev lists the application"
assert_contains "1.2.3"              "$out" "catalog dev shows the deployed (pinned) version"
assert_contains "security-dev"       "$out" "catalog dev resolves the per-env edge host"
assert_contains "SVC_DB"             "$out" "catalog dev lists platform services"
assert_not_contains "Select the project" "$out" "catalog does NOT prompt a project picker"

# ── resolution from a SUBDIR of the workspace (tree-walk) ─────────────────────
out=$(run "$WS/sub/deep" catalog dev)
assert_contains "svm-ident" "$out" "catalog resolves the workspace from a subdir"

# ── prj data --list: env REQUIRED; lists data-capable units (the *-data hooks) ─
out=$(run "$WS" data --list); ec=$?
assert_exit_code 1 "$ec" "prj data --list with no env exits non-zero"

out=$(run "$WS" data --list dev)
assert_contains "iam" "$out" "data --list dev shows the data-capable unit (iam-data hook)"

# ── remembered default: after one resolve, catalog works from OUTSIDE the tree ─
run "$WS" catalog dev >/dev/null 2>&1                 # seeds the remembered default
assert_contains "$WS" "$(cat "$XDG_CONFIG_HOME/prj/workspace" 2>/dev/null)" \
  "resolving a workspace remembers it as the default"
out=$( cd / && XDG_CONFIG_HOME="$XDG_CONFIG_HOME" bash "$PRJ" catalog dev 2>&1 )
assert_contains "svm-ident" "$out" "catalog works from outside the tree via the remembered default"
