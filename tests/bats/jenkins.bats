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

# ── ensure-job (idempotent job provisioning per jenkins-job-organization.md) ──
# Stub curl: log every createItem POST; answer existence/crumb GETs with $FAKE_HTTP.
_stub_curl_provision() {
  stub_bin curl "
for a in \"\$@\"; do case \"\$a\" in *createItem*) echo \"CREATE \$a\" >> '$TEST_TMP/curl.log'; exit 0 ;; esac; done
for a in \"\$@\"; do case \"\$a\" in *api/json*) printf '%s' \"\${FAKE_HTTP:-404}\"; exit 0 ;; esac; done
exit 0"
  : > "$TEST_TMP/curl.log"
}

@test "ensure-job: creates the folder chain + leaf pipeline job when nothing exists" {
  _stub_curl_provision
  run env JENKINS_URL=https://jenkins.test JENKINS_BEARER_TOKEN=tok \
      JENKINS_SCM_URL=git@github.com:Svayamtech/svm-prj-work.git FAKE_HTTP=404 \
      bash "$JK" ensure-job svm-prj-work/deploy/dev/demo
  assert_success
  # 3 folders (svm-prj-work, deploy, dev) + 1 leaf job (demo) = 4 createItem POSTs.
  run grep -c '^CREATE' "$TEST_TMP/curl.log"
  assert_output "4"
  run cat "$TEST_TMP/curl.log"
  assert_output --partial "name=demo"
}

@test "ensure-job: idempotent - creates nothing when everything already exists" {
  _stub_curl_provision
  run env JENKINS_URL=https://jenkins.test JENKINS_BEARER_TOKEN=tok \
      JENKINS_SCM_URL=git@github.com:Svayamtech/svm-prj-work.git FAKE_HTTP=200 \
      bash "$JK" ensure-job svm-prj-work/deploy/dev/demo
  assert_success
  assert_output --partial "(exists)"
  [ ! -s "$TEST_TMP/curl.log" ]   # no createItem POSTs
}

@test "ensure-job: requires JENKINS_SCM_URL (the workspace repo git URL)" {
  _stub_curl_provision
  run env JENKINS_URL=https://jenkins.test JENKINS_BEARER_TOKEN=tok FAKE_HTTP=404 \
      bash "$JK" ensure-job svm-prj-work/deploy/dev/demo
  assert_failure
  assert_output --partial "JENKINS_SCM_URL"
}

@test "ensure-job: rejects a too-short path" {
  _stub_curl_provision
  run env JENKINS_URL=https://jenkins.test JENKINS_BEARER_TOKEN=tok \
      JENKINS_SCM_URL=git@x.test/r.git FAKE_HTTP=404 bash "$JK" ensure-job deploy/dev
  assert_failure
  assert_output --partial "must be <workspace>/<activity>/<env>/<unit>"
}
