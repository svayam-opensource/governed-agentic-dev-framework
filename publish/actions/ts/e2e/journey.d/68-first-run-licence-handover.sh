# SPDX-License-Identifier: MIT
# THE FIRST-RUN GATE, AND THE TERMINAL GOV HANDS OVER TO CLEAR IT.
#
# A walk on 2026-09-13 ended here. gov installed IBM Bob, printed "✓ IBM Bob is ready", handed
# it the protocol as `bob -p "<protocol>"`, and Bob answered:
#
#     Error: A license agreement is required. Please accept the license terms before proceeding.
#     Launch Bob Shell in interactive mode or view license with `bob --show-license`
#
# Two things were wrong and only one was obvious. The obvious one: the session never started.
# The other: gov had just printed "On first run IBM Bob shows its licence screen. Press `y` to
# accept" while launching in the one mode that can never show that screen. The advice and the
# action disagreed, and the advice was the part the adopter believed.
#
# WHAT GOV MUST NOT DO, and why this is not just `--accept-license`. Accepting a vendor's
# licence is a legal act by a person. Passing that flag — or driving the prompt with a pty, which
# this very harness could do — is gov consenting on someone's behalf.
#
# WHAT IT DOES INSTEAD. gov already owns the adopter's terminal, so it offers to hand it over,
# waits while they settle whatever the agent asked for, and then hands the protocol again. Not a
# second terminal: the container where this bites has no terminal emulator at all.
#
# The double is armed with AGENT_DOUBLE_LICENCE, so it refuses a prompt exactly as Bob does and
# accepts on a bare interactive run — the stand-in for a person pressing `y`.
scenario "68 · a first-run licence gate, cleared in the same terminal (walk 2026-09-13)"

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

# ARM THE GATE. Absent file = licence not yet accepted, which is a first run.
export AGENT_DOUBLE_LICENCE="$WORLD/bob-licence-accepted"
rm -f "$AGENT_DOUBLE_LICENCE"

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
> Install which
< 1
> Choose \[1-3\]
< 3
# THE HANDOVER OFFER. The agent has just refused the protocol and said why, on screen, in its
# own words — so gov asks rather than diagnosing.
> Open ibm-bob here
< y
~ 120
> $
C
)" gov work --project=infra

info "gov noticed the agent stopped before the protocol landed"
says "it says so plainly"        "stopped straight away, before the protocol could reach it"
says "and refuses to act for you" "gov will not do on"
says "and offers this terminal"   "gov can hand this terminal to ibm-bob"

info "the licence was accepted by the PERSON, in the interactive run"
exists "the vendor's own gate is cleared" "$AGENT_DOUBLE_LICENCE"
never "gov never passed an accept flag" "--accept-license"

info "and THEN the protocol was handed over again — the argv log is the proof"
# Three invocations, in order: the refused one WITH the prompt, the bare interactive one, and
# the retry WITH the prompt. Anything less than three means the retry never happened.
runs sh -c 'test "$(grep -c "^cmd=bob" "$1")" -ge 3' _ "$AGENT_DOUBLE_LOG" \
  && pass "bob was invoked three times — refuse, accept, retry" \
  || fail "expected 3 invocations, got $(grep -c '^cmd=bob' "$AGENT_DOUBLE_LOG"): $(tr '\n' ' ' < "$AGENT_DOUBLE_LOG")"
runs sh -c 'test "$(grep -c "^arg1=-p$" "$1")" -ge 2' _ "$AGENT_DOUBLE_LOG" \
  && pass "and the protocol travelled as argv BOTH times" \
  || fail "the retry did not carry the prompt: $(tr '\n' ' ' < "$AGENT_DOUBLE_LOG")"
runs sh -c 'grep -q "^argc=0$" "$1"' _ "$AGENT_DOUBLE_LOG" \
  && pass "with one bare run between them — the interactive handover" \
  || fail "no argument-free invocation: gov never actually handed the terminal over"
says "and gov says it is handing the protocol over again" "Handing ibm-bob the session-start protocol again"

info "nothing claims a governed session that never started"
never "no false success" "still will not take the protocol"
