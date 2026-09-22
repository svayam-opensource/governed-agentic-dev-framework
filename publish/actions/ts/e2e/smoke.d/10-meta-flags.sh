# Meta flags must work with NO workspace resolved (an adopter's first commands).
has "$(gov --version)" "gov " "gov --version works without a workspace"
has "$(gov -v)"        "gov " "gov -v works"
has "$(gov --help)"    "These are the gov commands" "gov --help works without a workspace"

# HELP NEVER ACTS (PRJ-121, 2026-09-22): `gov merge -h` used to attempt a merge, `gov work --help` started the
# work flow, and `gov help <cmd>` was "unknown command 'help'".
has "$(gov help 2>&1)"          "These are the gov commands" "gov help works (the overview)"
has "$(gov help task 2>&1)"     "gov task —"                  "gov help <cmd> answers for that command"
has "$(gov task --help 2>&1)"   "gov task —"                  "gov <cmd> --help is the same page"
out="$(gov merge -h 2>&1)"; rc=$?
has "$out" "gov merge —" "gov merge -h prints help"
[ "$rc" -eq 0 ] && ! echo "$out" | grep -q "is not a project branch" && pass "…and does NOT attempt a merge" || fail "gov merge -h ran merge (rc=$rc): $out"
gov help nosuch >/dev/null 2>&1; [ $? -eq 2 ] && pass "help for a command that does not exist is a usage error (exit 2)" || fail "gov help nosuch did not exit 2"
