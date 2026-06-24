#!/usr/bin/env bash
# Regression coverage for the unified workspace-context resolver (resolve_workspace) and the
# catalog/data verbs (PRJ-012). One resolver, two modes:
#   authoring (config, catalog build/check, deploy/data …local) — the project you're IN
#     (explicit $ADF_WORKSPACE or cwd-tree, incl. from a member repo); NEVER a remembered
#     default or picker (else you'd author against the wrong project).
#   read (catalog <env>, data …dev/uat/prod) — gov-global; falls back to the remembered
#     default so it works from anywhere ($HOME).
TEST_NAME="prj_data_catalog"
source "$(dirname "$0")/lib.sh"

PRJ="$REPO_ROOT/prj"

# ── Project tree: a gov workspace (svm-prj-work) + a sibling member repo, so we can test
#    resolution from inside a member repo (the real-world layout).
PROOT=$(mktemp -d)
trap "rm -rf '$PROOT'" EXIT
export XDG_CONFIG_HOME="$PROOT/.config"
unset ADF_WORKSPACE
WS="$PROOT/svm-prj-work"
MEMBER="$PROOT/911-SVC/packages/svm-ident"
mkdir -p "$WS/knowledge/deployment/catalog" "$MEMBER"
: > "$WS/org-config.yaml"

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
platform_services:
  SVC_DB: { scope: dedicated, owner: svm-ident }
applications:
  portal: { members: [svm-ident] }
hooks:
  iam-data: { repo: Org/911-SVC, cmd: "echo IAMHOOK" }
YAML
cat > "$WS/knowledge/deployment/catalog/pins.yaml" <<'YAML'
version: 1
pins: { dev: { svm-ident: "1.2.3" } }
YAML

run() { ( cd "$1" && shift && bash "$PRJ" "$@" 2>&1 ); }

# ── authoring resolves the project you're IN — even from a member repo (the bug) ──
out=$(run "$MEMBER" catalog build); ec=$?
assert_exit_code 0 "$ec" "catalog build (authoring) succeeds from inside a member repo"
assert_contains "graph.lock" "$out" "build wrote graph.lock for the correct project"
assert_eq "$WS" "$(cat "$XDG_CONFIG_HOME/prj/workspace" 2>/dev/null)" \
  "authoring resolved the SIBLING gov workspace (not a remembered/other project)"

out=$(run "$MEMBER" catalog check); ec=$?
assert_exit_code 0 "$ec" "catalog check (authoring) passes from inside a member repo"

# ── authoring NEVER falls back to the remembered default (no wrong-project authoring) ──
# A remembered default now exists (WS). From OUTSIDE any project tree, authoring must still
# error — not silently author against the remembered workspace.
out=$( cd / && XDG_CONFIG_HOME="$XDG_CONFIG_HOME" bash "$PRJ" catalog build 2>&1 ); ec=$?
assert_exit_code 1 "$ec" "authoring from outside any project errors (no remembered fallback)"
assert_not_contains "Select the project" "$out" "authoring never shows a picker"

# ── read DOES use the remembered default (works from anywhere) ─────────────────
out=$( cd / && XDG_CONFIG_HOME="$XDG_CONFIG_HOME" bash "$PRJ" catalog dev 2>&1 )
assert_contains "svm-ident" "$out" "read (catalog <env>) works from outside via remembered default"

# ── catalog <env>: env REQUIRED; lists units / pin / edge ─────────────────────
out=$(run "$WS" catalog); ec=$?
assert_exit_code 1 "$ec" "prj catalog with no env exits non-zero"
assert_contains "required" "$out" "prj catalog with no env says env is required"

out=$(run "$WS" catalog dev)
assert_contains "svm-ident"    "$out" "catalog dev lists the unit"
assert_contains "1.2.3"        "$out" "catalog dev shows the deployed (pinned) version"
assert_contains "security-dev" "$out" "catalog dev resolves the per-env edge host"
assert_contains "SVC_DB"       "$out" "catalog dev lists platform services"

out=$(run "$MEMBER" catalog dev)
assert_contains "svm-ident" "$out" "catalog <env> resolves from a member repo too"

# ── data --list: env REQUIRED; lists data-capable units ───────────────────────
out=$(run "$WS" data --list); ec=$?
assert_exit_code 1 "$ec" "prj data --list with no env exits non-zero"

out=$(run "$WS" data --list dev)
assert_contains "iam" "$out" "data --list dev shows the data-capable unit (iam-data hook)"

# ── bad catalog subcommand/env → clear error ──────────────────────────────────
out=$(run "$WS" catalog buildx); ec=$?
assert_exit_code 1 "$ec" "prj catalog with a bad subcommand/env errors"
