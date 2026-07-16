#!/usr/bin/env bash
# =============================================================================
# deploy-lib.sh — deploy-module shared helpers (sourced AFTER scripts/lib.sh).
#
# Holds the deploy-specific credential helpers (per-human Jenkins API token
# resolution) that the remote backends need. Kept out of the generic governance
# lib.sh so the deploy module is self-contained. Depends on lib.sh for
# `hard_stop` and on `load_config` having set `$AGENT_WORK_ROOT`.
# =============================================================================

# Per-developer secrets directory: $AGENT_WORK_ROOT/preferences/<gh-login>/.
# Each developer holds THEIR OWN secrets here (per-human, no shared vault).
current_user_creds_path() {
  local login
  login=$(gh api user --jq .login 2>/dev/null || echo "")
  [[ -z "$login" ]] && return 0
  echo "$AGENT_WORK_ROOT/preferences/$login/credentials"
}

# Read a single KEY=value from a credentials file (does NOT source it — never
# executes the file). Tolerant of surrounding quotes + a trailing CR. Empty if absent.
creds_get() {
  local file="$1" key="$2" v
  [[ -f "$file" ]] || return 0
  v=$(grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2-)
  v="${v%$'\r'}"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "$v"
}

# Resolve the current developer's Jenkins API credentials into the environment:
# JENKINS_URL / JENKINS_USER / JENKINS_API_TOKEN. Order: (1) env if all three set,
# else (2) the per-developer creds file. A Jenkins API token is PER-HUMAN; never
# shared, never echoed. hard_stops with onboarding guidance if missing.
resolve_jenkins_creds() {
  # Two auth methods (see auth-tokens-and-clients.md):
  #   • Bearer — JENKINS_BEARER_TOKEN: an Authentik OIDC access token, required
  #     when Jenkins is OIDC-fronted (its own user:API-token Basic auth is
  #     rejected by the SSO layer). Preferred when present.
  #   • Basic  — JENKINS_USER + JENKINS_API_TOKEN: a native Jenkins API token,
  #     for a directly-reachable Jenkins.
  # Need: JENKINS_URL + (a bearer token OR user+API token).
  _jk_have_bearer() { [[ -n "${JENKINS_BEARER_TOKEN:-}" ]]; }
  _jk_have_basic()  { [[ -n "${JENKINS_USER:-}" && -n "${JENKINS_API_TOKEN:-}" ]]; }
  if [[ -n "${JENKINS_URL:-}" ]] && { _jk_have_bearer || _jk_have_basic; }; then
    export JENKINS_URL JENKINS_USER JENKINS_API_TOKEN JENKINS_BEARER_TOKEN
    return 0
  fi
  local login credfile
  login=$(gh api user --jq .login 2>/dev/null || echo "")
  [[ -n "$login" ]] || hard_stop "Cannot resolve your GitHub login (run 'gh auth login') to locate your Jenkins token."
  credfile="$AGENT_WORK_ROOT/preferences/$login/credentials"
  : "${JENKINS_URL:=$(creds_get "$credfile" JENKINS_URL)}"
  : "${JENKINS_USER:=$(creds_get "$credfile" JENKINS_USER)}"
  : "${JENKINS_API_TOKEN:=$(creds_get "$credfile" JENKINS_API_TOKEN)}"
  : "${JENKINS_BEARER_TOKEN:=$(creds_get "$credfile" JENKINS_BEARER_TOKEN)}"
  if [[ -z "${JENKINS_URL:-}" ]] || { ! _jk_have_bearer && ! _jk_have_basic; }; then
    hard_stop "Jenkins API credentials not found. This is a PER-HUMAN credential.
  Pick the method that matches your Jenkins ('prj creds groups' for detail):
    • OIDC-fronted Jenkins (e.g. behind Authentik) — Bearer:
         JENKINS_URL=https://jenkins.svayamtech.com/
         JENKINS_BEARER_TOKEN=<Authentik OIDC access token>
    • Native Jenkins — Basic:
         JENKINS_URL=https://jenkins.example.com/
         JENKINS_USER=$login
         JENKINS_API_TOKEN=<your Jenkins API token>
  Add to '$credfile' (or 'export' the vars). Never share or commit the token.
  See auth-tokens-and-clients.md for how to tell which one you need."
  fi
  export JENKINS_URL JENKINS_USER JENKINS_API_TOKEN JENKINS_BEARER_TOKEN
}
