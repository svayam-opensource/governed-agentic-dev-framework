#!/usr/bin/env bats
# Static lints that plug two bug CLASSES that shipped because nothing caught them:
#   - #75 removed menu_status/menu_admin but left the dispatch calling them. bash -n and
#     shellcheck do NOT flag a call to an undefined function (it's a runtime error), and the
#     menu options that hit them were never exercised by a test or the (subcommand-driven) E2E.
#   - Python print() emits CRLF on Windows, so `read` of python output kept a \r ("45\r"),
#     breaking the board number. Linux/macOS CI never reproduces it; the interactive picker
#     isn't driven on Windows CI. So a SOURCE lint is the only cross-platform guard.
# These run on every platform and would have failed the PRs that introduced both bugs.
load helpers

@test "lint: every cmd_*/menu_* referenced in prj is defined (dispatch integrity; #75 regression)" {
  run bash -c '
    src="'"$PRJ_BIN"'"
    defined=$( { grep -hoE "^[[:space:]]*(cmd|menu)_[a-z_]+\(\)" "$src";
                 grep -rhoE "^[[:space:]]*(cmd|menu)_[a-z_]+\(\)" "'"$REPO_SRC"'/scripts" 2>/dev/null; } \
               | grep -oE "(cmd|menu)_[a-z_]+" | sort -u )
    called=$(grep -oE "\b(cmd|menu)_[a-z_]+\b" "$src" | sort -u)
    missing=""
    while IFS= read -r c; do [ -n "$c" ] && { echo "$defined" | grep -qx "$c" || missing="$missing $c"; }; done <<< "$called"
    [ -z "$missing" ] && echo OK || { echo "REFERENCED-BUT-UNDEFINED:$missing"; exit 1; }
  '
  assert_success
  assert_output --partial "OK"
}

@test "lint: every read-loop over python3 output strips trailing CR (Windows CRLF safety)" {
  # any `read` fed by a python3 process-substitution must strip \r (the loop body references \r).
  run bash -c '
    bad=$(grep -nE "read -r .*< <\(.*python3" "'"$PRJ_BIN"'" | grep -v "\\\\r" || true)
    [ -z "$bad" ] && echo OK || { echo "UNSTRIPPED-CRLF-READ:"; echo "$bad"; exit 1; }
  '
  assert_success
  assert_output --partial "OK"
}
