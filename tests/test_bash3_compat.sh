#!/usr/bin/env bash
# Verify all scripts are bash 3.2 compatible.
#
# macOS ships bash 3.2 by default (and will continue to, due to bash's
# license switch to GPLv3 in 4.0). Adopters who haven't manually installed
# bash 4+ via brew will hit hard failures on bash 4+ idioms.
#
# This test grep-scans for the most common bash 4+ features:
#   - declare -A / typeset -A    (associative arrays)
#   - mapfile / readarray         (file-into-array builtins)
#   - ${VAR^^} / ${VAR,,}         (case modification)
#   - ${!arr[@]} indirection     (debatable; bash 3 supports it for indexed)
#
# Catches the regression where seed.sh used `declare -A REPO_BASE_MAP=()`
# (fixed in v0.1.2). All scripts must remain bash 3.2 compatible going
# forward to keep the macOS quickstart working out of the box.

TEST_NAME="bash3_compat"
source "$(dirname "$0")/lib.sh"

cd "$REPO_ROOT" || { t_fail "Cannot cd to REPO_ROOT"; exit 1; }

# Files to check.
# Scan BOTH the org-side tree (scripts/, prj) AND the published Source-of-Truth
# (framework/scripts/, framework/prj) — the SoT is what adopters consume, and it
# was previously unguarded (PRJ-013 audit H2 / issue #59). Roots that don't
# exist in a given tree (e.g. framework/ may be absent post-publish) are skipped
# because find is given only the dirs present, and missing files are filtered
# below by the `[[ ! -f ]]` guard.
SCRIPTS=(prj setup.sh framework/prj)
FIND_ROOTS=()
for d in scripts tests framework/scripts framework/prj; do
  [[ -d "$d" ]] && FIND_ROOTS+=("$d")
done
while IFS= read -r f; do
  SCRIPTS+=("$f")
done < <(find "${FIND_ROOTS[@]}" -name '*.sh' -not -name 'run-all.sh' -not -name 'lib.sh' 2>/dev/null)

# Patterns that fail on bash 3.2.
# (Comments are stripped before matching so explanatory text mentioning
#  these patterns doesn't trigger a false positive.)
check_file() {
  local file="$1"
  local stripped
  stripped=$(grep -vE '^\s*#' "$file")

  # Associative array declaration (bash 4.0+).
  # Detects: declare/typeset followed by whitespace and an option containing 'A'.
  if echo "$stripped" | grep -qE '(declare|typeset)\s+-[a-zA-Z]*A'; then
    t_fail "$file uses an associative array declaration (bash 4+)"
    return 1
  fi

  # File-to-array builtins (bash 4.0+): mapfile and readarray.
  if echo "$stripped" | grep -qE '(^|[^a-zA-Z_])(mapfile|readarray)([^a-zA-Z_]|$)'; then
    t_fail "$file uses a bash-4 file-to-array builtin"
    return 1
  fi

  # Case-modification parameter expansion (bash 4.0+).
  if echo "$stripped" | grep -qE '\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?(\^\^?|,,?)\}'; then
    t_fail "$file uses bash-4 case-modification parameter expansion"
    return 1
  fi

  # Length-of-array combined with default-value modifier — invalid in bash 3.2.
  # ${#arr[@]:-0} produces "bad substitution" because :-default only works on
  # plain variable expansion, not the length form.  ${#arr[@]} alone is fine.
  if echo "$stripped" | grep -qE '\$\{#[A-Za-z_][A-Za-z0-9_]*\[[@*]\]:-'; then
    t_fail "$file uses invalid length-with-default substitution \${#arr[@]:-N}"
    return 1
  fi

  return 0
}

PASSES=0
for f in "${SCRIPTS[@]}"; do
  if [[ ! -f "$f" ]]; then
    continue
  fi
  # Self-exempt: this test contains the very patterns it scans for, as
  # grep regex literals. They aren't actual bash 4 usage.
  if [[ "$f" == *"test_bash3_compat.sh" ]]; then
    continue
  fi
  if check_file "$f"; then
    PASSES=$((PASSES + 1))
  fi
done

if [[ "$PASSES" -gt 0 ]]; then
  t_pass "$PASSES script(s) verified bash 3.2 compatible"
fi
