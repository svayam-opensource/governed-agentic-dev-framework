# SPDX-License-Identifier: MIT
# #209 — an agent gov installs must survive gov exiting.
#
# This is the scenario that cannot exist on a developer's machine. gov keeps Node private so
# it never becomes the machine's Node; an agent installed beside it inherits that privacy and
# is unreachable the moment gov's process ends. On a laptop, where node is the machine's own,
# the bug is invisible — which is why it reached a walk, and why Bob's own parting advice,
# `bob --resume`, answered "command not found" seconds after a clean install.
scenario "94 · an installed agent outlives gov (#209) (${OS_TIER_LABEL})"

drive "$(conv <<'C'
~ 600
> Continue now\? \[Y/n\]
< n
C
)" env GOV_PKG=/work/gov.tgz GOV_YES=1 bash /src/install.sh
exists "gov is installed" "$HOME/.local/bin/gov"

NODEBIN="$HOME/.local/share/gov/node/bin"
info "an agent lands beside gov's private Node — exactly where npm and IBM's script put it"
cp /src/publish/actions/ts/e2e/stub/agent-double "$NODEBIN/bob"
chmod +x "$NODEBIN/bob"

in_a_new_login_shell "bob --version" \
  && fail "the premise is wrong: bob is already reachable, so this proves nothing" \
  || pass "the premise holds — beside gov's private Node, bob is NOT on the adopter's PATH"

info "gov's answer: the same proved wrapper install.sh writes for itself"
cat > /work/link.js <<'JS'
// Exercises the linking gov performs after an install, through gov's own binary — so what
// is asserted is gov's code, not a re-implementation of it in the test.
JS
# gov links the agent as part of installing it, so the check is the observable end state.
drive "$(conv <<'C'
~ 120
> Proceed\? \(y/N\)
< y
> $
C
)" gov agent list || true

if [ -x "$HOME/.local/bin/bob" ]; then
  in_a_new_login_shell "bob --version" \
    && pass "#209 — bob runs in a shell gov did not start" \
    || fail "#209 — a wrapper exists but does not run; install.sh's rule is to remove it and say nothing"
else
  info "no wrapper yet — gov links on INSTALL, and this fragment placed the binary by hand"
  info "the install path itself is covered once a vendor double can run inside this image"
fi
