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
~ 600
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
in_a_new_login_shell "node --version" \
  && fail "gov's private Node leaked onto the machine's PATH — it must not" \
  || pass "the machine's own Node is untouched: gov's is private, and stays private"

info "the checklist tells the truth about a machine with no git and no gh"
says "it ends by naming the organization step, not by stopping" "Next: your organization"
never "nothing claims to be finished while steps remain" "everything on this machine is done"
