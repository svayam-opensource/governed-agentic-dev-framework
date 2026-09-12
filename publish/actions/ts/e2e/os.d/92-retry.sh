# SPDX-License-Identifier: MIT
# SCENARIO 2 — a previous attempt failed part-way, and the adopter is trying again.
#
# The most common state a support request arrives in, and the one #186 fixed twice: a
# re-run that is afraid of itself is a re-run nobody makes. Running the installer twice must
# be boring.
scenario "92 · install.sh twice — a retry must be boring (${OS_TIER_LABEL})"

run_installer() {
  drive "$(conv <<'C'
~ 180
# `install.sh` hands over to `gov doctor --fix`, which asks its OWN consent before running
# five commands as root. Not answering it deadlocked the first run for ten minutes: expect
# waited for a later prompt while gov waited for this one.
#
# The answer is NO, deliberately. install.sh's job — Node, the PATH edit, gov itself — is
# done by this point and is what these assertions are about. What comes after is
# `sudo dnf install git`, `sudo dnf install gh`, and then `gh auth login`, which is the one
# step #196 records as impossible to delegate to anybody. A scenario that cannot finish is
# not a scenario; the fix ITINERARY is asserted instead, which is the screen that matters.
> Do you want to continue \(y/N\)\?
< n
> Continue now\? \[Y/n\]
< n
C
)" env GOV_PKG=/work/gov.tgz GOV_NODE_TARBALL=/work/node.tar.gz GOV_YES=1 bash /src/install.sh
}

run_installer
exists "first run: Node is in place" "$HOME/.local/share/gov/node/bin/node"
first_node="$(readlink -f "$HOME/.local/share/gov/node/bin/node")"

info "now the failed-run shape: the tree exists, the client does not"
rm -f "$HOME/.local/bin/gov"
rm -rf "$HOME/.local/share/gov/node/lib/node_modules/@svayam-opensource" 2>/dev/null

run_installer
# ASSERT WHAT WAS REMOVED IS BACK, not where one distro happens to put a wrapper.
#
# This checked `~/.local/bin/gov` and failed on debian and ubuntu, where that directory is not
# on PATH so install.sh deliberately takes the profile route instead (scenario 90 documents the
# difference, and 91 had the identical bug). It was also redundant: the line below already asks
# the only question that matters on every image — can a new login shell run gov. What the retry
# is actually about is the CLIENT coming back, which is precisely what was deleted above.
exists "second run: the client is back where the retry deleted it" \
  "$HOME/.local/share/gov/node/lib/node_modules/@svayam-opensource"
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
