# SPDX-License-Identifier: MIT
# SCENARIO 3a — the org's default agent is IBM Bob, installed on a bare machine.
#
# Four rounds of defects lived in this one screen and every one of them shipped past 890
# unit tests, because a unit test injects the install and the spawn. What is asserted here
# is what an adopter reads and what the machine is left holding.
scenario "60 · agent install — IBM Bob (#200 · #201 · #202 · #208 · #209)"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

drive "$(conv <<'C'
> Select \(A/B/C\)
< B
> Q1 - What is the Github Organization ID
< acme
> Q2 - What is the name of your org
< acme-gov
~ 120
> start work now
< n
C
)" gov

# THE VENDOR'S INSTALLER, DOUBLED. gov runs `sh -c "curl … | bash"`, so the seam is `curl`:
# a curl that emits an installer script, which installs the agent double. Nothing leaves the
# world, and the command gov actually runs is unchanged.
cat > "$WORLD/bin/curl" <<EOF
#!/usr/bin/env bash
# Only the vendor URL gov was told to fetch; anything else is not this test's business.
case "\$*" in
  *bob.ibm.com/download/bobshell.sh*)
    printf 'cp %s %s/bin/bob && chmod +x %s/bin/bob\n' "$HERE/stub/agent-double" "$WORLD" "$WORLD" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORLD/bin/curl"

# EVERY `gov <verb>` PASSES A CONTEXT GATE FIRST — itself a human step, and one no
# non-interactive test had ever answered, because none of them was ever asked.
drive "$(conv <<'C'
~ 120
> Proceed\? \(y/N\)
< y
# #213 — a NAMED CHOICE, the way `gh` asks it. 2 is "paste an API key"; this walk takes 3,
# skip, because what is under test is that the choice exists and that skipping is honest.
> Choose \[1-3\]
< 3
> $
C
)" gov agent install ibm-bob

says "#201 — the vendor is named BEFORE anything runs" "Vendor: https://bob.ibm.com"
never "#201 — and never the package that was not IBM's" "@bobsworkshop/cli"
saw "#201 — IBM's own channel is what runs" "bob.ibm.com/download/bobshell.sh"

# #213 — NO ASSUMPTION ABOUT A BROWSER, for any agent.
#
# This block previously asserted the opposite: that gov does NOT ask an agent that signs
# itself in. That was right about the agent and wrong about the machine — a real walk hit a
# container where Bob's loopback callback could never reach the host's browser, and the run
# had nowhere to go. The offer is unconditional now; only the wording depends on the agent.
says "it ASKS rather than deciding" "How would you like to sign IBM Bob in?"

# #221 → #213 — WHAT CAN BE ASSERTED ON WHATEVER MACHINE RUNS THIS SUITE.
#
# This asserted "cannot tell whether this machine has one", the honest answer until #221 landed
# a desktop probe — after which gov kept printing it while knowing better. Three walks on
# 2026-09-13 were lost to that: a container with no browser, an adopter choosing option 1
# because it is option 1, and a login flow waiting on a browser that could never open.
#
# THE WORDING IS NOT ASSERTABLE HERE. This suite is hermetic but runs on the HOST, and
# `desktopHint` answers "yes" from the platform alone on macOS and Windows. Asserting the
# headless sentence would pass or fail depending on whose laptop ran it — which is the kind of
# test this project keeps deleting. The headless branch is asserted in the OS tier, on a real
# Linux container with no DISPLAY, where the question has one answer.
#
# What IS platform-independent is #221's ruling, and it is the part worth pinning anyway:
# reorder and annotate, never withhold. Both routes must be on the screen either way.
says "the browser route is offered"          "Let IBM Bob sign you in when it starts"
says "and so is the key route"               "Paste an API key now"
never "and gov does not invent a conclusion" "gov sees no desktop here (unknown)"
saw "the browser route is named" "1. Let IBM Bob sign you in when it starts"
saw "and so is the key — not an escape hatch behind an Enter" "2. Paste an API key now"
saw "and skipping is a choice with a number, like the others" "3. Skip for now"

info "#213 — and skipping is honest about what it left undone"
says "it says what happens next" "will ask you to sign in when it starts"
says "and how to finish later" "export BOB_API_KEY"
never "an agent that can still authenticate itself is NOT called unusable" "cannot run until it has a key"
