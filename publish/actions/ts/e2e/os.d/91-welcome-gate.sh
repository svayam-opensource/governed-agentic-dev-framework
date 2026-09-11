# SPDX-License-Identifier: MIT
# THE WELCOME MESSAGE HAS TO BE READABLE, which means something has to stop.
#
# install.sh opens with the only account an adopter ever gets of what the next few minutes will
# do to their machine — nine numbered steps, and the promise that "nothing is installed or
# changed without being shown to you first". Then it downloads Node, and Node's own output is
# long enough to push all of it off the screen. Shown-and-immediately-erased is not shown, and a
# plan nobody had a chance to read is a formality performed at someone rather than consent.
#
# So there is a gate. It is one `confirm` call, which is exactly why it needs a test: it sits in
# the middle of a 40-line block of `say` calls that gets reworded every walk, and deleting it
# would break nothing that anybody would notice — the installer would simply go back to
# scrolling past. That is the failure this pins.
#
# TWO THINGS ARE ASSERTED, and the second matters as much as the first:
#   1. with a terminal, it STOPS, and answering no installs NOTHING
#   2. with GOV_YES=1 or no terminal, it does not stop at all
# Every other scenario in this tier drives install.sh non-interactively. A gate that blocks them
# is a gate somebody deletes at the end of a long afternoon, and rightly.
scenario "91 · the welcome message can be read before it scrolls away (${OS_TIER_LABEL})"

info "answering no at the gate — the plan was shown, and declined"
drive "$(conv <<'C'
~ 120
> Continue \[Y/n\] :
< n
C
)" env GOV_PKG=/work/gov.tgz bash /src/install.sh

# The checklist is the thing being protected; assert it actually arrived first.
saw "the nine steps were shown"                      "9. [ ] Finish setting up this machine"
saw "and the gate asked, rather than scrolling past" "Continue [Y/n] :"

# THE PART THAT PROVES IT IS A GATE AND NOT A PRINTOUT: nothing downstream ran.
never "no install started"          "Starting install"
absent "no private Node was fetched" "$HOME/.local/share/gov/node"
absent "and gov is not on the PATH"  "$HOME/.local/bin/gov"
saw   "it says how to come back"    "Nothing was installed."

info "and the same installer, non-interactively — the shape every other scenario here uses"
reset_machine
drive "$(conv <<'C'
~ 180
> Do you want to continue \(y/N\)\?
< n
> Continue now\? \[Y/n\]
< n
C
)" env GOV_PKG=/work/gov.tgz GOV_YES=1 bash /src/install.sh

never "GOV_YES=1 is not asked to continue" "Continue [Y/n] :"
saw   "it goes straight through"           "Starting install"

# ASK WHETHER gov WORKS, NOT WHERE IT LANDED.
#
# This asserted `$HOME/.local/bin/gov` and failed on Debian slim while the install had plainly
# succeeded — because `~/.local/bin` is not on PATH in that image, so install.sh writes no
# wrapper there and edits the profile instead (scenario 90 documents the difference distro by
# distro). One distro's path asserted on four is the same blindness `saw_re` exists for.
#
# A new LOGIN shell is the portable question, and the better one: it is the terminal an adopter
# opens next, and it is true on every image whichever route install.sh took.
in_a_new_login_shell "gov --version" \
  && pass "and gov is installed — a new login shell can run it" \
  || fail "install.sh reported success, but a new login shell still cannot run gov"
