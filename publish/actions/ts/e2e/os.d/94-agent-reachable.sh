# SPDX-License-Identifier: MIT
# #209 — an agent gov installs must be usable in THE SHELL YOU ARE STANDING IN.
#
# The first version of this fragment asserted the wrong shell, and the harness said so: it
# expected `bob` to be unreachable after being placed beside gov's private Node, and found it
# reachable. Correctly — `install.sh` appends that directory to the user's PROFILE, so a NEW
# login shell finds it.
#
# Which reframes the defect rather than dismissing it. What the walk actually hit was
#
#     Resume tasks with:  bob --resume
#     [tester@…]$ bob --resume
#     -bash: bob: command not found
#
# in the SAME shell that had just run the installer — the one shell that has not re-read the
# profile, and the only shell an adopter is in at that moment. A PATH edit that works tomorrow
# is not an answer to a command suggested today.
scenario "94 · the two shells that decide whether an agent is reachable (#209) (${OS_TIER_LABEL})"

drive "$(conv <<'C'
~ 180
> Do you want to continue \(y/N\)\?
< n
> Continue now\? \[Y/n\]
< n
C
)" env GOV_PKG=/work/gov.tgz GOV_YES=1 bash /src/install.sh
exists "gov is installed" "$HOME/.local/bin/gov"

NODEBIN="$HOME/.local/share/gov/node/bin"
cp /src/publish/actions/ts/e2e/stub/agent-double "$NODEBIN/bob"
chmod +x "$NODEBIN/bob"

info "the premise, stated as two different shells"
bash -lc "bob --version" >/dev/null 2>&1 \
  && pass "a NEW login shell finds it — install.sh's profile edit is read at login" \
  || fail "even a new login shell cannot find it; the profile edit did not take"

# THE SHELL THAT MATTERS. `env -i` is the honest stand-in for "the terminal you are already
# in": the profile has not been read, so only what is on PATH right now counts.
env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin" bash -c "bob --version" >/dev/null 2>&1 \
  && fail "the premise is gone: it is reachable unaided, so #209's wrapper would be redundant" \
  || pass "#209's premise — the CURRENT shell cannot find it, and that is the shell you are in"

# WHAT THIS FRAGMENT DOES NOT PROVE, said out loud rather than implied by a green line.
#
# It places the binary by hand, so gov never linked anything: this characterises the two
# shells that make #209 possible, and stops there. Naming it "an installed agent is usable"
# and passing would be the exact shape this whole suite exists to catch — a check whose green
# means nobody looked. Covering gov's linking needs a real `gov agent install` in here, which
# needs a workspace and an approved list inside the image. BACKLOG.md, and it is the next
# thing this tier should grow.
info "not proved here: that GOV links what it installs — that needs a real install (BACKLOG)"
