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
)" env GOV_PKG=/work/gov.tgz GOV_NODE_TARBALL=/work/node.tar.gz GOV_YES=1 bash /src/install.sh
require_gov "what gov concludes about a desktop (#221)" || return

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

# ── AND WHAT IT DOES WITH THAT VERDICT ON A SIGN-IN SCREEN (#221 → #213) ──
#
# The block above proves gov reaches the right conclusion about this machine. This proves it
# ACTS on it, which is the half that was missing for weeks: #221 landed the probe, and the
# sign-in screen went on printing "gov cannot tell whether this machine has one".
#
# Three walks on 2026-09-13 were lost to exactly that — a container with no browser, an adopter
# choosing option 1 because it is option 1, and a login flow waiting on a browser that could
# never open. OpenAI Codex started a local login server; Claude Code sat at `/login` wanting a
# code from a page nobody could reach.
#
# Asserted HERE rather than in the journey because the journey runs on the host, where
# `desktopHint` answers "yes" from the platform alone on macOS. This container is the only
# place the headless answer is the same every time.
info "and it ACTS on that verdict where it matters — the sign-in screen"
SCREEN="$("$NODE" -e '
  const s = require(process.env.PKG + "/lib/cjs/cli/sign-in-choice.js");
  const d = require(process.env.PKG + "/lib/cjs/cli/desktop.js");
  const f = { tool: "Claude Code", loginCommand: ["claude", "/login"],
              credentialEnv: "ANTHROPIC_API_KEY", desktop: d.desktopHint() };
  process.stdout.write(s.signInPrompt(f, s.signInOptions(f)).join("\n"));
' 2>/dev/null)"

runs sh -c 'case "$1" in *"1. Paste an API key now"*) exit 0;; *) exit 1;; esac' _ "$SCREEN" \
  && pass "the key route is offered FIRST on a machine with no browser" \
  || fail "option 1 is still the browser route here: $SCREEN"
runs sh -c 'case "$1" in *"no desktop here"*) exit 0;; *) exit 1;; esac' _ "$SCREEN" \
  && pass "and it says what it observed, rather than disclaiming it" \
  || fail "no observation given: $SCREEN"
runs sh -c 'case "$1" in *"cannot tell whether this machine has one"*) exit 1;; *) exit 0;; esac' _ "$SCREEN" \
  && pass "the old disclaimer is gone" \
  || fail "still printing 'gov cannot tell' on a machine it can read: $SCREEN"
# THE RULING, ON THE SCREEN IT GOVERNS: reorder and annotate, never withhold.
runs sh -c 'case "$1" in *"claude /login"*) exit 0;; *) exit 1;; esac' _ "$SCREEN" \
  && pass "and the browser route is STILL offered — reordered, never withheld" \
  || fail "the browser route was removed, which #221 forbids: $SCREEN"
runs sh -c 'case "$1" in *editor*) exit 1;; *) exit 0;; esac' _ "$SCREEN" \
  && pass "the caveat talks about a browser, not an editor" \
  || fail "printed the editor caveat on a sign-in screen: $SCREEN"
