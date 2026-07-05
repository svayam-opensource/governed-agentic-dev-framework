#!/usr/bin/env bash
# Regenerate the CLI-surface golden snapshot after a DELIBERATE command/option
# change. Review the diff before committing — and make sure the changed command's
# tests/bats/<cmd>.bats was updated too.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SRC="$(cd "$HERE/../.." && pwd)"
mkdir -p "$HERE/golden"
ADF_WORKSPACE="$REPO_SRC" bash "$REPO_SRC/prj" help --detail \
  | sed -E 's/\x1b\[[0-9;]*m//g' > "$HERE/golden/help-detail.txt"
echo "updated $HERE/golden/help-detail.txt"
