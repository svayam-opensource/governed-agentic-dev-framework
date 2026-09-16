#!/usr/bin/env bash
# Print one version's section from CHANGELOG.md, for a release body.
#
#   ci/changelog-section.sh 1.2.2
#
# Exits non-zero when the version has no section. That is deliberate: a release whose notes would be
# empty is a release nobody can read, and the publish workflow should stop rather than create one.
set -euo pipefail

version=${1:?usage: changelog-section.sh <version>}
file=${2:-CHANGELOG.md}
[ -f "$file" ] || { echo "no $file" >&2; exit 1; }

# From the matching `## <version>` heading to the next `## ` heading, exclusive of both.
section=$(awk -v v="$version" '
  $0 ~ "^## " v "( |$)" { inside = 1; next }
  inside && /^## / { exit }
  inside { print }
' "$file")

# Trim leading and trailing blank lines without collapsing the middle.
section=$(printf '%s\n' "$section" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')

if [ -z "$section" ]; then
  echo "CHANGELOG.md has no entries under '## $version'" >&2
  exit 1
fi
printf '%s\n' "$section"
