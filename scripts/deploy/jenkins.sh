#!/usr/bin/env bash
# Jenkins API client (PRJ-012 #75/S5 support). Trigger jobs / reload / read status
# using the CURRENT developer's per-human Jenkins API token (resolve_jenkins_creds
# in lib.sh: env first, else $AGENT_WORK_ROOT/preferences/<gh-login>/credentials).
# The token authenticates the CALLER to Jenkins; RBAC governs what they may do.
#
# Usage:
#   jenkins.sh trigger <job> [PARAM=value ...]   # build (with parameters)
#   jenkins.sh status  <job>                     # last build result
#   jenkins.sh reload                            # reload configuration from disk
#   jenkins.sh whoami                            # verify creds (no secrets echoed)
#
# Never echoes the token. CSRF crumb fetched per call.
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
source "$(dirname "$0")/deploy-lib.sh"      # deploy-module creds helpers (resolve_jenkins_creds)
load_config
resolve_jenkins_creds                       # sets + validates JENKINS_URL/USER/API_TOKEN

BASE="${JENKINS_URL%/}"
# Auth method (see auth-tokens-and-clients.md): an OIDC-fronted Jenkins (e.g.
# behind Authentik) only accepts an OIDC access token in a Bearer header — its
# own user:API-token (Basic) is intercepted by the SSO layer and the request
# falls through to anonymous. A native Jenkins uses Basic. Prefer Bearer when a
# bearer token is present; else Basic. JK_AUTH is spliced into every curl call.
if [[ -n "${JENKINS_BEARER_TOKEN:-}" ]]; then
  JK_AUTH=(-H "Authorization: Bearer ${JENKINS_BEARER_TOKEN}")
  JK_AUTH_KIND="bearer (OIDC)"
else
  JK_AUTH=(-u "${JENKINS_USER}:${JENKINS_API_TOKEN}")
  JK_AUTH_KIND="basic"
fi
POLL_INTERVAL="${JENKINS_POLL_INTERVAL:-10}"   # seconds between polls
POLL_TIMEOUT="${JENKINS_POLL_TIMEOUT:-1800}"   # overall wait cap (30 min)

# Job PATH -> Jenkins API path. Folder jobs are nested: 'svm-prj-work/deploy/svm-ident/uat'
# becomes 'job/deploy/job/svm-ident/job/uat'. A flat name has no '/' and just
# becomes 'job/<name>'. (New design = folder structure; see jenkins-job-organization.md.)
_jp() { local IFS=/; local out=""; for seg in $1; do out="${out}/job/${seg}"; done; echo "${out#/}"; }

# Fetch a CSRF crumb header (Jenkins requires it for POSTs). Empty if crumbs are off.
_crumb() {
  curl -fsS --connect-timeout 10 --max-time 60 "${JK_AUTH[@]}" "${BASE}/crumbIssuer/api/json" 2>/dev/null \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print(f"{d[\"crumbRequestField\"]}:{d[\"crumb\"]}")' 2>/dev/null \
    || echo ""
}

cmd_whoami() {
  # Use /whoAmI (readable even by anonymous) so we can DISTINGUISH "token rejected
  # → request fell through to anonymous" from a genuine identity. A 200 alone is
  # not proof of auth — an OIDC-fronted Jenkins that ignores an unaccepted token
  # serves the call as the anonymous principal.
  local j; j=$(curl -fsS --connect-timeout 10 --max-time 60 "${JK_AUTH[@]}" "${BASE}/whoAmI/api/json" 2>/dev/null || echo "")
  [[ -n "$j" ]] || hard_stop "Jenkins unreachable at ${BASE} (or the request was blocked before auth)."
  local name anon
  name=$(printf '%s' "$j" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("name") or "?")' 2>/dev/null || echo "?")
  anon=$(printf '%s' "$j" | python3 -c 'import sys,json;print("1" if json.load(sys.stdin).get("anonymous") else "")' 2>/dev/null || echo "")
  if [[ -n "$anon" || "$name" == "anonymous" ]]; then
    hard_stop "Jenkins treated the request as ANONYMOUS — your ${JK_AUTH_KIND} token was NOT accepted.
  If this Jenkins is OIDC-fronted (e.g. behind Authentik): set JENKINS_BEARER_TOKEN to an
  Authentik OIDC access token (not a Jenkins API token), and have the Jenkins admin enable
  the oic-auth plugin's 'bearer token access'. See auth-tokens-and-clients.md."
  fi
  echo "Authenticated to ${BASE} as: ${name}  [${JK_AUTH_KIND}]"
}

cmd_reload() {
  local c; c=$(_crumb)
  curl -fsS --connect-timeout 10 --max-time 60 "${JK_AUTH[@]}" ${c:+-H "$c"} -X POST "${BASE}/reload" \
    && echo "Reload requested." || hard_stop "Reload failed (need admin rights?)."
}

cmd_trigger() {
  local job="$1"; shift || true
  [[ -n "$job" ]] || hard_stop "trigger: job name required."
  local c; c=$(_crumb)
  # Our jobs are all parameterized → buildWithParameters (applies defaults if no overrides).
  local args=(); local kv
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  curl -fsS --connect-timeout 10 --max-time 60 "${JK_AUTH[@]}" ${c:+-H "$c"} -X POST "${BASE}/$(_jp "$job")/buildWithParameters" "${args[@]}" \
    && echo "Triggered ${job}." || hard_stop "Trigger failed for ${job}."
}

cmd_status() {
  local job="$1"
  curl -fsS --connect-timeout 10 --max-time 60 "${JK_AUTH[@]}" "${BASE}/$(_jp "$job")/lastBuild/api/json" 2>/dev/null \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print(f"{d.get(\"number\")}: {d.get(\"result\") or (\"BUILDING\" if d.get(\"building\") else \"?\")}")' \
    || hard_stop "Could not read status for ${job}."
}

# ── Transactional run: trigger -> track queue item -> poll build to completion ──
_jpy() { python3 -c "$1" 2>/dev/null || echo ""; }   # parse stdin JSON with a tiny expr

# POST a build and return the queue-item URL (from the Location header).
_post_build_queue() {
  local job="$1"; shift || true
  local c; c=$(_crumb)
  local hdrs
  # Our jobs are all parameterized → always buildWithParameters. With no overrides
  # Jenkins applies the job's declared defaults (a bare /build 400s on parameterized jobs).
  local args=(); local kv; for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  hdrs=$(curl -fsS --connect-timeout 10 --max-time 60 "${JK_AUTH[@]}" ${c:+-H "$c"} -D - -o /dev/null -X POST "${BASE}/$(_jp "$job")/buildWithParameters" "${args[@]}")
  echo "$hdrs" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}' | head -1
}

# Wait for a queue item to schedule; echo the build number (or CANCELLED/TIMEOUT, rc!=0).
_queue_to_build() {
  local q="${1%/}" waited=0 j n cancelled
  while :; do
    j=$(curl -fsS --connect-timeout 10 --max-time 30 "${JK_AUTH[@]}" "${q}/api/json" 2>/dev/null || echo "{}")
    n=$(echo "$j" | _jpy 'import sys,json;e=(json.load(sys.stdin).get("executable") or {});print(e.get("number") or "")')
    cancelled=$(echo "$j" | _jpy 'import sys,json;print("1" if json.load(sys.stdin).get("cancelled") else "")')
    [[ -n "$cancelled" ]] && { echo "CANCELLED"; return 1; }
    [[ -n "$n" ]] && { echo "$n"; return 0; }
    waited=$((waited + POLL_INTERVAL)); [[ $waited -ge $POLL_TIMEOUT ]] && { echo "TIMEOUT"; return 1; }
    sleep "$POLL_INTERVAL"
  done
}

# Wait for a build to finish; echo its result (SUCCESS/FAILURE/...) (or TIMEOUT, rc!=0).
_build_wait() {
  local job="$1" n="$2" waited=0 j building result
  while :; do
    j=$(curl -fsS --connect-timeout 10 --max-time 30 "${JK_AUTH[@]}" "${BASE}/$(_jp "$job")/${n}/api/json" 2>/dev/null || echo "{}")
    building=$(echo "$j" | _jpy 'import sys,json;print("1" if json.load(sys.stdin).get("building") else "")')
    result=$(echo "$j" | _jpy 'import sys,json;print(json.load(sys.stdin).get("result") or "")')
    if [[ -z "$building" && -n "$result" ]]; then echo "$result"; return 0; fi
    waited=$((waited + POLL_INTERVAL)); [[ $waited -ge $POLL_TIMEOUT ]] && { echo "TIMEOUT"; return 1; }
    sleep "$POLL_INTERVAL"
  done
}

# Trigger a job and BLOCK until it finishes. Exit 0 iff result == SUCCESS.
cmd_run() {
  local job="$1"; shift || true
  local q; q=$(_post_build_queue "$job" "$@")
  [[ -n "$q" ]] || hard_stop "Could not queue ${job} (no Location header — check the job name / permissions)."
  echo "Queued ${job}: ${q}"
  local num; num=$(_queue_to_build "$q") || hard_stop "${job}: ${num} while waiting in the queue."
  echo "${job} started build #${num} — waiting for completion ..."
  local res; res=$(_build_wait "$job" "$num") || hard_stop "${job} #${num}: ${res} (gave up after ${POLL_TIMEOUT}s)."
  echo "${job} #${num}: ${res}"
  [[ "$res" == "SUCCESS" ]]
}

CMD="${1:-}"; shift || true
case "$CMD" in
  whoami)  cmd_whoami ;;
  reload)  cmd_reload ;;
  trigger) cmd_trigger "$@" ;;
  run)     cmd_run "$@" ;;
  status)  cmd_status "$@" ;;
  *) hard_stop "Usage: jenkins.sh {whoami|reload|trigger <job> [P=v...]|run <job> [P=v...]|status <job>}" ;;
esac
