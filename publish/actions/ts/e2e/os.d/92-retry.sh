# SPDX-License-Identifier: MIT
# SCENARIO 2 — a previous attempt failed part-way, and the adopter is trying again.
#
# The most common state a support request arrives in, and the one #186 fixed twice: a
# re-run that is afraid of itself is a re-run nobody makes. Running the installer twice must
# be boring.
scenario "92 · install.sh twice — a retry must be boring (${OS_TIER_LABEL})"

run_installer() {
  drive "$(conv <<'C'
~ 600
> Continue now\? \[Y/n\]
< n
C
)" env GOV_PKG=/work/gov.tgz GOV_YES=1 bash /src/install.sh
}

run_installer
exists "first run: Node is in place" "$HOME/.local/share/gov/node/bin/node"
first_node="$(readlink -f "$HOME/.local/share/gov/node/bin/node")"

info "now the failed-run shape: the tree exists, the client does not"
rm -f "$HOME/.local/bin/gov"
rm -rf "$HOME/.local/share/gov/node/lib/node_modules/@svayam-opensource" 2>/dev/null

run_installer
exists "second run: gov is back" "$HOME/.local/bin/gov"
in_a_new_login_shell "gov --version" \
  && pass "and runnable — a retry RESUMES rather than half-repeating" \
  || fail "gov is still not runnable after the retry"
[ "$(readlink -f "$HOME/.local/share/gov/node/bin/node")" = "$first_node" ] \
  && pass "#186 — Node was not downloaded again; what was already true was left alone" \
  || fail "the retry reinstalled Node it did not need to"
saw "and the second run says what it SKIPPED, rather than pretending to do it" "already present"

info "a third run changes nothing at all"
run_installer
in_a_new_login_shell "gov --version" && pass "still fine after three runs" || fail "the third run broke it"
