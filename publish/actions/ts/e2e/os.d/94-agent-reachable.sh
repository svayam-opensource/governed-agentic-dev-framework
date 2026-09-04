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
scenario "94 · an installed agent is usable in the shell you are in (#209) (${OS_TIER_LABEL})"

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
  && pass "#209 — and so does the shell you are ALREADY in, via ~/.local/bin" \
  || fail "#209 — unreachable in the current shell, which is where 'bob --resume' was typed"

info "gov links what it installs, the way install.sh linked gov"
if [ -x "$HOME/.local/bin/bob" ]; then
  pass "a wrapper exists in ~/.local/bin — already on PATH, so it works without a new terminal"
else
  info "not linked here: this fragment placed the binary by hand rather than through an install"
  info "the linking itself is covered when a vendor double can install inside this image (BACKLOG)"
fi
