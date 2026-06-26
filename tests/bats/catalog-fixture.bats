#!/usr/bin/env bats
# Catalog engine against a REAL (but hermetic) app stack — P4 fixture.
#
# tests/fixtures/app-stack/ is a self-contained SPA -> API -> DB catalog: the
# member repos are sibling dirs of the gov workspace (the layout catalog.py
# expects: $WORKSPACE_ROOT/../<reponame>), so `catalog build/check/dag` exercise
# the derivation engine end-to-end with no network. The earlier catalog.bats
# only proves the command dispatches; this proves it actually derives units from
# package.json closures and that the drift gate (`check`) has teeth.
load helpers

CATPY="$REPO_SRC/scripts/deploy/catalog.py"
FIXTURE_SRC="$REPO_SRC/tests/fixtures/app-stack"

setup() {
  sandbox_up
  # Copy the stack into the sandbox so `build` writes graph.lock there, never
  # into the committed tree.
  cp -R "$FIXTURE_SRC" "$TEST_TMP/stack"
  export FXG="$TEST_TMP/stack/gov"
  export LOCK="$FXG/knowledge/deployment/catalog/graph.lock"
}
teardown() { sandbox_down; }

catpy() { ADF_WORKSPACE="$FXG" python3 "$CATPY" "$@"; }

@test "catalog fixture: build derives both units + the platform service" {
  run catpy build
  assert_success
  assert_output --partial "2 units"
  assert_output --partial "1 platform service"
  [ -f "$LOCK" ]
}

@test "catalog fixture: build reads each anchor package.json (npm_name not null)" {
  catpy build
  run python3 -c "import json,sys; d=json.load(open('$LOCK')); u=d['units']; sys.exit(0 if u['api']['npm_name']=='@fixture/api' and u['spa']['npm_name']=='@fixture/spa' else 1)"
  assert_success
}

@test "catalog fixture: check is clean once built (lock fresh, no drift)" {
  catpy build
  run catpy check
  assert_success
  assert_output --partial "OK"
}

@test "catalog fixture: check flags a stale lock when a member package.json changes" {
  catpy build
  printf '{\n  "name": "@fixture/spa-renamed",\n  "version": "0.0.1",\n  "private": true\n}\n' \
    > "$TEST_TMP/stack/spa-repo/apps/spa/package.json"
  run catpy check
  assert_failure
  assert_output --partial "lock-stale"
}

@test "catalog fixture: check flags requires that point at an unknown service" {
  # spa now requires GHOST, which is neither a unit nor a platform service.
  sed -i.bak 's/requires: \[api\]/requires: [api, GHOST]/' \
    "$FXG/knowledge/deployment/catalog/services.yaml"
  run catpy check
  assert_failure
  assert_output --partial "requires-unknown"
}

@test "catalog fixture: build works without PyYAML, via the yq shim" {
  # The catalog tool must run on pyyaml-less environments (e.g. minimal
  # Slackware) where `prj deps` installs the static yq binary instead. `-S`
  # drops site-packages so `import yaml` fails, forcing catalog.py's yq-backed
  # shim. (On the hosted ubuntu/slackware runners pyyaml is absent anyway, so
  # the other tests already take this path; this pins it on every OS.)
  command -v yq >/dev/null || skip "yq not installed — run 'prj deps' first"
  run env ADF_WORKSPACE="$FXG" python3 -S "$CATPY" build
  assert_success
  assert_output --partial "2 units"
}

@test "catalog fixture: dag spa shows its runtime requires edge to api" {
  catpy build
  run catpy dag spa --env local
  assert_success
  assert_output --partial "requires"
  assert_output --partial "api"
}
