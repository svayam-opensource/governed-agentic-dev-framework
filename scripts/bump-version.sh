#!/usr/bin/env bash
#
# bump-version.sh <x.y.z[-pre]>
#
# Single action that writes the release version into the three internal places
# that must agree:
#
#   1. package.json        -> "version"
#   2. framework/VERSION
#   3. .framework-version
#
# The README diagram images are served by jsDelivr from the published npm
# tarball via the floating `@latest` tag, so they are NOT version-pinned and
# need no edit here. scripts/validate/check_version_sync.py enforces all of
# this in CI and in the Jenkins publish gate.
#
# Usage:
#   scripts/bump-version.sh 0.5.4
#   then: review `git diff`, commit, push, trigger the publish webhook.
#
set -euo pipefail

new="${1:-}"
if [ -z "$new" ]; then
  echo "usage: scripts/bump-version.sh <x.y.z>" >&2
  exit 2
fi
case "$new" in
  [0-9]*.[0-9]*.[0-9]*) : ;;
  *) echo "error: '$new' is not a version (expected x.y.z)" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# package.json: targeted replace of the top-level "version" value only — keeps
# the file's existing formatting intact (no full re-serialize).
NEW="$new" perl -0pi -e 's/("version"\s*:\s*")[^"]*(")/$1.$ENV{NEW}.$2/e' package.json
printf '%s\n' "$new" > framework/VERSION
printf '%s\n' "$new" > .framework-version

echo "bumped -> $new"
echo "  package.json       $(grep -m1 '"version"' package.json | tr -d ' ,')"
echo "  framework/VERSION  $(cat framework/VERSION)"
echo "  .framework-version $(cat .framework-version)"
echo
echo "next: review 'git diff', commit + push, then trigger the publish webhook."
