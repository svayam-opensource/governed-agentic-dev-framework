#!/usr/bin/env bash
# Regression coverage for the deploy-catalog discovery verbs and workspace resolution
# (PRJ-012). Pins the behaviour we converged on across 0.6.7–0.6.10:
#   - `prj catalog <env>` REQUIRES an env (catalog view is per-env) and reads the
#     gov-global catalog resolved by walking up from cwd (NO project picker).
#   - `prj data --list <env>` REQUIRES an env and lists data-capable units.
#   - resolution finds the workspace from a subdir of the project tree.
TEST_NAME="prj_data_catalog"
source "$(dirname "$0")/lib.sh"

PRJ="$REPO_ROOT/prj"

# ── Minimal workspace fixture: a deploy catalog with one app, units, a data hook,
#    and a per-env pin. prj resolves it by walking up from cwd; isolate the
#    remembered-default file under the scratch XDG dir so the real one is untouched.
WS=$(mktemp -d)
trap "rm -rf '$WS'" EXIT
export XDG_CONFIG_HOME="$WS/.config"
unset ADF_WORKSPACE
mkdir -p "$WS/knowledge/deployment/catalog" "$WS/sub/deep"

cat > "$WS/knowledge/deployment/catalog/graph.lock" <<'JSON'
{
  "units": {
    "svm-ident": {"kind":"api","artifact":"docker.x/svm-ident","hosts":{"dev":"chinhut"},
                  "edge":"security-<env>.example.com","requires":["SVC_DB"]},
    "portal-spa": {"kind":"spa","artifact":"docker.x/portal-spa","hosts":{"dev":"chinhut"},
                   "edge":"portal-<env>.example.com","requires":["svm-ident"]}
  },
  "applications": {"portal": {"members":["svm-ident","portal-spa"]}},
  "platform_services": {"SVC_DB": {}},
  "hooks": {"iam-data": {"repo":"Org/911-SVC","cmd":"echo IAMHOOK"}}
}
JSON
cat > "$WS/knowledge/deployment/catalog/pins.yaml" <<'YAML'
version: 1
pins:
  dev:
    svm-ident: "1.2.3"
YAML

run() { ( cd "$1" && shift && bash "$PRJ" "$@" 2>&1 ); }

# ── prj catalog: env is REQUIRED ──────────────────────────────────────────────
out=$(run "$WS" catalog); ec=$?
assert_exit_code 1 "$ec" "prj catalog with no env exits non-zero"
assert_contains "required" "$out" "prj catalog with no env says env is required"

out=$(run "$WS" catalog nope); ec=$?
assert_exit_code 1 "$ec" "prj catalog with a bad env exits non-zero"

# ── prj catalog <env>: lists units, deployed pin, resolved edge — NO picker ────
out=$(run "$WS" catalog dev)
assert_contains "svm-ident"          "$out" "catalog dev lists the unit"
assert_contains "portal"             "$out" "catalog dev lists the application"
assert_contains "1.2.3"              "$out" "catalog dev shows the deployed (pinned) version"
assert_contains "security-dev"       "$out" "catalog dev resolves the per-env edge host"
assert_contains "SVC_DB"             "$out" "catalog dev lists platform services"
assert_not_contains "Select the project" "$out" "catalog does NOT prompt a project picker"

# ── resolution from a SUBDIR of the workspace (tree-walk) ──────────────────────
out=$(run "$WS/sub/deep" catalog dev)
assert_contains "svm-ident" "$out" "catalog resolves the workspace from a subdir"

# ── prj data --list: env REQUIRED; lists data-capable units (the *-data hooks) ─
out=$(run "$WS" data --list); ec=$?
assert_exit_code 1 "$ec" "prj data --list with no env exits non-zero"

out=$(run "$WS" data --list dev)
assert_contains "iam" "$out" "data --list dev shows the data-capable unit (iam-data hook)"

# ── remembered default: after one resolve, it works from OUTSIDE the tree ──────
out=$(run "$WS" catalog dev)                       # seeds the remembered default
assert_contains "$WS" "$(cat "$XDG_CONFIG_HOME/prj/workspace" 2>/dev/null)" \
  "resolving a workspace remembers it as the default"
out=$( cd / && XDG_CONFIG_HOME="$XDG_CONFIG_HOME" bash "$PRJ" catalog dev 2>&1 )
assert_contains "svm-ident" "$out" "catalog works from outside the tree via the remembered default"
