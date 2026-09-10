# SPDX-License-Identifier: MIT
# #221 — WHAT gov CONCLUDES ABOUT THIS MACHINE'S DESKTOP, on a real one.
#
# `desktopHint` is unit-tested against injected env, which proves the branches and nothing about
# the environment a container actually presents. This runs the SHIPPED build on a bare machine,
# then again under a real Xvfb, and asserts gov changes its mind — the only way to catch a probe
# that reads a variable the OS spells differently, or that a base image sets for its own reasons.
#
# THE VERDICT MUST NEVER WITHHOLD A ROUTE. That is the design constraint (src/cli/desktop.ts,
# and the ruling it narrows at main.ts:261): a wrong guess about a desktop may mis-ORDER a menu
# and may never remove an option. So every assertion here is about ordering and annotation.
scenario "98 · what gov concludes about a desktop, and that it never withholds (#221) (${OS_TIER_LABEL})"

drive "$(conv <<'C'
~ 180
> Do you want to continue \(y/N\)\?
< n
> Continue now\? \[Y/n\]
< n
C
)" env GOV_PKG=/work/gov.tgz GOV_YES=1 bash /src/install.sh
exists "gov is installed" "$HOME/.local/bin/gov"

NODE="$HOME/.local/share/gov/node/bin/node"
PKG="$HOME/.local/share/gov/node/lib/node_modules/@svayam-opensource/gov"
exists "the shipped package is where install.sh put it" "$PKG/lib/cjs/cli/desktop.js"

# Ask the SHIPPED module, with the environment scrubbed so the base image cannot answer for us.
probe() {
  env -u DISPLAY -u WAYLAND_DISPLAY -u SSH_CONNECTION -u SSH_TTY "$@" \
    "$NODE" -e 'const d=require(process.env.PKG+"/lib/cjs/cli/desktop.js");
                const h=d.desktopHint();
                process.stdout.write(h.verdict+"|"+d.preferCli(h)+"|"+(d.desktopCaveat(h)??""));' 2>/dev/null
}
export PKG

info "a bare container is not mistaken for a desktop"
BARE="$(probe)"
runs test "${BARE%%|*}" = "no" \
  && pass "verdict is 'no'" || fail "expected 'no' on a bare container, got '$BARE'"
runs sh -c 'case "$1" in *"|true|"*) exit 0;; *) exit 1;; esac' _ "$BARE" \
  && pass "and CLI routes are listed first" || fail "preferCli should be true: $BARE"
runs sh -c 'case "$1" in *"did not detect a desktop"*) exit 0;; *) exit 1;; esac' _ "$BARE" \
  && pass "saying WHY, so a reader can disagree with it" || fail "no reason given: $BARE"

info "X11 forwarding — GUI-capable, display elsewhere: the case that shaped the design"
FWD="$(probe DISPLAY=localhost:10.0 SSH_CONNECTION='1.2.3.4 22 5.6.7.8 22')"
runs test "${FWD%%|*}" = "remote" \
  && pass "recognised as remote, not as absent" || fail "expected 'remote', got '$FWD'"
runs sh -c 'case "$1" in *"remote display"*) exit 0;; *) exit 1;; esac' _ "$FWD" \
  && pass "and the caveat says the editor opens where the display is" || fail "no remote caveat: $FWD"

info "under a REAL X server, the same binary answers differently"
if command -v Xvfb >/dev/null 2>&1; then
  Xvfb :99 -screen 0 1024x768x16 >/dev/null 2>&1 &
  sleep 1
  WITH="$(probe DISPLAY=:99)"
  kill %1 2>/dev/null || true
  runs test "${WITH%%|*}" = "yes" \
    && pass "a live X server is a desktop" || fail "expected 'yes' under Xvfb, got '$WITH'"
  runs sh -c 'case "$1" in *"|false|"*) exit 0;; *) exit 1;; esac' _ "$WITH" \
    && pass "editor routes are no longer pushed behind the CLI" || fail "preferCli should be false: $WITH"
  runs sh -c 'case "$1" in *"|") exit 0;; *) exit 1;; esac' _ "$WITH" \
    && pass "and no caveat, because there is nothing to warn about" || fail "should carry no caveat: $WITH"
else
  # NOT A PASS. A skipped assertion that reads like one is the shape this project keeps filing;
  # say plainly that this image cannot answer the question.
  info "SKIPPED — Xvfb is not in this image, so the desktop branch was NOT exercised here"
fi
