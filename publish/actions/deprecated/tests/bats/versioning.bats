#!/usr/bin/env bats
# #108 items 1+2 — artifact version (<semver>+<content-sha>) + build-graph closure.
#
# build derives semver (per artifact type) and a content-sha over the transitive
# build closure, stores them + build_closure in graph.lock, the DAG renders
# build-inputs -> artifact@version, and the sha has TEETH (source/dep changes move
# it). Member repos are git-initialised so the tree-sha mechanic is exercised for
# real. Hermetic, no network.
load helpers

CATPY="$REPO_SRC/scripts/deploy/catalog.py"
FIXTURE_SRC="$REPO_SRC/tests/fixtures/app-stack"

setup() {
  sandbox_up
  cp -R "$FIXTURE_SRC" "$TEST_TMP/stack"
  export FXG="$TEST_TMP/stack/gov"
  export LOCK="$(pp "$FXG/knowledge/deployment/catalog/graph.lock")"   # pp: Windows-Python-openable form
  # git-init each member repo so content-sha tree-shas are real (not '').
  for r in api-repo spa-repo; do
    git init -q "$TEST_TMP/stack/$r"
    git -C "$TEST_TMP/stack/$r" add -A
    git -C "$TEST_TMP/stack/$r" commit -qm init
  done
}
teardown() { sandbox_down; }

catpy() { ADF_WORKSPACE="$FXG" python3 "$CATPY" "$@"; }
_sha() { python3 -c "import json;print((json.load(open('$LOCK'))['units']['$1'].get('content_sha') or '')[:12])"; }

@test "versioning: build records semver + content_sha + build_closure per unit" {
  catpy build
  run python3 -c "
import json; u=json.load(open('$LOCK'))['units']['api']
assert u['semver']=='0.0.1', u['semver']
assert u['content_sha'] and len(u['content_sha'])==64, u['content_sha']
bc=u['build_closure']; assert 'base_image' in bc and bc['anchor']=='packages/api', bc
print('ok')
"
  assert_success
  assert_output "ok"
}

@test "versioning (P1.1): build records code_sha (integrity anchor), distinct from content_sha, with teeth" {
  catpy build
  run python3 -c "
import json; u=json.load(open('$LOCK'))['units']['api']
cs=u.get('code_sha'); ct=u.get('content_sha')
assert cs and len(cs)==64, ('code_sha bad', cs)
assert ct and len(ct)==64, ('content_sha bad', ct)
assert cs != ct, 'code_sha must differ from content_sha (content folds in semver+base)'
print('ok')
"
  assert_success
  assert_output "ok"
  local before; before="$(python3 -c "import json;print(json.load(open('$LOCK'))['units']['api']['code_sha'][:12])")"
  echo "console.log('x')" > "$TEST_TMP/stack/api-repo/packages/api/handler.js"
  git -C "$TEST_TMP/stack/api-repo" add -A; git -C "$TEST_TMP/stack/api-repo" commit -qm edit
  catpy build
  local after; after="$(python3 -c "import json;print(json.load(open('$LOCK'))['units']['api']['code_sha'][:12])")"
  [ "$before" != "$after" ]
}

@test "versioning: version subcommand prints <semver>+<sha7>" {
  catpy build
  run catpy version spa
  assert_success
  assert_output --regexp '^0\.0\.1\+[0-9a-f]{7}$'
}

@test "versioning: version of an unknown unit fails cleanly" {
  catpy build
  run catpy version nope
  assert_failure
  assert_output --partial "no such unit"
}

@test "versioning: editing a unit's source moves its content_sha (teeth)" {
  catpy build
  local before; before="$(_sha api)"
  echo "console.log('x')" > "$TEST_TMP/stack/api-repo/packages/api/handler.js"
  git -C "$TEST_TMP/stack/api-repo" add -A
  git -C "$TEST_TMP/stack/api-repo" commit -qm edit
  catpy build
  local after; after="$(_sha api)"
  [ "$before" != "$after" ]
}

@test "versioning: a stale lock (un-rebuilt source change) fails check" {
  catpy build
  echo "console.log('y')" > "$TEST_TMP/stack/api-repo/packages/api/handler.js"
  git -C "$TEST_TMP/stack/api-repo" add -A
  git -C "$TEST_TMP/stack/api-repo" commit -qm edit
  run catpy check
  assert_failure
  assert_output --partial "lock-stale"
}

@test "versioning: dag renders build-inputs -> artifact@version" {
  catpy build
  run catpy dag api
  assert_success
  assert_output --partial "build inputs"
  assert_output --partial "fixture/api@0.0.1+"
  assert_output --partial "version"
}

@test "local-port (#108.3): declared serve/healthcheck port becomes the local edge" {
  catpy build
  # fixture api declares serve.port 8080 → local_port 8080, edge localhost:8080
  run python3 -c "import json;print(json.load(open('$LOCK'))['units']['api']['local_port'])"
  assert_output "8080"
  run catpy dag api --env local
  assert_success
  assert_output --partial "edge=localhost:8080"
  refute_output --partial ".svayamtech.com"   # local is never a public domain
}

@test "local-port (#108.3): a SERVED unit without a declared port gets a stable derived port; a lib gets none" {
  local root="$TEST_TMP/lp"; mkdir -p "$root/gov/knowledge/deployment/catalog"
  cat > "$root/gov/knowledge/deployment/catalog/services.yaml" <<'YAML'
version: 2
services:
  svc:
    repo: acme/svc-repo
    anchor: packages/svc
  mylib:
    repo: acme/lib-repo
    anchor: packages/mylib
YAML
  # svc has a Dockerfile -> kind=api (served, no declared port) -> derived port.
  mkdir -p "$root/svc-repo/packages/svc"
  echo '{"name":"@svayam/svc","version":"1.0.0"}' > "$root/svc-repo/packages/svc/package.json"
  printf 'FROM node:20-alpine\n' > "$root/svc-repo/packages/svc/Dockerfile"
  git init -q "$root/svc-repo"; git -C "$root/svc-repo" add -A; git -C "$root/svc-repo" commit -qm init
  # mylib is a plain package -> kind=lib (NOT served) -> no local port/edge.
  mkdir -p "$root/lib-repo/packages/mylib"
  echo '{"name":"@svayam/mylib","version":"1.0.0"}' > "$root/lib-repo/packages/mylib/package.json"
  git init -q "$root/lib-repo"; git -C "$root/lib-repo" add -A; git -C "$root/lib-repo" commit -qm init
  local L="$(pp "$root/gov/knowledge/deployment/catalog/graph.lock")"   # pp: Windows-Python-openable form
  ADF_WORKSPACE="$root/gov" python3 "$CATPY" build
  # served unit: derived port in range
  local p1; p1="$(python3 -c "import json;print(json.load(open('$L'))['units']['svc']['local_port'])")"
  [ "$p1" -ge 39000 ] && [ "$p1" -le 39999 ]
  # lib: no local port (null)
  run python3 -c "import json;print(json.load(open('$L'))['units']['mylib']['local_port'])"
  assert_output "None"
  # lib renders no local edge in the dag
  run env ADF_WORKSPACE="$root/gov" python3 "$CATPY" dag mylib --env local
  assert_success
  refute_output --partial "localhost"
  # deterministic — a rebuild yields the same served port
  ADF_WORKSPACE="$root/gov" python3 "$CATPY" build
  local p2; p2="$(python3 -c "import json;print(json.load(open('$L'))['units']['svc']['local_port'])")"
  assert_equal "$p1" "$p2"
}

@test "versioning: a build-dep change rolls up into the dependent's content_sha" {
  # Synthetic @svayam lib <- app catalog so the cross-repo build edge is derived
  # (_svayam_deps tracks @svayam/*). lib + app are sibling repos of a gov ws.
  local root="$TEST_TMP/roll"; mkdir -p "$root/gov/knowledge/deployment/catalog"
  cat > "$root/gov/knowledge/deployment/catalog/services.yaml" <<'YAML'
version: 2
services:
  lib:
    repo: acme/lib-repo
    anchor: packages/lib
  app:
    repo: acme/app-repo
    anchor: packages/app
YAML
  mkdir -p "$root/lib-repo/packages/lib" "$root/app-repo/packages/app"
  echo '{"name":"@svayam/lib","version":"1.0.0"}' > "$root/lib-repo/packages/lib/package.json"
  echo 'export const v=1' > "$root/lib-repo/packages/lib/index.js"
  printf '{"name":"@svayam/app","version":"2.0.0","dependencies":{"@svayam/lib":"^1.0.0"}}\n' \
    > "$root/app-repo/packages/app/package.json"
  for r in lib-repo app-repo; do
    git init -q "$root/$r"; git -C "$root/$r" add -A; git -C "$root/$r" commit -qm init
  done
  local L="$(pp "$root/gov/knowledge/deployment/catalog/graph.lock")"   # pp: Windows-Python-openable form
  ADF_WORKSPACE="$root/gov" python3 "$CATPY" build
  # app's build closure includes the cross-repo build-dep unit 'lib'
  run python3 -c "import json;print(json.load(open('$L'))['units']['app']['build_closure']['build_dep_units'])"
  assert_output --partial "lib"
  local app_before; app_before="$(python3 -c "import json;print(json.load(open('$L'))['units']['app']['content_sha'])")"
  # change the LIB's source, rebuild → app's sha must move (rollup)
  echo 'export const v=2' > "$root/lib-repo/packages/lib/index.js"
  git -C "$root/lib-repo" add -A; git -C "$root/lib-repo" commit -qm bump
  ADF_WORKSPACE="$root/gov" python3 "$CATPY" build
  local app_after; app_after="$(python3 -c "import json;print(json.load(open('$L'))['units']['app']['content_sha'])")"
  [ "$app_before" != "$app_after" ]
}
