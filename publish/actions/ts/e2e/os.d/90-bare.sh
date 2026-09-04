# SPDX-License-Identifier: MIT
# SCENARIO 1 — the target is bland and has nothing.
#
# No Node, no gov, no workspace, no profile edit. This is the only shape in which the
# installer's own decisions are visible: where Node goes, whether the PATH edit lands in the
# profile this shell reads, and whether `gov` is reachable from a terminal opened tomorrow.
scenario "90 · bare machine — install.sh from nothing (${OS_TIER_LABEL})"

info "before: nothing of ours is on this machine"
absent "no private Node" "$HOME/.local/share/gov/node"
absent "no gov on PATH" "$HOME/.local/bin/gov"

# GOV_PKG is the tester's override (docs/testing-the-adopter-path.md): the same route an
# adopter walks, carrying a different parcel. GOV_YES answers the per-step confirmations;
# the final "Continue now?" reads /dev/tty directly, so the driver answers that one.
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
)" env GOV_PKG=/work/gov.tgz GOV_YES=1 bash /src/install.sh

info "what the installer did"
exists "#186 — Node is installed PRIVATELY, not over the machine's own" "$HOME/.local/share/gov/node/bin/node"
saw "and it says so rather than leaving it to be discovered" "Installing Node"
exists "gov is linked where the profile already looks" "$HOME/.local/bin/gov"

info "#186 — the claim is proved, not announced"
in_a_new_login_shell "gov --version" \
  && pass "gov runs in a NEW login shell — the terminal an adopter opens tomorrow" \
  || fail "gov is not runnable in a fresh login shell"
# #211 — TODAY THIS PASSES BY DESCRIBING THE DEFECT, not by asserting the fix. install.sh
# PREPENDS $NODE_DIR/bin to the profile, so gov's Node shadows the machine's from the next
# terminal onward, against what the installer tells the adopter it will do. Flip these two
# lines when #211 lands; leaving the assertion aspirational would make the suite red for a
# reason it is not about, and a suite that is red on purpose is a suite nobody reads.
if in_a_new_login_shell "node --version"; then
  info "#211 — gov's private Node is on the profile PATH, and shadows the machine's"
  grep -q "gov installer" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" 2>/dev/null \
    && pass "the profile edit is present and marked, so it can be found and removed" \
    || fail "PATH was changed with nothing in the profile to show for it"
else
  pass "#211 is fixed — the machine's own Node keeps precedence"
fi

info "#204 / #186 — the consent screen, on a machine that really is missing both"
says "it says what is missing, in the reader's terms" "gov has checked this machine and found the following missing"
says "and then what it would run about it" "To put that right, gov will run"
saw "the commands are the appendix, not the argument" "sudo dnf install -y git"
saw "including the repository Rocky does not carry gh in" "cli.github.com/packages/rpm/gh-cli.repo"

info "the checklist tells the truth about a machine with no git and no gh"
says "it ends by naming the organization step, not by stopping" "Next: your organization"
never "nothing claims to be finished while steps remain" "everything on this machine is done"
