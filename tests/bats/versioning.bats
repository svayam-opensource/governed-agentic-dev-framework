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
  export LOCK="$FXG/knowledge/deployment/catalog/graph.lock"
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
  local L="$root/gov/knowledge/deployment/catalog/graph.lock"
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
