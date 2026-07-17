#!/usr/bin/env bash
# Command-coverage RATCHET (governance test-bed enforcement).
#
# Every command in prj's dispatch must have a tests/bats/<cmd>.bats OR be listed
# in coverage-baseline.txt (accepted, pre-existing debt). A NEW command with
# neither FAILS this check — so adding a command without a test blocks publish.
# As tests are written, remove the command from the baseline (the ratchet only
# tightens). Run by the BATS suite and the Jenkins publish gate.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SRC="$(cd "$HERE/../.." && pwd)"
PRJ="$REPO_SRC/prj"
BASELINE="$HERE/coverage-baseline.txt"

# Enumerate command tokens from the entry-point `case "$CMD" in` block.
cmds() {
  awk '
    /^case "\$CMD" in/ {inblk=1; next}
    inblk && /^esac/ {inblk=0; next}
    inblk && /^[[:space:]]+[A-Za-z0-9_"|*-]+\)/ {
      line=$0; sub(/\).*/, "", line); gsub(/[[:space:]]/, "", line)
      n=split(line, a, "|")
      for (i=1;i<=n;i++) {
        t=a[i]
        if (t=="" || t=="*" || t=="\"\"" || t ~ /^-/) continue
        print t
      }
    }
  ' "$PRJ" | sort -u
}

missing=()
while IFS= read -r c; do
  [[ -z "$c" ]] && continue
  [[ -f "$HERE/$c.bats" ]] && continue
  grep -qxF "$c" "$BASELINE" 2>/dev/null && continue
  missing+=("$c")
done < <(cmds)

if (( ${#missing[@]} )); then
  {
    echo "coverage: command(s) with no tests/bats/<cmd>.bats and not in coverage-baseline.txt:"
    printf '  - %s\n' "${missing[@]}"
    echo "Fix: add tests/bats/<cmd>.bats for each (preferred), or append the name to"
    echo "     tests/bats/coverage-baseline.txt with a one-line reason (accepted debt)."
  } >&2
  exit 1
fi
echo "coverage OK — $(cmds | wc -l | tr -d ' ') commands; $(grep -cvE '^[[:space:]]*(#|$)' "$BASELINE" 2>/dev/null || echo 0) on baseline."
