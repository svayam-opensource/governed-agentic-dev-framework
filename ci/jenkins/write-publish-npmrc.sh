#!/usr/bin/env bash
# Writes ./.npmrc in the current directory (the repo root) with publish auth.
# Reused verbatim from the org's npm-publish convention (911-SVM-LIB-SVC).
# Uses NPM_AUTH_B64 from the environment only (not Groovy), so Jenkins does not
# flag writeFile.
#
# NPMRC_AUTH_MODE=basic (default): secret is Base64 for legacy _auth
#   (e.g. echo -n 'user:pass' | base64).
# NPMRC_AUTH_MODE=token: secret is the registry token verbatim
#   (Verdaccio / npm _authToken style).
set -euo pipefail
umask 077

: "${NPM_AUTH_B64:?NPM_AUTH_B64 is not set}"
: "${NPMRC_SCOPE_LINE:?NPMRC_SCOPE_LINE is not set}"
: "${NPMRC_REGISTRY_LINE:?NPMRC_REGISTRY_LINE is not set}"
: "${NPMRC_HOST:?NPMRC_HOST is not set}"

auth="${NPM_AUTH_B64//[[:space:]]/}"
if [[ -z "$auth" ]]; then
  echo 'npm publish credential is empty after trim — check Jenkins credential' >&2
  exit 1
fi

mode="${NPMRC_AUTH_MODE:-basic}"

{
  printf '%s\n' "$NPMRC_SCOPE_LINE"
  printf '%s\n' "$NPMRC_REGISTRY_LINE"
  printf '%s\n' 'always-auth=true'
  if [[ "$mode" == "token" ]]; then
    printf '%s\n' "//${NPMRC_HOST}/:_authToken=${auth}"
  else
    printf '%s\n' "//${NPMRC_HOST}/:_auth=${auth}"
  fi
  printf '%s\n' "//${NPMRC_HOST}/:always-auth=true"
  if [[ -n "${NPMRC_EMAIL:-}" ]]; then
    printf 'email=%s\n' "$NPMRC_EMAIL"
  fi
} > .npmrc
