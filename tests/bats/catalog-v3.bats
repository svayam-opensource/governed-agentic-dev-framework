#!/usr/bin/env bats
# P1.2 — v3 unit model. catalog.py reads a native `units:` catalog: declared
# type/sub_type/id flow into graph.lock, a BUILDABLE unit (has repo) is derived +
# fingerprinted, and an `external` unit (no repo) is declared-only (identity +
# endpoints/secret_ref, no content_sha/build closure). Hermetic, no network.
load helpers

CATPY="$REPO_SRC/scripts/deploy/catalog.py"

setup() {
  sandbox_up
  ROOT="$TEST_TMP/v3"
  mkdir -p "$ROOT/gov/knowledge/deployment/catalog"
  export LOCK="$(pp "$ROOT/gov/knowledge/deployment/catalog/graph.lock")"   # pp: Windows-Python-openable form
  cat > "$ROOT/gov/knowledge/deployment/catalog/services.yaml" <<'YAML'
version: 3
units:
  iam-svc:
    id: u-3f9a2c14
    type: svc
    sub_type: api
    repo: acme/iam-repo
    anchor: packages/api/iam
    deploy_deps: [iam-data, twofactor-sms]
  iam-data:
    id: u-11112222
    type: svc
    sub_type: data
    engine: mariadb@11.8
    repo: acme/iam-repo
    anchor: packages/data/iam
  twofactor-sms:
    id: u-99998888
    type: external
    sub_type: sms
    endpoints: { dev: "https://sms.dev", prod: "https://sms.prod" }
    secret_ref: "ci:sms-api-key"
YAML
  mkdir -p "$ROOT/iam-repo/packages/api/iam" "$ROOT/iam-repo/packages/data/iam"
  echo '{"name":"@acme/iam","version":"1.2.0"}' > "$ROOT/iam-repo/packages/api/iam/package.json"
  printf 'FROM node:20-alpine\n' > "$ROOT/iam-repo/packages/api/iam/Dockerfile"
  echo '{"name":"@acme/iam-data","version":"1.0.0"}' > "$ROOT/iam-repo/packages/data/iam/package.json"
  git init -q "$ROOT/iam-repo"; git -C "$ROOT/iam-repo" add -A; git -C "$ROOT/iam-repo" commit -qm init
}
teardown() { sandbox_down; }

catpy() { ADF_WORKSPACE="$ROOT/gov" python3 "$CATPY" "$@"; }

@test "v3: native units: catalog builds; declared type/sub_type/id reach the lock" {
  catpy build
  run python3 -c "
import json; u=json.load(open('$LOCK'))['units']['iam-svc']
assert u['type']=='svc', u['type']
assert u['sub_type']=='api', u['sub_type']
assert u['id']=='u-3f9a2c14', u['id']            # DECLARED id preserved (not re-derived)
assert u['deploy_deps']==['iam-data','twofactor-sms'], u['deploy_deps']
assert u.get('content_sha') and len(u['content_sha'])==64, 'buildable -> fingerprinted'
print('ok')
"
  assert_success
  assert_output "ok"
}

@test "v3: a data unit carries its engine through to the lock" {
  catpy build
  run python3 -c "import json;print(json.load(open('$LOCK'))['units']['iam-data']['engine'])"
  assert_output "mariadb@11.8"
}

@test "v3: deploy preflight resolves deps via the bridge - Tier-1 unit vs Tier-2 infra" {
  # iam-svc deploy_deps = [iam-data (buildable -> Tier-1), twofactor-sms (external -> Tier-2)].
  # requirements() reads deploy_deps via back-filled `requires`; classifies each by tier.
  # Call the function directly (the `preflight` CLI reads the committed catalog from a
  # git ref; the function operates on the raw catalog, exercising the same bridge logic).
  run python3 -c "
import importlib.util, os
os.environ['ADF_WORKSPACE']='$ROOT/gov'
s=importlib.util.spec_from_file_location('cat','$CATPY'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
cat=m.load(m.DEFAULT_CATALOG)
rows={r['name']:r for r in m.requirements(cat,'iam-svc','dev')}
assert rows['iam-data']['tier']==1, rows['iam-data']            # buildable data unit -> Tier-1
sms=rows['twofactor-sms']
assert sms['tier']==2, sms                                       # external -> Tier-2 standing infra
assert sms['provisioning']=='saas', sms                          # back-filled from type=external
assert sms['endpoint']=='https://sms.dev', sms                   # per-env endpoint resolved
print('ok')
"
  assert_success
  assert_output "ok"
}

_write_taxonomy() {
  mkdir -p "$ROOT/gov/knowledge/deployment/taxonomy"
  cat > "$ROOT/gov/knowledge/deployment/taxonomy/types.yaml" <<'YAML'
version: 1
types:
  svc:      { sub_types: [api, spa, web, data, worker] }
  external: { sub_types: [sms, email, oidc, payment] }
YAML
}

@test "v3 (taxonomy): a valid catalog passes type/sub_type validation" {
  _write_taxonomy
  run catpy build
  assert_success
  refute_output --partial "taxonomy"
}

@test "v3 (taxonomy): an unknown sub_type is rejected at build (T1)" {
  _write_taxonomy
  # corrupt iam-svc's sub_type to a value not in the taxonomy
  python3 - "$ROOT/gov/knowledge/deployment/catalog/services.yaml" <<'PY'
import sys, re
p = sys.argv[1]; t = open(p).read()
open(p, "w").write(t.replace("sub_type: api", "sub_type: boguskind", 1))
PY
  run catpy build
  assert_failure
  assert_output --partial "unknown sub_type 'boguskind'"
  assert_output --partial "taxonomy"
}

@test "v3 (no taxonomy): validation is skipped gracefully, build still succeeds" {
  # setup() wrote NO taxonomy dir -> _validate_units returns [] -> build proceeds
  run catpy build
  assert_success
}

@test "v3: a repo-less external unit lands in Tier-2 platform_services (not units), identity + refs only" {
  catpy build
  run python3 -c "
import json; L=json.load(open('$LOCK'))
assert 'twofactor-sms' not in L['units'], 'external (no repo) must NOT be a Tier-1 unit'
u=L['platform_services']['twofactor-sms']
assert u['type']=='external' and u['sub_type']=='sms', (u['type'], u['sub_type'])
assert u.get('content_sha') is None, 'external is not built -> no content_sha'
assert u.get('provisioning')=='saas', 'external back-fills provisioning=saas for legacy readers'
assert u.get('secret_ref')=='ci:sms-api-key', u.get('secret_ref')   # ref only (C01)
assert u.get('endpoints',{}).get('prod')=='https://sms.prod', u.get('endpoints')
print('ok')
"
  assert_success
  assert_output "ok"
}
