# SPDX-License-Identifier: MIT
# THE GATE BEHIND THE GATE — and gov saying which one it is.
#
# 68 proves the handover clears a first-run licence. The 2026-09-14 walk got through that and
# stopped one step later:
#
#     → Handing ibm-bob the session-start protocol again.
#     Error: Bob API key is required. Set BOB_API_KEY environment variable.
#     ✗ ibm-bob still will not take the protocol as a first message.
#
# The handover worked. The message did not. gov held BOTH halves of that diagnosis — the catalog
# names the agent's credential variable, and the environment says whether it is set — and
# printed a shrug over the top of them. An adopter reading "still will not take the protocol"
# has no way to know the fix is one menu choice away, and the route that IS available in a
# container (a key) is the one they had declined three questions earlier.
#
# This is the same defect as the sign-in screen disclaiming a desktop verdict gov already had,
# and it deserves the same treatment: say what you know.
#
# THE DESKTOP HALF IS NOT ASSERTED HERE. The extra sentence — "its only other route is a browser
# sign-in, and gov sees no desktop here" — depends on `desktopHint`, which answers "yes" from the
# platform alone on macOS. This suite pins a desktop for exactly that reason (see journey.sh), so
# the headless wording belongs in the OS tier. What IS platform-independent is naming the
# variable and naming the way out, which is the part that was missing.
scenario "69 · when the retry fails for a REASON gov knows, it says the reason (walk 2026-09-14)"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

cat > "$WORLD/bin/curl" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *bob.ibm.com/download/bobshell.sh*)
    printf 'cp %s %s/bin/bob && chmod +x %s/bin/bob\n' "$HERE/stub/agent-double" "$WORLD" "$WORLD" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORLD/bin/curl"

# BOTH GATES ARMED, which is the walk's actual shape: the licence clears on the interactive run,
# and the key is still missing afterwards because the person chose the browser route.
export AGENT_DOUBLE_LICENCE="$WORLD/bob-licence-accepted"
export AGENT_DOUBLE_NEEDS_KEY="BOB_API_KEY"
rm -f "$AGENT_DOUBLE_LICENCE"
unset BOB_API_KEY

export GH_STUB_LOGIN=acme GH_STUB_BOARDS="9:Infra"
fake_joined_project "$HOME/.gov/acme/projects/PRJ-9-infra" "acme-gov"

drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Q1 - What is the Github Organization ID
< acme
> Q2 - What is the name of your org
< acme-gov
~ 180
> start work now
< n
C
)" gov

: > "$AGENT_DOUBLE_LOG"
drive "$(conv <<'C'
~ 240
> Proceed\? \(y/N\)
< y
> Install IBM Bob now
< y
# 3 = Skip for now. The walk's person took the browser route, which in a container amounts to
# the same thing: no key reaches the agent.
> Choose \[1-3\]
< 3
> Open ibm-bob here
< y
~ 120
> $
C
)" gov work --project=infra

info "the handover still happened — 68's behaviour must not regress"
says "the terminal was offered"     "gov can hand this terminal to ibm-bob"
exists "and the licence got cleared" "$AGENT_DOUBLE_LICENCE"
says "and the protocol was retried"  "Handing ibm-bob the session-start protocol again"

info "and THIS time it says why the retry failed"
says "it does not merely shrug"          "BOB_API_KEY is not set"
says "naming what the agent needs it for" "needs it to take a first message"
says "and the way out, which is one menu choice" 'choose "Paste an API key"'

info "what it must NOT do"
# A key that was never set cannot be the thing to re-paste — but equally, gov must not invent a
# cause. The variable is named only because gov checked it.
never "no secret is ever echoed"        "sk-"
# The protocol is still offered as the manual fallback: the session is not governed until
# something delivers it, and gov has just failed to.
says "the protocol is still handed to the person" "paste this as your first message"
