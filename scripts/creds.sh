#!/usr/bin/env bash
# creds — manage YOUR per-developer credentials for the governance scripts (prj ...).
#
# Secrets the governance tooling needs (e.g. a Jenkins API (Application Programming
# Interface) token for `prj deploy`) are PER-HUMAN — each developer holds their own,
# in their own file, never shared, never committed (credential-ownership-policy):
#   $AGENT_WORK_ROOT/preferences/<your-gh-login>/credentials
#
# This helper creates/edits that file safely (chmod 600, never echoes a value) and
# guides you through each known credential group.
#
# Usage:
#   creds path                 # print your creds file path (user@host:<path>)
#   creds groups               # list known credential groups + what they're for
#   creds list                 # KEY names present in your file (values hidden)
#   creds add <group>          # guided add for a group (e.g. jenkins)
#   creds set <KEY> [VALUE]     # set/replace one key (VALUE omitted = hidden prompt)
#   creds check <group>        # verify a group (e.g. jenkins -> jenkins.sh whoami)
set -euo pipefail
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SELF_DIR/lib.sh"
load_config

LOGIN=$(gh api user --jq .login 2>/dev/null || echo "")
[[ -n "$LOGIN" ]] || hard_stop "Cannot resolve your GitHub login ('gh auth login') to locate your creds file."
CREDFILE="$AGENT_WORK_ROOT/preferences/$LOGIN/credentials"
HOST=$(hostname -s 2>/dev/null || hostname)

# Known credential groups: <group> -> "KEY1 KEY2 ..." + a human description + guidance.
group_keys() { case "$1" in
  jenkins) echo "JENKINS_URL JENKINS_USER JENKINS_API_TOKEN" ;;
  *) echo "" ;; esac; }
group_desc() { case "$1" in
  jenkins) echo "Jenkins API token — for 'prj deploy' to trigger/inspect jobs." ;;
  *) echo "" ;; esac; }

_ensure_file() {
  if [[ ! -f "$CREDFILE" ]]; then
    mkdir -p "$(dirname "$CREDFILE")"
    {
      echo "# Credentials for $LOGIN — PER-HUMAN. Do not share or commit. (POL-143)"
      echo "# Managed by 'prj creds'. KEY=value lines, sectioned with '## ' comments."
    } > "$CREDFILE"
  fi
  chmod 600 "$CREDFILE" 2>/dev/null || true
}

# Replace-or-append a single KEY=value (idempotent; preserves all other lines).
_set_key() {
  local key="$1" val="$2"
  _ensure_file
  local tmp; tmp=$(mktemp)
  grep -vE "^${key}=" "$CREDFILE" > "$tmp" 2>/dev/null || true
  echo "${key}=${val}" >> "$tmp"
  cat "$tmp" > "$CREDFILE"; rm -f "$tmp"
  chmod 600 "$CREDFILE" 2>/dev/null || true
}

cmd_path()   { echo "$(whoami)@${HOST}:${CREDFILE}"; }
cmd_groups() {
  echo "Known credential groups:"
  for g in jenkins; do printf "  %-10s %s\n      keys: %s\n" "$g" "$(group_desc "$g")" "$(group_keys "$g")"; done
}
cmd_list() {
  [[ -f "$CREDFILE" ]] || { echo "(no creds file yet — $(cmd_path))"; return 0; }
  echo "Keys in $(cmd_path):"
  grep -oE '^[A-Za-z_0-9]+=' "$CREDFILE" 2>/dev/null | sed 's/=$//' | sed 's/^/  /' || echo "  (none)"
}

cmd_set() {
  local key="${1:-}" val="${2:-}"
  [[ -n "$key" ]] || hard_stop "Usage: creds set <KEY> [VALUE]"
  if [[ -z "$val" ]]; then
    read -rs -p "Value for $key (hidden): " val; echo
  fi
  [[ -n "$val" ]] || hard_stop "Empty value — aborted."
  _set_key "$key" "$val"
  echo "Set $key in $(cmd_path)  (value not echoed)."
}

cmd_add() {
  local group="${1:-}"
  local keys; keys=$(group_keys "$group")
  [[ -n "$keys" ]] || hard_stop "Unknown group '$group'. Try: creds groups"
  if [[ "$group" == "jenkins" ]]; then
    echo "Jenkins is an OIDC (OpenID Connect) client — you LOG IN via auth.svayamtech.com, but the API"
    echo "uses a token you generate INSIDE Jenkins:"
    echo "  1. Open Jenkins (you'll be sent through the OIDC login)."
    echo "  2. Your user id is in your profile URL: https://jenkins.svayamtech.com/user/<THIS>/"
    echo "  3. There: Security -> API Token -> Add new Token -> copy it."
    echo ""
    local url user token
    read -rp "JENKINS_URL [https://jenkins.svayamtech.com/]: " url; url="${url:-https://jenkins.svayamtech.com/}"
    read -rp "JENKINS_USER (your Jenkins user id from step 2): " user
    read -rsp "JENKINS_API_TOKEN (hidden): " token; echo
    [[ -n "$user" && -n "$token" ]] || hard_stop "JENKINS_USER and JENKINS_API_TOKEN are required."
    _set_key JENKINS_URL "$url"; _set_key JENKINS_USER "$user"; _set_key JENKINS_API_TOKEN "$token"
    echo "Saved Jenkins creds to $(cmd_path)  (token not echoed)."
    echo "Verify: prj creds check jenkins"
  fi
}

cmd_check() {
  local group="${1:-}"
  case "$group" in
    jenkins) bash "$SELF_DIR/deploy/jenkins.sh" whoami ;;
    *) hard_stop "No check for group '$group'. Try: creds groups" ;;
  esac
}

CMD="${1:-}"; shift || true
case "$CMD" in
  path)   cmd_path ;;
  groups) cmd_groups ;;
  list)   cmd_list ;;
  set)    cmd_set "$@" ;;
  add)    cmd_add "$@" ;;
  check)  cmd_check "$@" ;;
  *) hard_stop "Usage: creds {path|groups|list|add <group>|set <KEY> [VALUE]|check <group>}" ;;
esac
