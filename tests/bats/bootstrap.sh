#!/usr/bin/env bash
# Fetch the pinned BATS libraries into tests/bats/.libs/ (git-ignored).
# Portable across all CI OSes (mac/win-gitbash/ubuntu/fedora/slackware): a plain
# shallow git clone, no package manager. Idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBS="$HERE/.libs"
mkdir -p "$LIBS"

_fetch() { # <owner/repo> <tag> <dir>
  local repo="$1" tag="$2" dir="$3"
  [[ -d "$LIBS/$dir/.git" || -e "$LIBS/$dir/bin/bats" || -e "$LIBS/$dir/load.bash" ]] && return 0
  rm -rf "${LIBS:?}/${dir:?}"
  git clone --depth 1 --branch "$tag" "https://github.com/$repo" "$LIBS/$dir" >/dev/null 2>&1 \
    || { echo "bootstrap: failed to clone $repo@$tag" >&2; return 1; }
}

_fetch bats-core/bats-core    v1.11.0 bats-core
_fetch bats-core/bats-support v0.3.0  bats-support
_fetch bats-core/bats-assert  v2.1.0  bats-assert
echo "bats libs ready: $LIBS"
