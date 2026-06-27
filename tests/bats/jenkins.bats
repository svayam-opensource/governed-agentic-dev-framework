#!/usr/bin/env bats
# jenkins.sh auth-method selection (#P5 / auth-tokens-and-clients.md).
# OIDC-fronted Jenkins needs a Bearer token; native Jenkins uses Basic. And a
# token that's silently ignored (request served as anonymous) must be reported
# as a FAILURE, not a success. curl is stubbed so this is fully hermetic.
load helpers
JK="$REPO_SRC/scripts/deploy/jenkins.sh"
setup() {
  sandbox_up
  make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"
  stub_gh_authed
}
teardown() { sandbox_down; }

# Stub curl: emit the given whoAmI JSON when asked for /whoAmI, else empty.
_stub_curl_whoami() {
  stub_bin curl "
for a in \"\$@\"; do case \"\$a\" in
  */whoAmI/api/json) printf '%s' '$1'; exit 0 ;;
esac; done
exit 0"
}

@test "jenkins whoami: bearer token authenticates and reports the identity" {
  _stub_curl_whoami '{"name":"svc-deploy","anonymous":false}'
  run env JENKINS_URL=https://jenkins.test JENKINS_BEARER_TOKEN=tok-abc bash "$JK" whoami
  assert_success
  assert_output --partial "as: svc-deploy"
  assert_output --partial "bearer"
}

@test "jenkins whoami: an ignored token (served as anonymous) is a FAILURE" {
  _stub_curl_whoami '{"name":"anonymous","anonymous":true}'
  run env JENKINS_URL=https://jenkins.test JENKINS_BEARER_TOKEN=tok-bad bash "$JK" whoami
  assert_failure
  assert_output --partial "ANONYMOUS"
  assert_output --partial "auth-tokens-and-clients.md"
}

@test "jenkins whoami: basic auth is used when no bearer token is set" {
  _stub_curl_whoami '{"name":"alice","anonymous":false}'
  run env JENKINS_URL=https://jenkins.test JENKINS_USER=alice JENKINS_API_TOKEN=tok bash "$JK" whoami
  assert_success
  assert_output --partial "as: alice"
  assert_output --partial "basic"
}

@test "jenkins: missing creds (no bearer, no user+token) hard-stops with guidance" {
  # gh stub returns login 'testbot' but the creds file has no JENKINS_* keys.
  run env JENKINS_URL=https://jenkins.test bash "$JK" whoami
  assert_failure
  assert_output --partial "Jenkins API credentials not found"
}
